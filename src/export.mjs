import { readFile, writeFile, mkdir, cp, stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appRoot, catalog, inside, atomic } from './store.mjs';

// The output contains only selected projects and content-addressed public media
// URLs. The upload manifest (with local source paths) is returned to the caller,
// never written into the website directory.
export async function exportStatic(c, {out, projects, mediaBase='/media/', transform=async p=>p, resolveMedia}={}) {
  if(!projects?.length)throw new Error('Export requires an explicit project allowlist');
  const all=await catalog(c);if(all.errors.length)throw new Error(all.errors.join('\n'));
  for(const id of projects)if(!all.projects.some(p=>p.id===id))throw new Error(`Unknown project: ${id}`);
  const selected=[];
  for(const id of projects)selected.push(await transform(structuredClone(all.projects.find(p=>p.id===id))));
  const clean={title:c.title||'WIP',errors:[],projects:selected.map(p=>({id:p.id,title:p.title,description:p.description,current:p.current?strip(p.current):null,song:p.song?strip(p.song):null,entries:p.entries.map(strip)}))};
  let serialized=JSON.stringify(clean);
  const refs=[...new Set([...serialized.matchAll(/\/media\/[a-z0-9_-]+\/[^\s"'<>\\)]+/g)].map(m=>m[0].replace(/&amp;/g,'&')))];
  const uploads=[],replacements=new Map();
  for(const ref of refs){
    const u=new URL(ref,'http://local');const parts=decodeURIComponent(u.pathname).slice(7).split('/');const mount=parts.shift();
    if(!c.mounts[mount])throw new Error(`Unknown media mount: ${mount}`);
    const original=await inside(c.mounts[mount],parts.join('/'));
    if(path.relative(await realpath(c.mounts[mount]),original).split(path.sep).some(p=>p.startsWith('.')||['archive','capture','node_modules'].includes(p)))throw new Error('Private media path refused');
    const source=resolveMedia?await resolveMedia(original):original;
    if(!source){replacements.set(ref,'#unavailable');continue;}
    const ext=path.extname(source).toLowerCase();
    if(!['.mp4','.webm','.mp3','.m4a','.wav','.avif','.png','.jpg','.jpeg','.webp','.gif','.svg'].includes(ext))throw new Error(`Export only review media, not documents or source: ${original}`);
    const h=createHash('sha256');for await(const chunk of createReadStream(source))h.update(chunk);
    const key=h.digest('hex').slice(0,32)+ext;
    if(!uploads.some(a=>a.key===key))uploads.push({key,source,bytes:(await stat(source)).size});
    replacements.set(ref,mediaBase.replace(/\/?$/,'/')+key+(u.hash||''));
  }
  // Longer refs first avoids prefix collisions; replace escaped HTML ampersands too.
  for(const [old,next] of [...replacements].sort((a,b)=>b[0].length-a[0].length))serialized=serialized.split(old).join(next).split(old.replaceAll('&','&amp;')).join(next);
  await mkdir(out,{recursive:true});
  await cp(path.join(appRoot,'web'),out,{recursive:true});
  await mkdir(path.join(out,'vendor'),{recursive:true});
  await cp(fileURLToPath(import.meta.resolve('marked')),path.join(out,'vendor/marked.js'));
  await cp(fileURLToPath(import.meta.resolve('dompurify')),path.join(out,'vendor/purify.js'));
  let index=await readFile(path.join(out,'index.html'),'utf8');
  index=index.replace('<html lang="en">','<html lang="en" data-mode="static">');
  await writeFile(path.join(out,'index.html'),index);
  await writeFile(path.join(out,'workspace.json'),serialized+'\n');
  return {projects:clean.projects.map(p=>({id:p.id,entries:p.entries.length})),uploads,bytes:uploads.reduce((s,a)=>s+a.bytes,0)};
}
function strip(value){const {legacy,revision,searchText,...rest}=value;return {...rest,revision:revision||1};}
