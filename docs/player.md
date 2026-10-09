# Player and current cut

[← WIP](../README.md)

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

## Save the current cut

Save the track object above in a working JSON file. For the first cut:

```sh
node bin/wip.mjs current --config ../my-wip/wip.json \
  --project my-project --file /tmp/cut.json
```

For an existing cut, read its stored revision before writing:

```sh
node bin/wip.mjs get --config ../my-wip/wip.json \
  --project my-project --id current
node bin/wip.mjs current --config ../my-wip/wip.json \
  --project my-project --file /tmp/cut.json --expected 3
```

Replace `3` with the revision actually returned. **Revision and version are
separate:** revision protects a file write; version labels a creative cut.
All media URLs in the example must point to your own existing files.

## Timing and browser behavior

A song-clock excerpt's offset is the clip's starting time within the project
song. An independently edited Short or clip should use its own soundtrack
unless its alignment has been verified. Loading a different media item selects
that item in the shared player.

Reloading restores the previous position with playback paused. A user gesture
may be required to begin playback. The browser's supported codecs determine
which media formats can play; validate the actual deliverable in the browser
you will use for review.
