import { allowedMedia } from "./playback-history.js";
export function trackFor(media, project, entry) {
  const base = { id: `${project.id}:${entry.id}:${media.src}`, title: media.title || entry.title,
    project: project.id, projectTitle: project.title, poster: media.poster,
    fps: media.fps || project.fps || project.current?.fps || 30 };
  if (media.type === "video" && media.songClock && project.song)
    return { ...base, audio: project.song.audio, video: media.src, offset: media.offset || 0,
      duration: project.song.duration || project.current?.duration,
      chapters: project.current?.chapters || project.song.chapters,
      lines: project.current?.lines || project.song.lines };
  return { ...base, [media.type === "audio" ? "audio" : "video"]: media.src };
}
export function collectClips(project, bodyMedia) {
  const seen = new Set(), clips = [];
  const added = (e) => e.dateKnown === false ? 0 : Date.parse(e.createdAt || e.updatedAt) || 0;
  const entries = project.entries.map((entry, index) => ({entry, index}))
    .sort((a,b) => added(b.entry) - added(a.entry) || (a.entry.order ?? a.index) - (b.entry.order ?? b.index));
  for (const {entry} of entries) {
    // Structured attachments retain song-clock offsets when also linked in prose.
    for (const media of [...(entry.media || []), ...bodyMedia(entry)]) {
      if (!["audio", "video"].includes(media.type) || !allowedMedia(media.src) || seen.has(media.src)) continue;
      seen.add(media.src);
      clips.push({ track: trackFor(media, project, entry), entry: entry.title,
        added: added(entry), dateKnown: !!added(entry), type: media.type });
    }
  }
  return clips;
}
