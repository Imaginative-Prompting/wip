import { marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/purify.js";
import { Player, fmt, videoPosition } from "./player.js";
import { sameTrack } from "./playback-history.js";
import { collectClips, trackFor } from "./clips.js";
import { PreviewWindow } from "./preview-window.js";
const $ = (id) => document.getElementById(id);
const BASE = new URL("./", import.meta.url).pathname;
const STATIC = document.documentElement.dataset.mode === "static";
$("home-link")?.setAttribute("href", STATIC ? "/" : BASE);
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const player = new Player($("audio"), $("video"));
const previewWindow = new PreviewWindow($("preview"), $("dock"), $("move-preview"), $("resize-preview"));
let data,
  project = "all",
  query = "",
  selected = new Set(),
  rows = new Map(),
  open = new Set(),
  currentTrack = null,
  lastMeta = "",
  seeking = false,
  lastURL = "";
try {
  open = new Set(JSON.parse(localStorage.getItem("wip-open-v2") || "[]"));
} catch {}
const params = new URLSearchParams(location.search);
project = params.get("project") || "all";
query = params.get("q") || "";
selected = new Set(params.getAll("tag"));
$("search").value = query;
function rememberOpen() {
  try {
    localStorage.setItem("wip-open-v2", JSON.stringify([...open]));
  } catch {}
}
function syncURL(replace = true) {
  const u = new URL(location.href);
  u.search = "";
  if (project !== "all") u.searchParams.set("project", project);
  if (query) u.searchParams.set("q", query);
  for (const t of selected) u.searchParams.append("tag", t);
  const next = u.pathname + u.search + u.hash;
  if (next !== lastURL) {
    history[replace ? "replaceState" : "pushState"](null, "", next);
    lastURL = next;
  }
}
const label = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function toggleTag(t) {
  if (t === "all") selected.clear();
  else if (selected.has(t)) selected.delete(t);
  else selected.add(t);
  syncURL();
  render();
}
function tagButton(t, n) {
  const b = make(
    "button",
    `tag${(t === "all" ? !selected.size : selected.has(t)) ? " active" : ""}`,
    label(t),
  );
  if (n != null) b.append(make("span", "", n));
  b.setAttribute(
    "aria-pressed",
    String(t === "all" ? !selected.size : selected.has(t)),
  );
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTag(t);
  });
  return b;
}
function currentFor(p) {
  return p.current
    ? {
        ...p.current,
        fps: p.current.fps || p.fps || 30,
        id: `${p.id}:current`,
        project: p.id,
        projectTitle: p.title,
      }
    : p.song
      ? { ...p.song, id: `${p.id}:song`, project: p.id, projectTitle: p.title }
      : null;
}
function loadTrack(track, preview = true, time) {
  if (sameTrack(player.track, track)) {
    player.showPreview(preview);
    if (time != null) player.seek(time);
    player.play();
  } else player.load(track, {
    time: time ?? (player.track?.id === track.id ? player.time : player.history.position(track)),
    preview, autoplay: true,
  });
}
function dockProject() {
  return data?.projects.find((p) => p.id === (project === "all" ? player.track?.project : project))
    || (data?.projects.length === 1 ? data.projects[0] : null);
}
function updateTrackSwitch() {
  const p = dockProject(), current = p && currentFor(p);
  const clip = p && player.history.get(p.id, "clip");
  const isCurrent = sameTrack(player.track, current);
  $("current-track").disabled = !current;
  $("current-track").textContent = p?.current ? "Current cut" : p?.song ? "Soundtrack" : "Current cut";
  $("current-track").setAttribute("aria-pressed", String(isCurrent));
  $("current-track").title = current ? `Resume ${p.current ? "current cut" : "soundtrack"} · ${p.title}` : "Select a WIP with a current cut or soundtrack";
  $("return-clip").hidden = false;
  $("return-clip").disabled = !clip;
  $("browse-clips").disabled = !p;
  const isClip = !!clip && sameTrack(player.track, clip.track);
  $("return-clip").textContent = !clip || isClip ? "Clip" : "Back to clip";
  $("return-clip").setAttribute("aria-pressed", String(isClip));
  $("return-clip").title = clip ? `Resume ${clip.track.title} at ${fmt(isClip ? player.time : clip.time)}` : "";
}
$("current-track").addEventListener("click", () => {
  const p = dockProject(), track = p && currentFor(p);
  if (track) loadTrack(track, !!track.video);
});
$("return-clip").addEventListener("click", () => {
  const p = dockProject(), clip = p && player.history.get(p.id, "clip");
  if (clip) loadTrack(clip.track, clip.preview, sameTrack(player.track, clip.track) ? player.time : clip.time);
});
function playClip(track) {
  const time = player.track?.id === track.id ? player.time
    : player.history.get(track.project, "clip")?.track.id === track.id
      ? player.history.position(track) : track.offset || 0;
  loadTrack(track, !!track.video, time);
}
function mediaInBody(entry) {
  const template = document.createElement("template");
  template.innerHTML = DOMPurify.sanitize(entry.format === "html" ? entry.body : marked.parse(entry.body));
  const media = [];
  for (const el of template.content.querySelectorAll("video,audio,a[href]")) {
    const src = el.getAttribute("src") || el.querySelector("source")?.getAttribute("src") || el.getAttribute("href");
    if (!src) continue;
    const type = el.tagName === "AUDIO" || /\.(mp3|wav|m4a|ogg|flac)(?:[?#]|$)/i.test(src) ? "audio"
      : el.tagName === "VIDEO" || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(src) ? "video" : null;
    if (type) media.push({ src, type, poster: el.getAttribute("poster"),
      fps: Number(el.dataset.fps) || undefined,
      title: (el.tagName === "A" ? el.textContent.trim() : "") || el.closest("figure")?.querySelector("figcaption")?.textContent.trim() || entry.title });
  }
  return media;
}
const clipCache = new Map();
function renderClips() {
  const p = dockProject();
  if (!p) { closeClips(); return; }
  if (!clipCache.has(p.id)) clipCache.set(p.id, collectClips(p, mediaInBody));
  const clips = clipCache.get(p.id), words = $("clip-search").value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  $("clip-heading").textContent = `Clips · ${clips.length}`;
  const visibleClips = clips.filter((c) => words.every((word) => `${c.track.title} ${c.entry}`.toLowerCase().includes(word)));
  const list = document.createDocumentFragment();
  for (const clip of visibleClips) {
    const button = make("button", "clip-option");
    button.dataset.track = clip.track.id;
    button.setAttribute("aria-pressed", String(sameTrack(player.track, clip.track)));
    button.append(make("span", "clip-kind", clip.type === "audio" ? "♫" : "▷"));
    const copy = make("span", "clip-copy");
    copy.append(make("span", "", clip.track.title));
    const date = clip.dateKnown ? new Date(clip.added).toLocaleDateString(undefined, {month:"short", day:"numeric"}) : "Undated";
    copy.append(make("small", "", `${date}${clip.entry !== clip.track.title ? ` · ${clip.entry}` : ""}`));
    button.append(copy);
    button.title = clip.track.title;
    button.addEventListener("click", () => { playClip(clip.track); updateClipSelection(); });
    list.append(button);
  }
  if (!visibleClips.length) list.append(make("p", "clip-empty", clips.length ? "No matching clips." : "No audio or video clips in this WIP yet."));
  $("clip-list").replaceChildren(list);
}
function updateClipSelection() {
  for (const button of $("clip-list").querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.track === player.track?.id));
}
function closeClips(focus = false) {
  $("clip-picker").hidden = true;
  $("browse-clips").setAttribute("aria-expanded", "false");
  if (focus) $("browse-clips").focus();
}
$("browse-clips").addEventListener("click", () => {
  if (!$("clip-picker").hidden) { closeClips(); return; }
  $("clip-search").value = "";
  renderClips();
  $("clip-picker").hidden = false;
  $("browse-clips").setAttribute("aria-expanded", "true");
  $("clip-search").focus();
});
$("close-clips").addEventListener("click", () => closeClips(true));
$("clip-search").addEventListener("input", renderClips);
$("clip-picker").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeClips(true); }
  if (["ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();
    const buttons = [...$("clip-list").querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    buttons[Math.max(0, Math.min(buttons.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!$("clip-picker").contains(e.target) && !$("browse-clips").contains(e.target)) closeClips();
});
function renderCurrent() {
  const p = data.projects.find((p) => p.id === project),
    box = $("current");
  box.replaceChildren();
  currentTrack = p ? currentFor(p) : null;
  box.hidden = !p;
  if (!p) return;
  if (!currentTrack) {
    box.hidden = true;
    return;
  }
  const track = currentTrack;
  const art = track.poster
    ? make("img", "current-art")
    : make("div", "current-art", "♪");
  if (track.poster) {
    art.src = track.poster;
    art.alt = "Current cut";
    art.loading = "lazy";
  }
  const info = make("div", "current-info");
  info.append(
    make("div", "current-title", p.current ? "Current cut" : "Soundtrack"),
  );
  const bits = [
    track.version ? `Version ${track.version}` : null,
    track.duration ? fmt(track.duration) : null,
    track.builtLabel || null,
  ].filter(Boolean);
  info.append(make("div", "current-meta", bits.join(" · ")));
  if (player.track?.id === track.id && player.track.version !== track.version)
    info.append(
      make(
        "div",
        "current-meta",
        "A new version is ready. Your playing version continues until you switch.",
      ),
    );
  const play = make(
    "button",
    "primary",
    track.video ? "▶  Play cut" : "▶  Play song",
  );
  play.addEventListener("click", () => loadTrack(track, !!track.video));
  box.append(art, info, play);
  if (track.segments?.length || track.note) {
    const notes = make("details", "cut-notes");
    notes.append(make("summary", "", "About this cut"));
    if (track.note) notes.append(make("p", "", track.note));
    const table = make("table");
    for (const segment of track.segments || []) {
      const tr = make("tr");
      const time = make("td");
      const jump = make("button", "subtle", fmt(segment.t0));
      jump.addEventListener("click", () => {
        loadTrack(track, true);
        player.seek(segment.t0);
      });
      time.append(jump);
      tr.append(
        time,
        make("td", "", segment.label),
        make(
          "td",
          "",
          {
            final: "Final render",
            rough: "Rough pass",
            coming: "Not built yet",
          }[segment.status] ||
            segment.status ||
            "",
        ),
        make("td", "", segment.next || ""),
      );
      table.append(tr);
    }
    notes.append(table);
    box.append(notes);
  }
}
function mediaButton(m, p, e) {
  const b = make("button", "media-card");
  b.setAttribute("aria-label", `Play ${m.title || e.title}`);
  if (m.poster) {
    const im = make("img");
    im.src = m.poster;
    im.alt = "";
    im.loading = "lazy";
    b.append(im);
  }
  b.append(make("span", "media-play", "▶"));
  const copy = make("span", "", m.title || e.title);
  copy.append(
    make(
      "small",
      "",
      m.type === "audio" ? "Listen in the player" : "Watch in the player",
    ),
  );
  b.append(copy);
  b.addEventListener("click", () => {
    playClip(trackFor(m, p, e));
  });
  return b;
}
function bodyFor(p, e) {
  const body = make("div", "entry-body");
  const html =
    e.format === "html"
      ? e.body
      : marked.parse(e.body, { gfm: true, breaks: false });
  body.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      "style",
      "iframe",
      "form",
      "input",
      "button",
      "object",
      "embed",
    ],
    FORBID_ATTR: ["autoplay", "srcset", "id", "name"],
  });
  for (const el of body.querySelectorAll("[style]")) {
    const accepted = [];
    for (const key of [
      "margin-top",
      "margin-bottom",
      "max-width",
      "text-align",
      "font-weight",
      "grid-template-columns",
      "gap",
    ]) {
      const v = el.style.getPropertyValue(key);
      if (v && !/url|expression|var\(/i.test(v)) accepted.push(`${key}:${v}`);
    }
    el.removeAttribute("style");
    if (accepted.length) el.setAttribute("style", accepted.join(";"));
  }
  for (const m of body.querySelectorAll("video,audio")) {
    const src =
      m.getAttribute("src") || m.querySelector("source")?.getAttribute("src");
    if (src) {
      const caption = m
        .closest("figure")
        ?.querySelector("figcaption")
        ?.textContent?.trim();
      m.replaceWith(
        mediaButton(
          {
            src,
            type: m.tagName.toLowerCase(),
            poster: m.getAttribute("poster"),
            title: caption || e.title,
          },
          p,
          e,
        ),
      );
    } else m.remove();
  }
  for (const im of body.querySelectorAll("img")) {
    im.loading = "lazy";
    im.decoding = "async";
    im.addEventListener("click", () => {
      const big = $("lightbox").querySelector("img");
      big.src = im.src;
      big.alt = im.alt;
      $("lightbox").querySelector("p").textContent = im.alt;
      $("lightbox").showModal();
    });
  }
  for (const a of body.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (/\.(mp4|webm|mov|mp3|wav|m4a)(?:[?#]|$)/i.test(href)) {
      a.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        const type = /\.(mp3|wav|m4a)(?:[?#]|$)/i.test(href)
          ? "audio"
          : "video";
        loadTrack(
          {
            id: `${p.id}:${e.id}:${href}`,
            title: a.textContent || e.title,
            project: p.id,
            projectTitle: p.title,
            [type]: href,
          },
          type === "video",
        );
      });
    } else if (href.startsWith("#")) {
      a.addEventListener("click", (event) => {
        event.preventDefault();
        project = p.id;
        query = "";
        selected.clear();
        $("search").value = "";
        location.hash = href;
        syncURL();
        render();
        revealHash();
      });
    } else {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  for (const m of e.media || []) {
    if (m.type === "image") {
      const im = make("img");
      im.src = m.src;
      im.alt = m.title || e.title;
      im.loading = "lazy";
      im.addEventListener("click", () => {
        const big = $("lightbox").querySelector("img");
        big.src = im.src;
        big.alt = im.alt;
        $("lightbox").querySelector("p").textContent = im.alt;
        $("lightbox").showModal();
      });
      body.append(im);
    } else body.append(mediaButton(m, p, e));
  }
  const link = make("a", "entry-link", "Link to this entry ↗");
  link.href = `${BASE}?project=${encodeURIComponent(p.id)}#${encodeURIComponent(e.id)}`;
  body.append(link);
  return body;
}
function rowFor(p, e) {
  const key = `${p.id}:${e.id}`,
    cached = rows.get(key);
  if (cached?.revision === e.revision && cached.context === project)
    return cached.el;
  const row = make("details", "entry");
  row.dataset.key = key;
  row.dataset.id = e.id;
  row.id = key;
  const summary = make("summary");
  const kind = e.tags.includes("renders")
    ? "▷"
    : e.tags.includes("audio")
      ? "♫"
      : e.tags.includes("concepts")
        ? "◇"
        : e.tags.includes("stills")
          ? "▧"
          : "≡";
  summary.append(make("span", "entry-icon", kind));
  const info = make("div", "entry-info");
  info.append(
    make("div", "entry-title", e.title),
    make(
      "div",
      "entry-description",
      `${project === "all" ? p.title + " · " : ""}${e.summary || e.status || ""}`,
    ),
  );
  summary.append(info);
  const tags = make("div", "entry-tags");
  for (const t of e.tags.slice(0, 3)) tags.append(tagButton(t));
  summary.append(tags);
  const date = make("time", "entry-date");
  if (e.dateKnown !== false) date.dateTime = e.updatedAt;
  date.textContent =
    e.dateKnown === false
      ? "Undated"
      : new Date(e.updatedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
  if (e.status) date.append(make("div", "", e.status));
  summary.append(date);
  row.append(summary);
  const setBody = () => {
    if (row.open && !row.querySelector(".entry-body"))
      row.append(bodyFor(p, e));
    else if (!row.open) row.querySelector(".entry-body")?.remove();
  };
  row.addEventListener("toggle", () => {
    if (row.open) open.add(key);
    else open.delete(key);
    setBody();
    rememberOpen();
  });
  row.open = open.has(key);
  setBody();
  rows.set(key, { el: row, revision: e.revision, context: project });
  return row;
}
function render() {
  const ps =
    project === "all"
      ? data.projects
      : data.projects.filter((p) => p.id === project);
  const p = ps.length === 1 ? ps[0] : null;
  $("project-title").textContent = p ? p.title : "Work in progress.";
  $("project-description").textContent = p
    ? p.description || ""
    : `${data.projects.length} projects. Every idea, attempt, and next version, together.`;
  document.title = `${p ? p.title : "WIP"} · WIP`;
  $("projects").value = project;
  $("dock-projects").value = project;
  updateTrackSwitch();
  renderCurrent();
  if (!$("clip-picker").hidden) renderClips();
  const all = ps.flatMap((p) => p.entries.map((e) => ({ p, e })));
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const searched = all.filter(({ p, e }) =>
    words.every((w) =>
      `${e.title} ${e.summary || ""} ${e.searchText || e.body.replace(/<[^>]*>/g, " ")} ${e.tags.join(" ")} ${p.title}`
        .toLowerCase()
        .includes(w),
    ),
  );
  const counts = new Map();
  for (const { e } of searched)
    for (const t of new Set(e.tags)) counts.set(t, (counts.get(t) || 0) + 1);
  $("tags").replaceChildren(tagButton("all", searched.length));
  const tagNames = [...new Set([...counts.keys(), ...selected])].sort(
    (a, b) =>
      ((["renders", "concepts", "stills", "audio", "plans", "notes"].indexOf(
        a,
      ) +
        6) %
        6) -
      ((["renders", "concepts", "stills", "audio", "plans", "notes"].indexOf(
        b,
      ) +
        6) %
        6),
  );
  for (const t of tagNames) $("tags").append(tagButton(t, counts.get(t) || 0));
  const visible = searched.filter(
    ({ e }) => !selected.size || e.tags.some((t) => selected.has(t)),
  );
  const fragment = document.createDocumentFragment();
  for (const { p, e } of visible) fragment.append(rowFor(p, e));
  $("list").replaceChildren(fragment);
  $("empty").hidden = visible.length > 0;
  $("result-count").textContent =
    `${visible.length} ${visible.length === 1 ? "entry" : "entries"}`;
  $("notice").hidden = !data.errors.length;
  $("notice").textContent = data.errors.length
    ? `Some entries need attention: ${data.errors.join(" · ")}`
    : "";
}
async function refresh() {
  const response = await fetch(
    BASE + (STATIC ? "workspace.json" : "api/catalog"),
  );
  if (!response.ok) throw new Error("Workspace unavailable");
  data = await response.json();
  clipCache.clear();
  $("projects").replaceChildren();
  const all = make("option", "", "All projects");
  all.value = "all";
  $("projects").append(all);
  for (const p of data.projects) {
    const o = make("option", "", p.title);
    o.value = p.id;
    $("projects").append(o);
  }
  $("dock-projects").replaceChildren(...[...$("projects").options].map((o) => o.cloneNode(true)));
  if (project !== "all" && !data.projects.some((p) => p.id === project))
    project = "all";
  render();
}
function revealHash() {
  if (!location.hash) return;
  let id;
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  if (id === "cut") {
    $("current").scrollIntoView();
    return;
  }
  const found = [...$("list").children].find((el) => el.dataset.id === id);
  if (found) {
    found.open = true;
    open.add(found.dataset.key);
    found.scrollIntoView({ block: "start" });
    rememberOpen();
  }
}
function selectProject(value) {
  project = value;
  location.hash = "";
  syncURL(false);
  render();
  window.scrollTo(0, 0);
}
$("projects").addEventListener("change", () => selectProject($("projects").value));
$("dock-projects").addEventListener("change", () => selectProject($("dock-projects").value));
$("search").addEventListener("input", () => {
  query = $("search").value;
  syncURL();
  render();
});
$("collapse").addEventListener("click", () => {
  for (const row of $("list").children) row.open = false;
});
$("clear").addEventListener("click", () => {
  query = "";
  selected.clear();
  $("search").value = "";
  syncURL();
  render();
});
$("close-lightbox").addEventListener("click", () => $("lightbox").close());
$("lightbox").addEventListener("click", (e) => {
  if (e.target === $("lightbox")) $("lightbox").close();
});
addEventListener("popstate", () => {
  const p = new URLSearchParams(location.search);
  project = p.get("project") || "all";
  query = p.get("q") || "";
  selected = new Set(p.getAll("tag"));
  $("search").value = query;
  render();
  revealHash();
});
addEventListener("hashchange", revealHash);
let copiedReference = "", copyMessage = "", copyTimer;
function frameReference() {
  const track = player.track;
  if (!track?.video) return null;
  const frame = player.frame;
  return {
    frame,
    text: [
      `Project: ${track.projectTitle || track.project || "WIP"}`,
      `Clip: ${track.title || "Untitled clip"}${track.version != null ? ` (v${track.version})` : ""}`,
      `Frame: ${frame} (zero-based, ${player.fps} fps)`,
      `Media: ${new URL(track.video, location.href).href}`,
    ].join("\n"),
  };
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Older browsers and restricted clipboard contexts can still allow a
    // copy initiated directly by the user's click, including in fullscreen.
    const focus = document.activeElement;
    const field = make("textarea");
    field.value = text;
    field.readOnly = true;
    field.style.cssText = "position:fixed;opacity:0;pointer-events:none;top:0;left:0";
    (document.fullscreenElement || document.body).append(field);
    try {
      field.select();
      if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
    } finally {
      field.remove();
      focus?.focus({ preventScroll: true });
    }
  }
}
$("copy-frame").addEventListener("click", async () => {
  // Snapshot the selected clip/frame before the asynchronous clipboard write.
  const reference = frameReference();
  if (!reference) return;
  let message;
  try {
    await copyText(reference.text);
    message = " · Copied";
  } catch {
    message = " · Copy failed — try again";
  }
  copiedReference = reference.text;
  copyMessage = message;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copiedReference = ""; tickUI(); }, 2000);
  tickUI();
});
const tickUI = () => {
  const t = player.track,
    has = !!t,
    playing = player.playing;
  $("play").disabled = !has;
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("seek").disabled = !has;
  $("back").disabled = !has;
  $("forward").disabled = !has;
  $("frame-back").disabled = !t?.video;
  $("frame-forward").disabled = !t?.video;
  $("frame-back").title = `Previous frame · ${player.fps} fps (,)`;
  $("frame-forward").title = `Next frame · ${player.fps} fps (.)`;
  $("show-preview").disabled = !t?.video;
  $("theatre").disabled = !t?.video;
  if (!player.preview && previewWindow.theatre) previewWindow.setTheatre(false);
  $("theatre").setAttribute("aria-pressed", String(previewWindow.theatre));
  $("theatre").setAttribute("aria-label", previewWindow.theatre ? "Exit theatre mode" : "Enter theatre mode");
  $("theatre").title = previewWindow.theatre ? "Exit theatre mode" : "Theatre mode";
  $("hide-preview").setAttribute("aria-label", previewWindow.theatre ? "Return to mini player" : "Hide video preview");
  updateTrackSwitch();
  $("repeat").setAttribute("aria-pressed", String(player.repeat));
  const repeatTip = player.repeat ? "Repeating · turn off" : "Repeat off · turn on";
  if ($("repeat-tip").textContent !== repeatTip)
    $("repeat-tip").textContent = repeatTip;
  $("show-preview").setAttribute("aria-pressed", String(player.preview));
  $("show-preview").setAttribute(
    "aria-label",
    player.preview ? "Hide video preview" : "Show video preview",
  );
  $("now-title").textContent = t?.title || "Nothing playing";
  const chapter = (t?.chapters || [])
    .filter((c) => c.t <= player.time)
    .at(-1)?.label;
  $("now-subtitle").textContent =
    player.error ||
    [t?.projectTitle, chapter].filter(Boolean).join(" · ") ||
    "Choose something to play";
  $("elapsed").textContent = fmt(player.time);
  $("duration").textContent = fmt(player.duration);
  $("seek").max = player.duration || 100;
  if (!seeking) $("seek").value = player.time;
  $("seek").setAttribute(
    "aria-valuetext",
    `${fmt(player.time)} of ${fmt(player.duration)}`,
  );
  const ln = t?.lines?.find((l) => l.t0 <= player.time && l.t1 > player.time);
  const reference = frameReference();
  $("lyric").textContent = ln?.text || (t?.songEnd && player.time > t.songEnd ? "End screen" : "");
  $("lyric").hidden = !$("lyric").textContent;
  $("copy-frame").hidden = !reference;
  if (reference) {
    $("frame-number").textContent = reference.frame;
    $("frame-rate").textContent = `· ${player.fps} fps`;
    $("copy-frame").setAttribute("aria-label", `Copy ${t.title || "clip"}, frame ${reference.frame}`);
  }
  const notice = reference?.text === copiedReference ? copyMessage : "";
  if ($("frame-copy-status").textContent !== notice) {
    $("frame-copy-status").textContent = notice;
    $("frame-copy-tip").textContent = notice ? notice.replace(/^ · /, "") : "Click to copy clip and frame";
    $("copy-frame").dataset.copied = String(!!notice);
  }
  if (!player.preview && document.fullscreenElement === $("preview"))
    document.exitFullscreen().catch(() => {});
  $("preview").hidden = !player.preview && !document.fullscreenElement;
  $("preview-title").textContent = t?.title || "";
  const vt = videoPosition(t, player.time);
  $("preview-message").textContent =
    player.preview && (vt < 0 || vt >= $("video").duration)
      ? "No picture at this point in the song"
      // A seek temporarily drops readyState even with a decoded picture still
      // on screen. Keep that picture unobscured while the next frame arrives.
      : player.preview && !player.hasPicture && $("video").readyState < 2
        ? "Loading picture…"
        : "";
  $("quality").hidden = !t?.lite;
  $("quality").textContent = player.quality === "720" ? "720p" : "1080p";
  const meta = JSON.stringify([t?.id, t?.version, t?.poster, player.duration]);
  if (meta !== lastMeta) {
    lastMeta = meta;
    if (!$("clip-picker").hidden) updateClipSelection();
    $("now-art").style.backgroundImage = t?.poster
      ? `url(${JSON.stringify(t.poster)})`
      : "";
    $("now-art").textContent = t?.poster ? "" : "♪";
    $("chapters").replaceChildren();
    for (const ch of t?.chapters || []) {
      const mark = make("i");
      mark.style.left = `${(ch.t / (player.duration || 1)) * 100}%`;
      $("chapters").append(mark);
    }
  }
};
player.addEventListener("change", tickUI);
tickUI();
$("play").addEventListener("click", () => player.toggle());
$("back").addEventListener("click", () => player.seek(player.time - 1));
$("forward").addEventListener("click", () => player.seek(player.time + 1));
$("frame-back").addEventListener("click", () => player.stepFrame(-1));
$("frame-forward").addEventListener("click", () => player.stepFrame(1));
$("repeat").addEventListener("click", () => {
  player.repeat = !player.repeat;
  player.update();
});
$("volume").value = player.volume;
$("volume").addEventListener("input", () => {
  player.volume = Number($("volume").value);
  player.update();
});
let lastVolume = 1;
$("mute").addEventListener("click", () => {
  if (player.volume > 0) {
    lastVolume = player.volume;
    player.volume = 0;
  } else player.volume = lastVolume;
  $("volume").value = player.volume;
  $("mute").setAttribute("aria-label", player.volume ? "Mute" : "Unmute");
  $("mute").textContent = player.volume ? "♪" : "∅";
  player.update();
});
$("seek").addEventListener("pointerdown", () => (seeking = true));
$("seek").addEventListener("input", () => {
  player.seek(Number($("seek").value));
});
$("seek").addEventListener("change", () => {
  seeking = false;
  player.seek(Number($("seek").value));
});
$("seek").addEventListener("pointerup", () => (seeking = false));
$("seek").addEventListener("pointermove", (event) => {
  if (!player.track) return;
  const rect = $("seek").getBoundingClientRect();
  const time = Math.max(
    0,
    Math.min(
      player.duration,
      ((event.clientX - rect.left) / rect.width) * player.duration,
    ),
  );
  const tip = $("seek-tip");
  tip.replaceChildren();
  const board = player.track.board;
  if (board?.src) {
    const i = Math.min(board.count - 1, Math.floor(time / board.step));
    const im = make("div", "thumb");
    Object.assign(im.style, {
      width: `${board.w}px`,
      height: `${board.h}px`,
      backgroundImage: `url(${JSON.stringify(board.src)})`,
      backgroundSize: `${board.cols * board.w}px ${board.rows * board.h}px`,
      backgroundPosition: `-${(i % board.cols) * board.w}px -${Math.floor(i / board.cols) * board.h}px`,
    });
    tip.append(im);
  }
  const ch = player.track.chapters?.filter((c) => c.t <= time).at(-1);
  const line = player.track.lines?.find((l) => l.t0 <= time && l.t1 > time);
  tip.append(make("div", "", `${fmt(time)}${ch ? " · " + ch.label : ""}`));
  if (line) tip.append(make("div", "", line.text));
  tip.hidden = false;
  tip.style.left = `${Math.max(0, Math.min(rect.width - 220, event.clientX - rect.left - 110))}px`;
});
$("seek").addEventListener("pointerleave", () => ($("seek-tip").hidden = true));
$("show-preview").addEventListener("click", () =>
  player.showPreview(!player.preview),
);
$("hide-preview").addEventListener("click", () => {
  if (previewWindow.theatre) { previewWindow.setTheatre(false); tickUI(); }
  else player.showPreview(false);
});
$("quality").addEventListener("click", () =>
  player.setQuality(player.quality === "720" ? "1080" : "720"),
);
async function fullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else {
    player.showPreview(true);
    try {
      await $("preview").requestFullscreen();
    } catch {
      player.error = "Fullscreen is unavailable in this browser.";
      player.update();
    }
  }
}
async function theatre() {
  if (document.fullscreenElement) await document.exitFullscreen();
  player.showPreview(true);
  previewWindow.setTheatre(!previewWindow.theatre);
  tickUI();
}
$("theatre").addEventListener("click", theatre);
$("video-fullscreen").addEventListener("click", fullscreen);
$("video").addEventListener("dblclick", theatre);
$("video").addEventListener("click", () => player.toggle());
document.addEventListener("fullscreenchange", () => {
  const fs = !!document.fullscreenElement;
  (fs ? $("preview") : document.body).append($("dock"));
  $("video-fullscreen").setAttribute(
    "aria-label",
    fs ? "Exit fullscreen" : "Enter fullscreen",
  );
  $("video-fullscreen").title = fs ? "Exit fullscreen" : "Fullscreen";
  $("video-fullscreen").querySelector("path").setAttribute("d", fs
    ? "M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5"
    : "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5");
  previewWindow.layout();
  awake();
  $("preview").classList.remove("hide-controls");
});
let idle;
const awake = () => {
  $("preview").classList.remove("hide-controls");
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (
      document.fullscreenElement &&
      player.playing &&
      !$("preview").contains(document.activeElement)
    )
      $("preview").classList.add("hide-controls");
  }, 2500);
};
$("preview").addEventListener("pointermove", awake);
$("preview").addEventListener("focusin", awake);
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const playerRange = e.target === $("seek") || e.target === $("volume");
  if (
    e.target.isContentEditable ||
    (e.target.closest("input,textarea,select") && !playerRange) ||
    $("lightbox").open
  )
    return;
  // Player sliders keep focus after scrubbing. Frame keys still operate the
  // transport; volume arrows and text fields keep their native behavior.
  if (e.target === $("volume") && e.key.startsWith("Arrow")) return;
  if (e.key === "/") {
    e.preventDefault();
    $("search").focus();
  } else if (
    (e.key === " " && (e.target === document.body || playerRange)) ||
    e.key.toLowerCase() === "k"
  ) {
    e.preventDefault();
    player.toggle();
  } else if (e.key === "Escape" && previewWindow.theatre && !document.fullscreenElement) {
    previewWindow.setTheatre(false); tickUI();
  } else if (e.key.toLowerCase() === "f" && player.track?.video) {
    e.preventDefault();
    e.shiftKey ? fullscreen() : theatre();
  }
  else if (e.key === ",") { e.preventDefault(); player.stepFrame(-1); }
  else if (e.key === ".") { e.preventDefault(); player.stepFrame(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); player.seek(player.time - (e.shiftKey ? 10 : 1)); }
  else if (e.key === "ArrowRight") { e.preventDefault(); player.seek(player.time + (e.shiftKey ? 10 : 1)); }
  awake();
});
try {
  await refresh();
  revealHash();
  if (STATIC) {
    $("connection").textContent = "The work behind the films";
  } else {
    const events = new EventSource(BASE + "api/events");
    events.addEventListener("change", () => refresh().catch(() => {}));
    events.addEventListener("open", () => {
      $("connection").textContent = "Live workspace";
      $("live-dot").classList.remove("off");
    });
    events.addEventListener("error", () => {
      $("connection").textContent = "Reconnecting…";
      $("live-dot").classList.add("off");
    });
  }
} catch (e) {
  $("notice").hidden = false;
  $("notice").textContent = `Could not open the workspace: ${e.message}`;
}
