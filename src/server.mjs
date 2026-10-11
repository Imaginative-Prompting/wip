import { createServer } from "node:http";
import { createReadStream, watch } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appRoot, catalog, hash, inside } from "./store.mjs";

import { listAnnotations, saveAnnotation, annotationRefs, sourceStamp } from "./annotations.mjs";
import { mediaRefs } from "./privacy.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
export function range(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || !size || (!m[1] && !m[2])) return false;
  let a = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let b = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    a > b ||
    a >= size
  )
    return false;
  return [a, b];
}
export async function start(c, requestedPort) {
  let data = await catalog(c),
    signature = hash(data),
    timer;
  let annotations = await listAnnotations(c);
  let allowedMedia = new Set([...mediaRefs(data), ...annotationRefs(annotations)]);
  const clients = new Set();
  const refresh = async () => {
    try {
      annotations = await listAnnotations(c);
      const next = await catalog(c),
        sig = hash(next);
      if (sig !== signature) {
        data = next;
        allowedMedia = new Set([...mediaRefs(next), ...annotationRefs(annotations)]);
        signature = sig;
        for (const r of clients) r.write(`event: change\ndata: ${sig}\n\n`);
      }
    } catch (e) {
      console.error(`Content reload: ${e.message}`);
    }
  };
  const watcher = watch(c.content, { recursive: true }, (_event, file) => {
    if (!file?.endsWith(".json")) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  });
  const heartbeat = setInterval(() => {
    for (const r of clients) r.write(": keepalive\n\n");
  }, 20000);
  const server = createServer(async (req, res) => {
    const port = server.address()?.port;
    if (
      ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)
    ) {
      res.writeHead(403).end("Local requests only");
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-cache");
    if (req.url?.split("?")[0] === "/api/annotations") {
      try {
        if (req.method === "GET") {
          annotations = await listAnnotations(c);
          allowedMedia = new Set([...mediaRefs(data), ...annotationRefs(annotations)]);
          const records = await Promise.all(annotations.map(async a => ({...a, sourceChanged: !!a.sourceStamp && a.sourceStamp !== await sourceStamp(c,a.clip)})));
          res.writeHead(200, {"Content-Type":"application/json"}).end(JSON.stringify({records}));
        } else if (req.method === "PUT") {
          if (req.headers.origin !== `http://${req.headers.host}` || req.headers["sec-fetch-site"] === "cross-site") { res.writeHead(403).end("Same-origin requests only"); return; }
          if (req.headers["content-type"] !== "application/json") { res.writeHead(415).end(); return; }
          let bytes = 0; const chunks = [];
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 2000000) { res.writeHead(413).end("Annotation too large"); return; } chunks.push(chunk); }
          const {record, expected} = JSON.parse(Buffer.concat(chunks).toString());
          annotations = await listAnnotations(c);
          const allowed = new Set([...mediaRefs(data), ...annotationRefs(annotations)]);
          // Remote catalog media is also valid; mediaRefs intentionally only extracts local URLs.
          const collect = value => { if (typeof value === "string" && /^https?:\/\//.test(value)) allowed.add(value); else if (value && typeof value === "object") Object.values(value).forEach(collect); }; collect(data);
          const saved = await saveAnnotation(c,record,expected,allowed);
          res.writeHead(200, {"Content-Type":"application/json"}).end(JSON.stringify(saved));
        } else res.writeHead(405,{Allow:"GET, PUT"}).end();
      } catch(e) { res.writeHead(/Revision conflict|Another writer/.test(e.message)?409:400,{"Content-Type":"application/json"}).end(JSON.stringify({error:e.message})); }
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === "/api/catalog") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          ETag: `"${signature}"`,
        });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify(data));
        return;
      }
      if (pathname === "/api/events") {
        if (req.method === "HEAD") {
          res.writeHead(200).end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`event: ready\ndata: ${signature}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      let file;
      if (pathname.startsWith("/media/")) {
        if (!allowedMedia.has(pathname)) {
          res.writeHead(404).end("Not found");
          return;
        }
        const parts = pathname.slice(7).split("/"),
          mount = c.mounts[parts.shift()];
        if (!mount) {
          res.writeHead(404).end();
          return;
        }
        file = await inside(mount, parts.join("/"));
        const partsOnDisk = path
          .relative(
            await import("node:fs/promises").then((fs) => fs.realpath(mount)),
            file,
          )
          .split(path.sep);
        if (
          partsOnDisk.some(
            (p) =>
              p.startsWith(".") ||
              ["capture", "archive", "node_modules"].includes(p),
          )
        ) {
          res.writeHead(403).end();
          return;
        }
        if (!types[path.extname(file).toLowerCase()]) {
          res.writeHead(403).end("Unsupported asset type");
          return;
        }
        if (path.extname(file) === ".html")
          res.setHeader(
            "Content-Security-Policy",
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
          );
      } else if (pathname === "/vendor/marked.js")
        file = fileURLToPath(import.meta.resolve("marked"));
      else if (pathname === "/vendor/purify.js")
        file = fileURLToPath(import.meta.resolve("dompurify"));
      else {
        file = await inside(
          path.join(appRoot, "web"),
          pathname === "/" ? "index.html" : pathname.slice(1),
        );
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; media-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
      }
      const st = await stat(file);
      if (!st.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const r = range(req.headers.range, st.size);
      if (r === false) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
        return;
      }
      const headers = {
        "Content-Type":
          types[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": r ? r[1] - r[0] + 1 : st.size,
      };
      if (r) headers["Content-Range"] = `bytes ${r[0]}-${r[1]}/${st.size}`;
      res.writeHead(r ? 206 : 200, headers);
      if (req.method === "HEAD" || !st.size) res.end();
      else {
        const stream = createReadStream(
          file,
          r ? { start: r[0], end: r[1] } : {},
        );
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      }
    } catch (e) {
      if (!res.headersSent)
        res.writeHead(e instanceof URIError ? 400 : 404).end("Not found");
      else res.destroy();
    }
  });
  server.on("close", () => {
    watcher.close();
    clearInterval(heartbeat);
    clearTimeout(timer);
    for (const r of clients) r.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      watcher.close();
      clearInterval(heartbeat);
      clearTimeout(timer);
      reject(error);
    });
    server.listen(requestedPort ?? c.port ?? 7353, "127.0.0.1", resolve);
  });
  console.log(`WIP · http://127.0.0.1:${server.address().port}`);
  return server;
}
