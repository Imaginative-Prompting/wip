# WIP

A quiet place to review work in progress. One list. One player.

WIP is a local, file-based review app for concepts, renders, audio, images, plans,
and whatever else you are making. Search and tags keep a long list useful. A
persistent player keeps the soundtrack running while you browse.

## Start

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open http://127.0.0.1:7353. The included First light example contains an original
motion loop, sound, a palette study, and a concept. No account or external service
is required. The app binds to localhost only.

```sh
node bin/wip.mjs serve --config /path/to/wip.json
node bin/wip.mjs help
npm test
npm run check
```

## Your workspace

Keep the app and your content separate. A config file points at content and the
folders containing your media. Paths are relative to the config file.

```json
{
  "title": "My workspace",
  "content": "content",
  "mounts": { "work": "../my-project" },
  "port": 7353
}
```

```text
content/
  my-project/
    project.json
    current.json
    entries/
      first-attempt.json
      direction.json
```

`project.json` contains `id`, `title`, `description`, an optional `order`, and an
optional `song` track. Each entry has its own file, so independent agents don't
rewrite a shared page. JSON supports multiline Markdown in `body`, arbitrary
tags, and media attachments. HTML is supported for importing existing material;
the viewer sanitizes it before display.

```json
{
  "id": "first-attempt",
  "title": "An opening worth trying",
  "summary": "A slower camera move and a warmer palette.",
  "tags": ["renders", "concepts"],
  "format": "markdown",
  "body": "## What changed\n\nThe camera holds before moving.\n\nStill checking the timing.",
  "updatedAt": "2026-10-09T12:00:00Z",
  "media": [{ "type": "video", "src": "/media/work/renders/opening.mp4" }]
}
```

`status` is optional written review status. Tags describe content, not approval.
New native entries sort newest first. Imported entries retain their original
ordering via `order`. Search includes written content, even when entries are
collapsed. Multiple tag selections match **any** selected tag.

## One player

Every audio/video item opens in the bottom player. Paired tracks use `audio` as
the master clock and a muted `video` as the optional picture. Hiding the preview
pauses the video decoding while audio continues. A video without a separate
audio file uses its own soundtrack. Seeking and video quality changes retain the
timeline. Fullscreen uses the same player, with its exit control at bottom right.

```json
{
  "title": "The current cut",
  "audio": "/media/work/song.wav",
  "video": "/media/work/cut.mp4",
  "lite": "/media/work/cut-720.mp4",
  "poster": "/media/work/poster.jpg",
  "duration": 186.5,
  "songEnd": 180.98,
  "version": 4,
  "chapters": [{ "t": 0, "label": "Opening" }],
  "lines": [{ "t0": 3, "t1": 6, "text": "A sung line" }]
}
```

`duration` may include an end screen after the song. The player carries the
picture through that silent tail before repeating. For a video excerpt on its
project's song clock, attach `songClock: true` and `offset` in seconds to its
entry media. Never guess an offset for an edited Short or a clip with its own mix.

The space bar / K toggle playback, arrow keys seek five seconds, F opens
fullscreen, and / focuses search. Playback is restored paused after a reload.
Browser autoplay rules still apply. New cut versions never replace an actively
playing version without an explicit selection.

## Agents

See [AGENTS.md](AGENTS.md) and [the content contract](docs/content.md). Use the CLI
for changes. Updating an existing file requires the revision you read; conflicts
are rejected. The browser refreshes content live, preserving playback.

## Existing HTML and public websites

`tools/import-html.py` imports old WIP `<details class="sec">` pages. It preserves
section IDs and content and rewrites relative assets into configured media mounts.
It can be rerun safely: unchanged sections are skipped, and native edits are
protected against subsequent legacy writes.

`src/export.mjs` exports an explicit project allowlist as a standalone static
site. It returns a separate upload manifest for content-addressed media. Keep
that manifest private; it contains local file paths. The exported app runs below
any path, including `/wip/`, without the local server or live-update connection.
No content is published by the local app itself.

The repository is currently private. Public release and licensing are owner decisions.
