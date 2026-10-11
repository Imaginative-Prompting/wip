export const allowedMedia = (url) =>
  typeof url === "string" && (/^\/media\//.test(url) || /^https?:\/\//.test(url));
export const trackKind = (track) =>
  track?.id === `${track?.project}:current` || track?.id === `${track?.project}:song`
    ? "current" : "clip";
export const sameTrack = (a, b) => !!a && !!b &&
  a.id === b.id && a.version === b.version && a.audio === b.audio && a.video === b.video;

// One parked cut and one parked clip per project. Browsing never changes these.
export class PlaybackHistory {
  constructor(saved = []) {
    this.slots = new Map();
    for (const item of Array.isArray(saved) ? saved : []) {
      const t = item?.track;
      if (t?.project && t.id && (t.audio || t.video) &&
          [t.audio, t.video, t.lite].filter(Boolean).every(allowedMedia))
        this.remember(t, item.time, item.preview);
    }
  }
  remember(track, time, preview) {
    if (!track?.project) return;
    this.slots.set(`${track.project}:${trackKind(track)}`, {
      track: { ...track }, time: Math.max(0, Number(time) || 0), preview: !!preview,
    });
  }
  get(project, kind) { return this.slots.get(`${project}:${kind}`); }
  position(track) {
    const saved = this.get(track.project, trackKind(track));
    return saved?.track.id === track.id ? saved.time : 0;
  }
  toJSON() { return [...this.slots.values()]; }
}
