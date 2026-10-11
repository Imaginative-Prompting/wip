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
