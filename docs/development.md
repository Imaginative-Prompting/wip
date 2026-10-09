# Development

[← WIP](../README.md)

Requires Node.js 22 or newer. Python 3 is needed for the legacy HTML importer and
its regression test. The application uses browser modules and Node's built-in
server and test runner; there is no frontend bundling step.

```sh
npm ci
npm test
npm run check
npm start
```

`npm test` checks content revisions and conflicts, private path handling, media
byte ranges, timing helpers, legacy import behavior, and static exports.
`npm run check` validates the bundled example and its media references.

## Source map

| Path | Responsibility |
| :--- | :--- |
| `bin/wip.mjs` | CLI entry point and commands |
| `src/store.mjs` | Workspace configuration, content catalog, atomic revision-checked writes |
| `src/server.mjs` | Local viewer, live updates, media serving and byte ranges |
| `src/privacy.mjs` | Workspace-specific exclusions and content checks |
| `src/export.mjs` | Allowlisted static export and private upload manifest |
| `web/app.js` | Project selection, search, tags, entries, and player controls |
| `web/player.js` | Playback clock, audio/video synchronization, repeat, and persistence |
| `web/app.css` | Layout, typography, focus, and hover behavior |
| `example/` | Self-contained First light workspace and original media |
| `test/` | Node test suite |

Read [AGENTS.md](../AGENTS.md) and [the design guide](design.md) before changing
the interface. Player changes also need real browser checks for playback,
seeking, repeat, preview toggling, navigation, fullscreen exit, and narrow screens.
Automated tests do not replace those checks.

## README screenshots

The screenshots are real browser captures, taken at 1440 × 960 CSS pixels:

- `images/wip-player.png`: select First light, play its current cut, pause at
  about five seconds, and leave the preview visible.
- `images/wip-concepts.png`: hide the video preview, select Concepts, and expand
  Start with a feeling.
- `images/wip-films.png`: the separately reviewed Imaginative Prompting website
  collection, with The Way I Look At You selected and its current cut visible.

Capture only the page viewport, with no desktop, address bar, credentials, or
private workspace content. The First light media is included in this repository;
the film screenshot documents a separate installation. Refresh screenshots when
the interface changes, and inspect every image before committing it.
