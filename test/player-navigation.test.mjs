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

import { collectClips, trackFor } from "../web/clips.js";
import { frameTime } from "../web/player.js";
import { validateTrack, validateEntry } from "../src/store.mjs";
test("clip picker uses added dates, not edit dates, and retains undated import order", () => {
  const entries = [
    {id:"old",title:"Old revised",createdAt:"2026-01-01",updatedAt:"2026-10-10"},
    {id:"new",title:"New",createdAt:"2026-10-01",updatedAt:"2026-10-01"},
    {id:"undated",title:"Undated",updatedAt:"2026-10-11",dateKnown:false},
    {id:"same-day",title:"Same day import",updatedAt:"2026-10-01",order:0},
  ].map(e=>({...e,media:[{type:"video",src:`/media/test/${e.id}.mp4`}]}));
  const clips=collectClips({id:"p",title:"Project",entries},()=>[]);
  assert.deepEqual(clips.map(c=>c.entry),["Same day import","New","Old revised","Undated"]);
});
test("clip picker collects attachments and body media once, retaining song offsets", () => {
  const media={type:"video",src:"/media/test/excerpt.mp4",songClock:true,offset:42,fps:24};
  const p={id:"p",title:"Project",song:{audio:"/media/test/song.wav",duration:100},entries:[{id:"e",title:"Excerpt",updatedAt:"2026-10-01",media:[media]}]};
  const clips=collectClips(p,()=>[{...media,songClock:false},{type:"audio",src:"/media/test/mix.wav"},{type:"image",src:"/media/test/still.jpg"},{type:"video",src:"file:///private/clip.mp4"}]);
  assert.equal(clips.length,2);
  assert.equal(clips[0].track.offset,42);
  assert.equal(clips[0].track.audio,p.song.audio);
  assert.equal(clips[0].track.fps,24);
  assert.deepEqual(clips[0].track,trackFor(media,p,p.entries[0]));
});
test("frame stepping respects exact boundaries, fractional rates, offsets and video ends", () => {
  assert.equal(frameTime(1,1,30),31/30);
  assert.equal(frameTime(31/30,-1,30),1);
  assert.equal(frameTime(1.01,-1,30),29/30);
  assert.equal(frameTime(0,-1,30),0);
  assert.equal(frameTime(2,1,30,0,2),59/30);
  assert.equal(frameTime(42,1,24,42,3),42+1/24);
  assert.equal(frameTime(40,-1,24,42,3),42);
  const fps=24000/1001;
  assert.ok(Math.abs(frameTime(10/fps,1,fps)-11/fps)<1e-8);
});
test("invalid frame rates cannot enter tracks or attachments", () => {
  const track={title:"Cut",video:"/media/test/cut.mp4"};
  for(const fps of [0,-1,Infinity,241]) {
    assert.throws(()=>validateTrack({...track,fps}),/fps/);
    assert.throws(()=>validateEntry({id:"e",title:"Entry",body:"",tags:[],updatedAt:"2026-10-01",media:[{type:"video",src:track.video,fps}]}),/fps/);
  }
  validateTrack({...track,fps:24000/1001});
});
