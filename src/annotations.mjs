import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { json, mutate, projectDir, slug, validateTrack, inside, hash } from './store.mjs';
import { checkWrite } from './privacy.mjs';

import { validateAnnotation } from "../web/markup-validation.js";
export { validateAnnotation };
const fail=message=>{throw new Error(message);};
export async function listAnnotations(c) {
  const records=[];
  for(const entry of await readdir(c.content,{withFileTypes:true})){
    if(!entry.isDirectory()||!slug(entry.name))continue;
    let files;try{files=await readdir(path.join(c.content,entry.name,'annotations'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    for(const file of files){if(!file.endsWith('.json'))continue;
      const a=await json(path.join(c.content,entry.name,'annotations',file));validateAnnotation(a);
      if(a.project!==entry.name||`${a.id}.json`!==file)fail('Annotation path mismatch');
      // A later privacy removal also hides previously saved annotations.
      try{await checkWrite(c,a);}catch{continue;}
      records.push(a);
    }
  }
  return records;
}
export async function sourceStamp(c,clip) {
  if(!clip.video.startsWith('/media/'))return null;
  try{const parts=decodeURIComponent(new URL(clip.video,'http://local').pathname).slice(7).split('/'),root=c.mounts[parts.shift()];
    const st=await stat(await inside(root,parts.join('/')));return hash([st.size,st.mtimeMs]);
  }catch{return 'unavailable';}
}
export async function saveAnnotation(c,a,expected,allowed) {
  validateAnnotation(a);await checkWrite(c,a);
  await json(path.join(projectDir(c,a.project),'project.json'));
  // A browser may annotate catalog media, or edit its already registered old draft.
  for(const field of ['video','audio','lite','poster'])if(a.clip[field]&&!allowed.has(a.clip[field]))fail('Clip is not in this workspace');
  const stamp=await sourceStamp(c,a.clip);
  return mutate(path.join(projectDir(c,a.project),'annotations',`${a.id}.json`),expected,old=>{
    if(old&&(old.clip.video!==a.clip.video||old.clip.version!==a.clip.version||old.frame!==a.frame||old.fps!==a.fps))fail('An annotation cannot change its clip or frame');
    const fields=['id','title','project','projectTitle','video','audio','lite','poster','version','fps','offset','duration','songEnd'];
    return {schema:1,id:a.id,project:a.project,clip:Object.fromEntries(fields.filter(k=>a.clip[k]!=null).map(k=>[k,a.clip[k]])),
      frame:a.frame,fps:a.fps,width:a.width,height:a.height,drawings:a.drawings.map(d=>({id:d.id,type:d.type,color:d.color,width:d.width,points:d.points,...(d.type==='pen'?{smooth:!!d.smooth,...(d.nodes?{nodes:d.nodes}:{} )}:{})})),
      thumbnail:a.thumbnail||'',createdAt:old?.createdAt||a.createdAt,updatedAt:new Date().toISOString(),sourceStamp:old?.sourceStamp||stamp};
  });
}
export function annotationRefs(records) {
  return records.flatMap(a=>['video','audio','lite','poster'].map(k=>a.clip[k]).filter(Boolean));
}
