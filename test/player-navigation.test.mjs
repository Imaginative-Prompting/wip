import test from "node:test";
import assert from "node:assert/strict";
import { PlaybackHistory, sameTrack } from "../web/playback-history.js";
import { miniRect, nearestCorner } from "../web/preview-window.js";
const track = (project, name, version = 1) => ({ project, id: `${project}:${name}`, title: name, video: `/media/test/${name}.mp4`, version });

test("cuts and clips keep independent positions across projects and reloads", () => {
  const h = new PlaybackHistory();
  h.remember(track("a", "clip"), 28, true);
  h.remember(track("a", "current"), 72, false);
  h.remember(track("b", "song"), 9, false);
  h.remember(track("b", "clip"), 15, true);
  const restored = new PlaybackHistory(JSON.parse(JSON.stringify(h)));
  assert.equal(restored.position(track("a", "clip")), 28);
  assert.equal(restored.position(track("a", "current")), 72);
  assert.equal(restored.get("a", "current").preview, false);
  assert.equal(restored.position(track("b", "song")), 9);
  assert.equal(restored.position(track("b", "clip")), 15);
  // Selecting another clip replaces only that project's parked clip.
  restored.remember(track("a", "next-clip"), 4, true);
  assert.equal(restored.position(track("a", "clip")), 0);
  assert.equal(restored.position(track("a", "current")), 72);
  assert.equal(restored.position(track("b", "clip")), 15);
});
test("explicitly choosing a new cut version resumes time but requires a reload", () => {
  const h = new PlaybackHistory();
  h.remember(track("a", "current"), 70, true);
  const next = track("a", "current", 2);
  assert.equal(h.position(next), 70);
  assert.equal(sameTrack(h.get("a", "current").track, next), false);
  assert.equal(sameTrack(next, { ...next, video: "/media/test/new.mp4" }), false);
});
test("history refuses unsafe saved sources and malformed storage", () => {
  assert.equal(new PlaybackHistory({}).toJSON().length, 0);
  const h = new PlaybackHistory([null, {track:{...track("a", "clip"), video:"file:///private/media.mp4"}}, {track:track("b", "clip"), time:-1}]);
  assert.equal(h.toJSON().length, 1);
  assert.equal(h.position(track("b", "clip")), 0);
});
test("all four snapped positions fit above the dock, including small viewports", () => {
  for (const viewport of [{width:1440,height:848},{width:390,height:660},{width:844,height:180}]) {
    for (const corner of ["top-left","top-right","bottom-left","bottom-right"]) {
      for (const width of [100,480,2000]) {
        const rect = miniRect(width, corner, viewport);
        assert.ok(rect.x >= 0 && rect.y >= 0);
        assert.ok(rect.x + rect.width <= viewport.width + .001);
        assert.ok(rect.y + rect.height <= viewport.height + .001);
        assert.ok(Math.abs(rect.width / rect.height - 16 / 9) < .001);
      }
    }
  }
});
test("drag release snaps according to the preview center in the available area", () => {
  const vp = {width:1440,height:848};
  for (const [x,y,corner] of [[0,0,"top-left"],[1100,0,"top-right"],[0,650,"bottom-left"],[1100,650,"bottom-right"]])
    assert.equal(nearestCorner({x,y,width:300,height:169},vp),corner);
});
