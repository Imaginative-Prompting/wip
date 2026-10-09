# Your workspace

[← WIP](../README.md)

Keep the application, review content, and production media separate. WIP reads
content from a folder you choose; a media mount points to existing files without
copying them into the app.

## Start with the example

From the WIP checkout, after `npm ci`:

```sh
cp -R example ../my-wip
node bin/wip.mjs serve --config ../my-wip/wip.json
```

Open http://127.0.0.1:7353. The copied example is yours to change. Keep only one
server on that port, or choose another with `--port 7355`.

## Configure content and media

`wip.json` paths are relative to the config file, not your shell's working
directory. A workspace can mount more than one media folder.

```json
{
  "title": "My workspace",
  "content": "content",
  "mounts": {
    "demo": "media",
    "work": "../my-project"
  },
  "port": 7353
}
```

Create the `../my-project` directory, or point `work` at an existing one. A file
at `../my-project/renders/opening.mp4` is referenced as
`/media/work/renders/opening.mp4`. The `demo` mount keeps the copied example
working until you replace it with your own work.

```text
my-wip/
├── wip.json
├── media/                       # Small included demo assets
└── content/
    └── my-project/
        ├── project.json         # Title, description, optional soundtrack
        ├── current.json         # Optional current cut
        └── entries/
            ├── direction.json
            └── opening.json
```

## Create a project and an entry

Run these commands from the application checkout:

```sh
node bin/wip.mjs project --config ../my-wip/wip.json \
  --id my-project --title "My project"
```

Save this entry as `/tmp/direction.json`:

```json
{
  "id": "direction",
  "title": "An opening worth trying",
  "summary": "A slower camera move and a warmer palette.",
  "tags": ["concepts", "plans"],
  "format": "markdown",
  "body": "## The idea\n\nHold on the first image before moving. Keep the earlier attempt for comparison.",
  "updatedAt": "2026-10-09T12:00:00Z",
  "media": []
}
```

Use the time of your actual edit in `updatedAt`, then create the entry:

```sh
node bin/wip.mjs put --config ../my-wip/wip.json \
  --project my-project --file /tmp/direction.json
node bin/wip.mjs validate --config ../my-wip/wip.json
```

New entries do not need `--expected`. Existing entries do: read with `get`, edit
a working copy, then pass the revision you read to `put --expected N`. Re-read
and reconcile a conflict; do not bypass it. The [content contract](content.md)
contains the full workflow and schema.

## Attach media

Add an attachment to an entry's `media` array:

```json
{
  "type": "video",
  "src": "/media/work/renders/opening.mp4",
  "title": "Opening — first pass",
  "poster": "/media/work/renders/opening.jpg"
}
```

Attachments can be `image`, `audio`, or `video`. Referenced files must exist.
For a complete paired soundtrack and picture, use a project's
[current cut](player.md).

## Check the workspace

```sh
node bin/wip.mjs list --config ../my-wip/wip.json
node bin/wip.mjs validate --config ../my-wip/wip.json
node bin/wip.mjs help
```

The server binds to localhost, exposes no write endpoints, and serves only
catalog-linked supported files within configured mounts. Symlinks cannot escape
a mount. Review media and text before sharing an [export](exporting.md).
