import test from "node:test";
import assert from "node:assert/strict";
import { Player } from "../web/player.js";

class Media extends EventTarget {
  duration = 12;
  readyState = 0;
  paused = true;
  seeks = [];
  time = 0;
  set currentTime(value) {
    this.time = value;
    this.seeks.push(value);
    // Browsers temporarily lose HAVE_CURRENT_DATA while decoding a seek.
    this.readyState = 1;
  }
  get currentTime() { return this.time; }
  requestVideoFrameCallback(callback) { this.present = callback; }
  load() { this.readyState = 0; }
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  removeAttribute(name) { delete this[name]; }
  getAttribute(name) { return this[name]; }
  decode() {
    this.readyState = 2;
    this.dispatchEvent(new Event("loadeddata"));
  }
}
function setup(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "addEventListener");
  Object.defineProperty(globalThis, "addEventListener", { value() {}, configurable: true });
  const audio = new Media(), video = new Media();
  const player = new Player(audio, video);
  t.after(() => {
    clearInterval(player.timer);
    if (descriptor) Object.defineProperty(globalThis, "addEventListener", descriptor);
    else delete globalThis.addEventListener;
  });
  player.load({ id: "cut", video: "/media/test/cut.mp4", lite: "/media/test/lite.mp4", audio: "/media/test/song.wav", fps: 24 }, { autoplay: false });
  audio.decode();
  video.decode();
  return { player, audio, video };
}

test("paused frame steps seek once and retain the decoded picture during repeated seeks", (t) => {
  const { player, audio, video } = setup(t);
  player.seek(3);
  video.decode();
  player.showPreview(false);
  video.seeks.length = 0;
  player.stepFrame(1);
  assert.equal(player.preview, true);
  assert.equal(player.playing, false);
  assert.equal(audio.currentTime, 73 / 24);
  assert.deepEqual(video.seeks, [73 / 24 + .001]);
  assert.equal(video.readyState, 1);
  assert.equal(player.hasPicture, true);
  // A second press can arrive before the first seek has decoded.
  player.stepFrame(1);
  player.stepFrame(-1);
  assert.deepEqual(video.seeks, [73 / 24 + .001, 74 / 24 + .001, 73 / 24 + .001]);
  assert.equal(audio.currentTime, 73 / 24);
  assert.equal(player.hasPicture, true);
});

test("the initial loading state resets for quality changes and new tracks, not ordinary seeks", (t) => {
  const { player, video } = setup(t);
  assert.equal(player.hasPicture, true);
  player.seek(8);
  assert.equal(player.hasPicture, true);
  player.setQuality("1080");
  assert.equal(player.hasPicture, false);
  video.decode();
  assert.equal(player.hasPicture, true);
  player.load({ id: "other", video: "/media/test/other.mp4" }, { autoplay: false });
  assert.equal(player.hasPicture, false);
  video.decode();
  assert.equal(player.hasPicture, true);
});


test("frame references follow the presented picture on pause and the containing frame after a seek", (t) => {
  const { player, video } = setup(t);
  player.seek(3.03);
  assert.equal(player.stepping, false);
  assert.equal(player.frame, 72); // 3.03 is inside frame 72 at 24 fps, not 73.
  video.decode();
  video.present(0, { mediaTime: 73 / 24 });
  assert.equal(player.frame, 73); // Prefer the picture actually presented.
  player.stepFrame(1);
  assert.equal(player.frame, 74); // Step from that picture, not a lagging audio clock.
  player.seek(5.03);
  assert.equal(player.frame, 120); // An old decoded frame cannot survive a seek.
  video.present(0, { mediaTime: 5 });
  player.showPreview(false);
  player.seek(6.03);
  assert.equal(player.frame, 144); // A hidden preview must not pin the counter.
  player.seek(12);
  assert.equal(player.frame, 287); // Duration is past the final frame boundary.
});

test("frame references for song-clock excerpts are relative to the clip", (t) => {
  const { player } = setup(t);
  player.track.offset = 42;
  player.track.duration = 120;
  player.showPreview(false);
  player.seek(43.03);
  assert.equal(player.frame, 24);
  player.showPreview(true);
  assert.equal(player.frame, 24);
});


test("pausing to annotate during a pending play request does not block drawing with an error", async (t) => {
  const { player, audio } = setup(t);
  let reject;
  audio.play = () => new Promise((_, fail) => { reject = fail; });
  const playback = player.play();
  player.pause();
  reject(new DOMException("Interrupted by pause", "AbortError"));
  await playback;
  assert.equal(player.playing, false);
  assert.equal(player.error, "");
  assert.equal(player.hasPicture, true);
});
