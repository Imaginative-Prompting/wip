import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  config,
  atomic,
  upsert,
  json,
  setCurrent,
  inside,
  validate,
} from "../src/store.mjs";
import { range, start } from "../src/server.mjs";
import { durationOf, videoPosition } from "../web/player.js";
import { request } from "node:http";

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wip-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "content/demo/entries"), { recursive: true });
  await mkdir(path.join(root, "media"), { recursive: true });
  await atomic(path.join(root, "content/demo/project.json"), {
    id: "demo",
    title: "Demo",
  });
  await atomic(path.join(root, "config.json"), {
    content: "content",
    mounts: { test: "media" },
  });
  return { root, c: await config(path.join(root, "config.json")) };
}
const entry = {
  id: "one",
  title: "One",
  tags: ["concepts"],
  body: "A reviewable idea.",
  format: "markdown",
  updatedAt: "2026-10-09T00:00:00Z",
};
test("edits require the revision that was read; concurrent writers cannot lose updates", async (t) => {
  const { c, root } = await workspace(t);
  await upsert(c, "demo", entry);
  await assert.rejects(
    upsert(c, "demo", { ...entry, title: "stale" }),
    /Revision conflict/,
  );
  const results = await Promise.allSettled([
    upsert(c, "demo", { ...entry, title: "A" }, 1),
    upsert(c, "demo", { ...entry, title: "B" }, 1),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (await json(path.join(root, "content/demo/entries/one.json"))).revision,
    2,
  );
  await upsert(c, "demo", { ...entry, id: "two" });
  assert.equal((await validate(c)).entries, 2);
});
test("invalid content and paths cannot be published", async (t) => {
  const { c, root } = await workspace(t);
  await assert.rejects(
    upsert(c, "demo", { ...entry, id: "../bad" }),
    /Invalid ID/,
  );
  await assert.rejects(
    setCurrent(c, "demo", { title: "Bad", audio: "file:///private/a" }),
    /Invalid audio/,
  );
  await writeFile(path.join(root, "outside.txt"), "secret");
  await symlink(
    path.join(root, "outside.txt"),
    path.join(root, "media/escape.txt"),
  );
  await assert.rejects(
    inside(path.join(root, "media"), "escape.txt"),
    /outside/,
  );
});
test("range requests support seeking, suffixes, zero bytes, and malformed input", () => {
  assert.deepEqual(range("bytes=2-4", 10), [2, 4]);
  assert.deepEqual(range("bytes=-3", 10), [7, 9]);
  assert.deepEqual(range("bytes=5-", 10), [5, 9]);
  assert.deepEqual(range("bytes=0-999", 10), [0, 9]);
  for (const r of [
    "bytes=10-",
    "bytes=4-2",
    "bytes=-0",
    "bytes=-",
    "bytes=0-2,4-6",
    "garbage",
  ])
    assert.equal(range(r, 10), false);
  assert.equal(range("bytes=0-", 0), false);
});
test("server provides byte ranges and refuses write requests, private paths and foreign hosts", async (t) => {
  const { c, root } = await workspace(t);
  await writeFile(path.join(root, "media/clip.mp4"), "0123456789");
  await mkdir(path.join(root, "media/capture"));
  await writeFile(path.join(root, "media/capture/private.txt"), "private");
  const server = await start(c, 0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + "/media/test/clip.mp4", {
    headers: { Range: "bytes=2-4" },
  });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), "234");
  assert.equal(r.headers.get("content-range"), "bytes 2-4/10");
  assert.equal(
    (
      await fetch(base + "/media/test/clip.mp4", { method: "HEAD" })
    ).headers.get("content-length"),
    "10",
  );
  assert.equal(
    (await fetch(base + "/media/test/capture/private.txt")).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/catalog", { method: "POST" })).status,
    405,
  );
  const denied = await new Promise((resolve) => {
    const req = request(
      base + "/api/catalog",
      { headers: { Host: "attacker.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.end();
  });
  assert.equal(denied, 403);
  assert.equal((await fetch(base + "/api/catalog")).status, 200);
});
test("a full cut retains its end screen and timed excerpts use explicit offsets", () => {
  assert.equal(
    durationOf({ duration: 186.5, audio: "/media/a.mp3" }, 180.98, 186.5),
    186.5,
  );
  assert.equal(durationOf({ audio: "/media/a.mp3" }, 238.76, 0), 238.76);
  assert.equal(videoPosition({ offset: 77.2 }, 80), 2.799999999999997);
});
