import { readFile } from 'node:fs/promises';

export const mediaRefs = (value) => [...new Set([...JSON.stringify(value).matchAll(/\/media\/[a-z0-9_-]+\/[^\s"'<>\\)]+/g)].map(m => canonical(m[0].replaceAll('&amp;','&'))))];
export function canonical(ref) { return decodeURIComponent(new URL(ref,'http://local').pathname); }
export async function policy(c) { return c.privacy ? JSON.parse(await readFile(c.privacy,'utf8')) : {}; }
export function disallowed(ref,p) {
 const url=canonical(ref);
 return (p.blockedMedia || []).some(r=>canonical(r)===url) || (p.blockDocuments && url.startsWith('/media/') && !/\.(mp4|webm|mp3|m4a|wav|avif|png|jpe?g|webp|gif|svg)$/i.test(url));
}
export function scrub(value,p) {
 if(typeof value==='string') { for(const r of p.replacements || []) value=value.replace(new RegExp(r.pattern,'gi'),r.replacement);return value; }
 if(Array.isArray(value)) return value.map(v=>scrub(v,p));
 if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='legacy').map(([k,v])=>[k,scrub(v,p)]));
 return value;
}
export async function checkWrite(c,value) {
 const p=await policy(c);
 if(mediaRefs(value).some(ref=>disallowed(ref,p))) throw new Error('This content references a removed or private asset. Use a reviewed replacement.');
 if(JSON.stringify(scrub(value,p))!==JSON.stringify(scrub(value,{}))) throw new Error('This content contains text excluded by workspace privacy rules. Edit it before saving.');
}
export async function safeCatalog(c,data) {
 const p=await policy(c), clean=scrub(data,p);
 for(const project of clean.projects) {
   project.entries=project.entries.filter(e=> {
     if(!mediaRefs(e).some(ref=>disallowed(ref,p))) return true;
     clean.errors.push(`${project.id}/${e.id}: held for media privacy review`);return false;
   });
   for(const k of ['current','song']) if(project[k] && mediaRefs(project[k]).some(ref=>disallowed(ref,p))) {
     project[k]=null;clean.errors.push(`${project.id}/${k}: held for media privacy review`);
   }
 }
 return clean;
}
