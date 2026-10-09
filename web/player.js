export const fmt = (s) =>
  `${Math.floor(Math.max(0, s || 0) / 60)}:${String(Math.floor(Math.max(0, s || 0) % 60)).padStart(2, "0")}`;
export function durationOf(track, audioDuration, videoDuration) {
  return track?.duration || (track?.audio ? audioDuration : videoDuration) || 0;
}
export function videoPosition(track, time) {
  return time - (track?.offset || 0);
}
const allowed = (url) =>
  typeof url === "string" &&
  (/^\/media\//.test(url) || /^https?:\/\//.test(url));
export class Player extends EventTarget {
  constructor(audio, video) {
    super();
    this.audio = audio;
    this.video = video;
    this.track = null;
    this.playing = false;
    this.preview = false;
    this.repeat = true;
    this.quality = "720";
    this.time = 0;
    this.tail = null;
    this.error = "";
    this.epoch = 0;
    for (const m of [audio, video]) {
      m.addEventListener("loadedmetadata", () => {
        this.applyTime();
        this.update();
      });
      m.addEventListener("timeupdate", () => this.tick());
      m.addEventListener("ended", () => this.ended(m));
      m.addEventListener("error", () => {
        if (!m.getAttribute("src")) return;
        if (m === this.master) {
          this.error = "This media could not be loaded.";
          this.pause();
        } else {
          this.error = "Video unavailable. Audio continues.";
          this.update();
        }
      });
      m.addEventListener("canplay", () => {
        if (this.playing && m === video && this.preview) this.syncVideo(true);
      });
    }
    this.timer = setInterval(() => this.tick(), 150);
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("wip-player") || "{}");
    } catch {}
    this.repeat = saved.repeat ?? true;
    this.quality = saved.quality || "720";
    this.volume = saved.volume ?? 1;
    if (
      saved.track &&
      (saved.track.audio || saved.track.video) &&
      [saved.track.audio, saved.track.video, saved.track.lite]
        .filter(Boolean)
        .every(allowed)
    )
      this.load(saved.track, {
        time: saved.time || 0,
        autoplay: false,
        preview: false,
      });
    addEventListener("pagehide", () => this.save());
    this.configureSession();
  }
  get master() {
    return this.track?.audio ? this.audio : this.video;
  }
  get duration() {
    return durationOf(
      this.track,
      Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      Number.isFinite(this.video.duration) ? this.video.duration : 0,
    );
  }
  set volume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this._volume;
    this.video.volume = this._volume;
  }
  get volume() {
    return this._volume;
  }
  load(track, { time = 0, autoplay = true, preview = !!track.video } = {}) {
    if (![track.audio, track.video, track.lite].filter(Boolean).every(allowed))
      return;
    this.epoch++;
    this.audio.pause();
    this.video.pause();
    this.playing = false;
    this.tail = null;
    this.error = "";
    this.track = { ...track };
    this.time = Math.max(0, time);
    this.preview = preview && !!track.video;
    this.audio.removeAttribute("src");
    this.video.removeAttribute("src");
    this.audio.load();
    this.video.load();
    if (track.audio) this.audio.src = track.audio;
    this.video.muted = !!track.audio;
    if (track.video)
      this.video.src =
        this.quality === "720" && track.lite ? track.lite : track.video;
    this.video.poster = track.poster || "";
    this.applyTime();
    this.configureSession();
    this.update();
    if (autoplay) this.play();
  }
  applyTime() {
    if (!this.track) return;
    if (this.track.audio && this.audio.readyState >= 1) {
      const d = this.audio.duration;
      this.audio.currentTime = Math.min(
        this.time,
        Number.isFinite(d) ? Math.max(0, d - 0.001) : this.time,
      );
    }
    const vt = videoPosition(this.track, this.time);
    if (this.track.video && this.video.readyState >= 1)
      this.video.currentTime = Math.max(
        0,
        Math.min(
          vt,
          Number.isFinite(this.video.duration)
            ? Math.max(0, this.video.duration - 0.001)
            : vt,
        ),
      );
  }
  async play() {
    if (!this.track) return;
    if (this.duration && this.time >= this.duration - 0.03) this.seek(0);
    this.error = "";
    this.playing = true;
    const epoch = this.epoch;
    const ad = this.audio.duration;
    try {
      if (this.track.audio && Number.isFinite(ad) && this.time >= ad - 0.02) {
        this.tail = { t: this.time, at: performance.now() };
      } else {
        await this.master.play();
        if (epoch !== this.epoch) return;
      }
      if (this.track.audio) this.syncVideo(true);
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.playing = false;
      this.error =
        e.name === "NotAllowedError"
          ? "Press play to start listening."
          : "Playback interrupted. Press play to retry.";
    }
    this.update();
  }
  pause() {
    this.tick();
    this.playing = false;
    this.tail = null;
    this.audio.pause();
    this.video.pause();
    this.update();
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
  seek(t) {
    if (!this.track) return;
    this.time = Math.max(
      0,
      Math.min(Number(t) || 0, this.duration || Infinity),
    );
    this.tail = null;
    this.applyTime();
    if (this.playing) {
      if (
        this.track.audio &&
        Number.isFinite(this.audio.duration) &&
        this.time >= this.audio.duration - 0.02
      ) {
        this.audio.pause();
        this.tail = { t: this.time, at: performance.now() };
      } else this.master.play().catch(() => {});
      this.syncVideo(true);
    }
    this.update();
  }
  showPreview(on) {
    this.preview = !!on && !!this.track?.video;
    if (this.track?.audio) {
      if (this.preview) this.syncVideo(true);
      else this.video.pause();
    }
    this.update();
  }
  setQuality(q) {
    this.quality = q;
    if (!this.track?.video) return;
    const src =
      q === "720" && this.track.lite ? this.track.lite : this.track.video;
    const epoch = this.epoch;
    this.video.src = src;
    this.video.addEventListener(
      "loadedmetadata",
      () => {
        if (epoch !== this.epoch) return;
        this.applyTime();
        if (this.playing) {
          if (this.track.audio) this.syncVideo(true);
          else this.video.play().catch(() => {});
        }
      },
      { once: true },
    );
    this.update();
  }
  syncVideo(force = false) {
    if (
      !this.track?.audio ||
      !this.track.video ||
      !this.preview ||
      this.video.readyState < 1
    )
      return;
    const t = videoPosition(this.track, this.time);
    if (
      t < 0 ||
      (Number.isFinite(this.video.duration) && t >= this.video.duration)
    ) {
      this.video.pause();
      return;
    }
    const drift = this.video.currentTime - t;
    if ((force && Math.abs(drift) > 0.02) || Math.abs(drift) > 0.18) {
      this.video.currentTime = t;
      this.video.playbackRate = 1;
    } else
      this.video.playbackRate =
        Math.abs(drift) > 0.035
          ? Math.max(0.96, Math.min(1.04, 1 - drift * 0.2))
          : 1;
    if (this.playing && this.video.paused) this.video.play().catch(() => {});
  }
  ended(media) {
    if (!this.playing || media !== this.master) return;
    if (this.track.audio && this.duration > this.audio.duration + 0.05) {
      this.time = this.audio.duration;
      this.tail = { t: this.time, at: performance.now() };
    } else this.finish();
  }
  finish() {
    if (this.repeat) {
      this.time = 0;
      this.tail = null;
      this.applyTime();
      this.play();
    } else {
      this.time = this.duration;
      this.playing = false;
      this.tail = null;
      this.audio.pause();
      this.video.pause();
      this.update();
    }
  }
  tick() {
    if (!this.track) return;
    if (this.playing) {
      if (this.tail)
        this.time = this.tail.t + (performance.now() - this.tail.at) / 1000;
      else if (this.master.readyState >= 1 && !this.master.seeking)
        this.time = this.master.currentTime;
      if (this.duration && this.time >= this.duration - 0.01) {
        this.finish();
        return;
      }
      this.syncVideo();
    }
    this.update(false);
  }
  update(save = true) {
    this.dispatchEvent(new Event("change"));
    if (save || !this.savedAt || Date.now() - this.savedAt > 2000) this.save();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = this.playing
        ? "playing"
        : "paused";
      if (this.duration > 0)
        try {
          navigator.mediaSession.setPositionState({
            duration: this.duration,
            position: Math.min(this.duration, this.time),
            playbackRate: 1,
          });
        } catch {}
    }
  }
  save() {
    this.savedAt = Date.now();
    try {
      localStorage.setItem(
        "wip-player",
        JSON.stringify({
          track: this.track,
          time: this.time,
          repeat: this.repeat,
          quality: this.quality,
          volume: this.volume,
        }),
      );
    } catch {}
  }
  configureSession() {
    if (!("mediaSession" in navigator)) return;
    if (this.track)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.track.title,
        artist: this.track.projectTitle || "WIP",
      });
    const handlers = {
      play: () => this.play(),
      pause: () => this.pause(),
      seekbackward: (d) => this.seek(this.time - (d.seekOffset || 10)),
      seekforward: (d) => this.seek(this.time + (d.seekOffset || 10)),
      seekto: (d) => this.seek(d.seekTime),
    };
    for (const [name, fn] of Object.entries(handlers))
      try {
        navigator.mediaSession.setActionHandler(name, fn);
      } catch {}
  }
}
