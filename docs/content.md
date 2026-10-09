# Content contract

Config: `content` is the project directory; `mounts` maps URL mount names to local
directories; `port` defaults to 7353. Media URLs use `/media/<mount>/<path>` or an
HTTP(S) URL. Symlinks cannot escape a mount. Private dotfolders, raw `capture/`,
`archive/` and `node_modules/` are not served. Only supported media/document types
are served; the app server has no write endpoints.

Project and entry IDs: lowercase letters, digits, hyphens, underscores; at most
120 characters. Project directories match their ID. Project titles are free text.

An entry requires `id`, `title`, `tags` (array), `body` (text), and `updatedAt`
(ISO timestamp). `format` defaults to `markdown`, or can be `html`. Optional:
`summary`, `status`, `createdAt`, `order`, and `media`. A media attachment has
`type` (`image`, `audio`, `video`), `src`, and optional `title`, `poster`,
`songClock` and `offset`. The CLI supplies `revision` and preserves `createdAt`.

```sh
node bin/wip.mjs project --config /path/wip.json --id demo --title "A new project"
node bin/wip.mjs put --config /path/wip.json --project demo --file /tmp/entry.json
node bin/wip.mjs get --config /path/wip.json --project demo --id first-attempt
node bin/wip.mjs put --config /path/wip.json --project demo --file /tmp/entry.json --expected 1
node bin/wip.mjs get --config /path/wip.json --project demo --id current
node bin/wip.mjs current --config /path/wip.json --project demo --file /tmp/track.json --expected 3
node bin/wip.mjs validate --config /path/wip.json
```

Omit `--expected` only when creating a new entry/current track. Writes acquire an
exclusive per-entry lock, check the expected revision, then rename a temporary
file atomically. A crash may leave a `.lock`; investigate the writer before
removing it. Invalid or missing media does not delete earlier content. `validate`
reports missing references and invalid entries and exits nonzero if either exists.

Imported entries carry a `legacy` fingerprint. The importer skips identical
source sections and rejects changes if a native writer has changed that entry.
Use the CLI for future edits; it replaces the legacy fingerprint with your native
entry. Legacy files remain historical migration input.
