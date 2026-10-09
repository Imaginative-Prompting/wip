import { readFile, readdir, mkdir, rename, writeFile, unlink, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const appRoot = fileURLToPath(new URL('../', import.meta.url));
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(value);
export async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function config(file) {
  const configFile = path.resolve(file || path.join(appRoot, 'example/wip.json'));
  const c = await json(configFile);
  const base = path.dirname(configFile);
  c.content = path.resolve(base, c.content || 'content');
  c.mounts = Object.fromEntries(Object.entries(c.mounts || {}).map(([k, v]) => {
    if (!slug(k)) throw new Error(`Invalid media mount: ${k}`);
    return [k, path.resolve(base, v)];
  }));
  return { ...c, configFile };
}
export async function inside(root, relative) {
  if (relative.includes('\0')) throw new Error('Invalid path');
  const base = await realpath(root);
  const target = await realpath(path.resolve(base, relative));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('Path outside configured root');
  return target;
}
export async function atomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await rename(tmp, file);
  } finally { await unlink(tmp).catch(() => {}); }
}
function identifier(id) { if (!slug(id)) throw new Error(`Invalid ID: ${id}`); return id; }
export function projectDir(c, id) { return path.join(c.content, identifier(id)); }
export async function mutate(file, expected, make) {
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let handle;
  try { handle = await open(lock, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('Another writer owns this entry. Retry after it finishes.'); throw e; }
  try {
    let previous = null;
    try { previous = await json(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (previous && expected !== previous.revision) throw new Error(`Revision conflict: expected ${expected ?? '(none)'}, current ${previous.revision}. Read the entry and retry with its revision.`);
    if (!previous && expected != null && expected !== 0) throw new Error('Revision conflict: entry does not exist');
    const value = await make(previous);
    value.revision = (previous?.revision || 0) + 1;
    await atomic(file, value);
    return value;
  } finally { await handle.close(); await unlink(lock); }
}
export function validateEntry(e) {
  identifier(e.id);
  if (!e.title || typeof e.title !== 'string') throw new Error('Entry needs a title');
  if (!Array.isArray(e.tags) || e.tags.some(t => typeof t !== 'string' || !t.trim())) throw new Error('tags must be a list of nonempty strings');
  if (!['markdown', 'html'].includes(e.format || 'markdown')) throw new Error('format must be markdown or html');
  if (typeof e.body !== 'string') throw new Error('body must be text');
  if (!Number.isFinite(Date.parse(e.updatedAt))) throw new Error('updatedAt must be an ISO date');
  if (e.media) for (const m of e.media) {
    if (!['audio', 'video', 'image'].includes(m.type) || !safeURL(m.src)) throw new Error('Invalid media reference');
    if (m.offset != null && (!Number.isFinite(m.offset) || m.offset < 0)) throw new Error('Invalid media offset');
  }
}
export function safeURL(url) { return typeof url === 'string' && (/^\/media\/[a-z0-9_-]+\//.test(url) || /^https?:\/\//.test(url)); }
export function validateTrack(track) {
  if (!track || typeof track.title !== 'string' || !track.title.trim()) throw new Error('Track needs a title');
  if (!track.audio && !track.video) throw new Error('Track needs audio or video');
  for (const k of ['audio', 'video', 'lite', 'poster']) if (track[k] && !safeURL(track[k])) throw new Error(`Invalid ${k} URL`);
  for (const k of ['duration', 'songEnd', 'offset']) if (track[k] != null && (!Number.isFinite(track[k]) || track[k] < 0)) throw new Error(`Invalid ${k}`);
}
export async function upsert(c, project, entry, expected) {
  validateEntry(entry);
  const dir = projectDir(c, project);
  await json(path.join(dir, 'project.json'));
  return mutate(path.join(dir, 'entries', `${entry.id}.json`), expected, old => ({ ...entry, createdAt: old?.createdAt || entry.createdAt || entry.updatedAt }));
}
export async function setCurrent(c, project, track, expected) {
  validateTrack(track);
  await json(path.join(projectDir(c, project), 'project.json'));
  return mutate(path.join(projectDir(c, project), 'current.json'), expected, () => track);
}
export async function catalog(c) {
  const projects = [], errors = [];
  try { errors.push(...(await json(path.join(c.content, '_bridge.json'))).errors); } catch (e) { if (e.code !== 'ENOENT') errors.push('Could not read legacy bridge status'); }
  for (const d of await readdir(c.content, { withFileTypes: true })) {
    if (!d.isDirectory() || !slug(d.name)) continue;
    try {
      const dir = projectDir(c, d.name), p = await json(path.join(dir, 'project.json'));
      if (p.id !== d.name) throw new Error('Project ID does not match directory');
      const entries = [];
      for (const name of await readdir(path.join(dir, 'entries'))) {
        if (!name.endsWith('.json')) continue;
        try { const e = await json(path.join(dir, 'entries', name)); validateEntry(e); entries.push(e); }
        catch (e) { errors.push(`${d.name}/${name}: ${e.message}`); }
      }
      let current = null;
      try { current = await json(path.join(dir, 'current.json')); validateTrack(current); }
      catch (e) { if (e.code !== 'ENOENT') errors.push(`${d.name}/current: ${e.message}`); }
      entries.sort((a, b) => (a.order ?? -1) - (b.order ?? -1) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      projects.push({ ...p, current, entries });
    } catch (e) { errors.push(`${d.name}: ${e.message}`); }
  }
  projects.sort((a, b) => (a.order || 0) - (b.order || 0));
  return { title: c.title || 'WIP', projects, errors };
}
export async function validate(c) {
  const data = await catalog(c), errors = [...data.errors], missing = [];
  const urls = new Set();
  for (const p of data.projects) {
    for (const t of [p.song, p.current]) if (t) {
      try { validateTrack(t); } catch (e) { errors.push(`${p.id}: ${e.message}`); }
      for (const k of ['audio', 'video', 'lite', 'poster']) if (t[k]) urls.add(t[k]);
      if (t.board?.src) urls.add(t.board.src);
    }
    for (const e of p.entries) {
      for (const m of e.media || []) urls.add(m.src);
      for (const m of e.body.matchAll(/(?:src|href|poster)=["'](\/media\/[^"']+)["']/g)) urls.add(m[1].replaceAll('&amp;', '&'));
      for (const m of e.body.matchAll(/\]\((\/media\/[^\s)]+)\)/g)) urls.add(m[1]);
    }
  }
  for (const url of urls) {
    if (!url.startsWith('/media/')) continue;
    try {
      const parts = decodeURIComponent(new URL(url, 'http://local').pathname).slice(7).split('/');
      const root = c.mounts[parts.shift()];
      if (!root) throw new Error('unknown mount');
      const file = await inside(root, parts.join('/'));
      if (!(await stat(file)).isFile()) throw new Error('not a file');
    } catch { missing.push(url); }
  }
  return { projects: data.projects.length, entries: data.projects.reduce((n, p) => n + p.entries.length, 0), references: urls.size, errors, missing };
}
