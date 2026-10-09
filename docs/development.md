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

All README images are real browser captures of the public
[The Way I Look At You workspace](https://imaginativeprompting.com/wip/?project=the-way-i-look-at-you),
taken at 1440 × 960 CSS pixels:

- `images/wip-player.png`: play the current cut, seek to the Atlanta sequence
  around 2:41, pause, and leave its picture visible beside the production list.
- `images/wip-concepts.png`: hide the preview and select Concepts, leaving the
  real concept entries and persistent player visible.
- `images/wip-films.png`: search for Atlanta at dawn, expand the original city
  look test, and scroll to show its rendered district still and production notes.

Capture only the page viewport, with no desktop, address bar, credentials, or
private workspace content. These images document the reviewed film workspace;
the separate First light example remains the self-contained local starter.
Refresh screenshots when the interface changes, and inspect every image before
committing it. Do not substitute starter-demo screenshots for the film workspace.
