import {clipKey} from './markup-geometry.js';

// One row per exact frame, including the owner's and visitor's separate layers.
export function markedFrames(records,track){
  if(!track?.video)return [];
  const groups=new Map();
  for(const record of records){
    if(!record.drawings.length||clipKey(record.clip)!==clipKey(track))continue;
    const key=JSON.stringify([record.frame,record.fps]);
    if(!groups.has(key))groups.set(key,{frame:record.frame,fps:record.fps,records:[]});
    groups.get(key).records.push(record);
  }
  return [...groups.values()].sort((a,b)=>a.frame/a.fps-b.frame/b.fps||a.fps-b.fps);
}
