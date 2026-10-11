# Player and current cut

[← WIP](../README.md)

Every audio/video item opens in the bottom player. Paired tracks use `audio` as
the master clock and a muted `video` as the optional picture. Hiding the preview
pauses the video decoding while audio continues. A video without a separate
audio file uses its own soundtrack. Seeking and video quality changes retain the
timeline.

The dock's **Current cut** button (or **Soundtrack** for audio-only projects)
resumes the selected project's latest cut in one click. **Back to clip** returns
to its last clip at the position you left. Each project keeps separate cut and
clip positions, including across reloads. Use the project selector in the dock
to switch WIPs without stopping playback or losing the clip you were reviewing.
The chevron beside **Clip** opens a searchable, scrollable picker of every audio
and video attachment or media link in the project, including collapsed entries.
It sorts newest first by `createdAt` (falling back to the original entry date);
editing an entry does not move it ahead of newer work. Undated imports retain
their relative order at the end. Duplicate references to one media URL appear
once. Choosing a clip leaves the picker open for quick comparison.

Drag the mini preview by its title to snap it to any corner above the dock. Drag
the diagonal handle at its free corner to resize it; size and corner are saved.
The move handle also accepts arrow keys to choose a corner, and the resize
handle accepts arrow keys to grow or shrink the picture.

The dock's **Theatre mode** button fills the page while keeping browser chrome
visible. Use the fullscreen button at the **bottom right of the picture** for
true fullscreen; the same button exits. Both modes use the same player.

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

The −1 / +1 buttons and arrow keys seek one second; Shift+arrow seeks ten.
The frame buttons or comma / period pause and step the picture one frame at a
time, with a frame counter below the seek bar. Frame stepping uses the track's
`fps` (or a media attachment/project's `fps`), defaulting to 30. Supply the actual rate
for other footage, including fractional rates such as `24000 / 1001`. Song-clock
excerpts step on their video frames while keeping the audio clock aligned.
Lyrics stay centered below the seek bar, with the frame counter right-aligned
in its own fixed-width space. Equal-width digits and copy feedback in the tooltip
keep the footer still as values change. The counter is available whenever a video is selected,
including after a normal pause or seek. It uses the presented video frame when
available, and the clip timeline while the picture is hidden.
Click the frame counter (or focus it and press Enter/Space) to copy the project,
clip title/version, zero-based clip frame, FPS, and original media URL for an
agent. A brief “Copied” confirmation leaves the selected clip and frame in place.

The space bar / K toggle playback, F toggles
theatre mode, Shift+F toggles true fullscreen, Escape leaves theatre mode, and /
focuses search. Playback is restored paused after a reload, with the picture visibility retained.
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
