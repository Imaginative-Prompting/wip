# Static exports and existing pages

[← WIP](../README.md)

The local viewer does not publish content. Static export is a separate operation
for a deliberately selected collection.

## Export a collection

`src/export.mjs` exposes `exportStatic(config, options)`. The `projects` option
must be a nonempty allowlist of project IDs; there is no implicit export-all
mode. For example, from a script in the WIP repository:

```js
import { config } from './src/store.mjs';
import { exportStatic } from './src/export.mjs';

const workspace = await config('../my-wip/wip.json');
const result = await exportStatic(workspace, {
  out: '../my-wip-site',
  projects: ['first-light'],
  mediaBase: '/media/',
});
```

The output contains the viewer and `workspace.json`, with local media URLs
rewritten to content-addressed keys. The returned result includes `uploads`,
which maps each key to its source file and byte length. Copy or upload those
files to your chosen media location separately. The exporter does not upload
them or deploy the site.

**Keep the returned upload manifest private:** it contains local source paths.
Never put it in the static site directory. The exporter removes internal entry
provenance from the public catalog and refuses private media paths and source
documents. Apply any workspace privacy policy before exporting, and inspect
images, video, audio, and metadata before publishing.

The exported app works at a site's root or below a path such as `/wip/`, without
the local server or live-update connection. A host serving large media should
support byte-range requests so playback can seek efficiently. Access control is
a hosting responsibility; a static export does not add a password gate.

The separate [Imaginative Prompting website repository](https://github.com/Imaginative-Prompting/ipwebsite)
shows one integration using Cloudflare Workers and private R2 media. It is
currently private and contains site-specific content and access controls.

## Import an existing WIP page

`tools/import-html.py` bridges older pages using `<details class="sec">`
sections. It preserves stable section IDs and content and rewrites relative
assets into configured media mounts.

Reimports skip unchanged sections. If an entry has been edited through the CLI,
a later legacy write is rejected as a conflict. Reconcile those changes before
continuing; do not regenerate a whole shared page. Keep legacy files as migration
history, and use the [CLI workflow](content.md) for new entries.
