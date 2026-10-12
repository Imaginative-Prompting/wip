# Draw on a frame

Hover over the video and choose the pencil. Playback pauses on the displayed
frame and **Marked frames** opens beside the picture. The bottom bar's marked-frame
button reopens the list at any time. The compact list shows only the playing clip
and version, in frame order. Owner and personal drawings on the same frame share
one thumbnail. Hover a frame and choose its trash icon to remove all your drawings
on it; **Undo** restores them. Published owner drawings remain read-only. Select a thumbnail to reopen that exact clip,
version and zero-based frame; changing the current cut does not move old markup.
Drawings hide during playback and on other frames.

- **Draw** keeps your rough input. Enable **Smooth stroke** for an editable cubic
  Bézier path. The original points remain in the file, so selecting the stroke
  and toggling smoothing off restores the rough line.
- **Select** (V) picks a stroke for moving or deleting. Smooth paths expose square
  anchors and round tangent handles. Drag an anchor to move its handles with it.
  Drag a tangent to keep both sides aligned; hold Option/Alt to adjust one side
  independently. Shape endpoints can be dragged after drawing.
- **Shapes** offers rectangle, ellipse, line and arrow. Shift constrains a square
  or circle, or snaps a line to 45-degree increments. Option/Alt draws from the
  centre. Both modifiers can be combined. These follow the
  [Photoshop conventions](https://www.adobe.com/learn/photoshop/web/adding-text-shapes-basics).
- **Stroke settings** changes colour, thickness and curve smoothing. Changing
  curve smoothing refits the selected stroke from its original rough points;
  undo returns to the previous hand-edited curve.
- ⌘/Ctrl Z undoes; ⌘/Ctrl Shift Z redoes. Delete removes the selected drawing.
  Escape cancels a gesture, clears selection, then leaves drawing mode. B returns
  to freehand. Frame-step controls still work while drawing.

Open the **Frame options** (•••) menu for backup, restore and export.
Use **Copy frame reference** to paste the clip, frame, FPS and annotation reference
into an agent conversation. **Save frame image** downloads the frame with its drawings.
Mini-player resizing, corner snapping, theatre and true fullscreen all preserve
alignment, including portrait footage with letterboxing.

## Local saves and agent access

Each marked frame is a JSON file:

```
<content>/<project>/annotations/<annotation-id>.json
```

The file holds a track snapshot, frame, FPS, a small JPEG of the actual frame,
and vector drawings. Coordinates use a 1000-unit frame width with a proportional
height; stroke widths use those same units. Freehand `points` are retained; when
`smooth` is enabled, `nodes` contains cubic `p`, `in` and `out` coordinates.
`revision` protects writes, independently of the film's creative `version`.

```sh
node bin/wip.mjs annotations --config /path/to/wip.json --project my-project
```

Agents can read these files and the thumbnail to interpret a user's drawing.
They should not erase or mark up the user's review as if it were their own.
Revising an existing annotation requires its current revision. The local API
accepts same-origin JSON PUTs at `/api/annotations` with `{record, expected}`;
content entries remain managed through the existing CLI. There are no public
write endpoints in static exports.

Saving first keeps a recovery copy in IndexedDB, then writes the workspace file
atomically. A failed server save remains in an outbox; **Retry saves** sends it
again. Independent concurrent drawing edits merge. Conflicting edits retain both
strokes and show a notice rather than silently dropping either person's work.
**Download all drawings** / **Restore drawings** also work across browsers. Storage errors
are shown; do not close a tab reporting “Not saved” before exporting a backup.

Removing a frame saves an empty drawing list with revision checks, so a delayed
write cannot silently resurrect the old drawing. Empty records are hidden from
the frame list; the file remains available for revision-safe undo.

Markup keeps references to old media and does not duplicate entire video files.
Keep draft media at immutable URLs. Local size/mtime fingerprints detect when a
file is replaced; the saved frame snapshot remains viewable if the original is
changed or unavailable. That snapshot is a review reference, not a full-resolution
video backup. New privacy exclusions also hide old annotations to excluded media.

## Public websites

Static exports save each visitor's drawings privately in that browser. Clearing
site data removes those private saves; download a backup to keep them elsewhere.
The optional `annotations.json` file contains published owner drawings. These are
read-only, visible to everyone, and never overwritten by a visitor's drawings.
A visitor can draw on the same frame in their own layer.

Publishing owner drawings is explicit: `exportStatic` accepts `annotationIds`
alongside its required project allowlist. Its default is an empty owner set.
Inspect every selected snapshot and its text before publication. Only the
allowlisted projects are eligible. No local drawings are automatically published.
To export frame images from cross-origin video, the media host must allow the
site origin with CORS and the video must use `crossorigin="anonymous"`.
