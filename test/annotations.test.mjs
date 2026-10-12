import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {atomic,config,setCurrent,json} from '../src/store.mjs';
import {start} from '../src/server.mjs';
import {listAnnotations,saveAnnotation,validateAnnotation,sourceStamp} from '../src/annotations.mjs';
import {fittedBox,shapePoints,linePoints,smoothNodes,drawingPath,mergeDrawings,frameKey} from '../web/markup-geometry.js';
import {markedFrames} from '../web/markup-frames.js';
const drawing={id:'stroke',type:'pen',color:'#F0E442',width:4,points:[[1,2],[20,30],[40,20]]};
const record={schema:1,id:'frame-one',project:'demo',clip:{id:'demo:current',project:'demo',title:'Film',video:'/media/demo/film.mp4',fps:30,version:1},frame:60,fps:30,width:1000,height:562.5,drawings:[drawing],createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'};
async function setup(t){const root=await mkdtemp(path.join(os.tmpdir(),'wip-markup-test-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'content/demo/entries'),{recursive:true});await mkdir(path.join(root,'media'));await writeFile(path.join(root,'media/film.mp4'),'original frame');await atomic(path.join(root,'content/demo/project.json'),{id:'demo',title:'Film'});await atomic(path.join(root,'wip.json'),{content:'content',mounts:{demo:'media'}});const c=await config(path.join(root,'wip.json'));await setCurrent(c,'demo',record.clip);return {root,c};}
test('shape modifiers are measured in frame pixels; portrait letterboxing stays aligned',()=>{
 assert.deepEqual(shapePoints([20,30],[50,50],{shiftKey:true}),[[20,30],[50,60]]);
 assert.deepEqual(shapePoints([20,30],[50,50],{shiftKey:true,altKey:true}),[[-10,0],[50,60]]);
 const box=fittedBox({left:10,top:20,width:1600,height:900},9/16);assert.equal(box.width,506.25);assert.equal(box.height,900);assert.equal(box.left,556.875);
 const line=linePoints([0,0],[10,8],{shiftKey:true});assert.ok(Math.abs(line[1][0]-line[1][1])<1e-9);
});
test('optional smoothing retains rough input and exposes finite editable cubic handles',()=>{
 const points=Array.from({length:300},(_,i)=>[i,Math.sin(i/45)*50+(i%3-.5)]),before=structuredClone(points),nodes=smoothNodes(points,2);
 assert.deepEqual(points,before);assert.ok(nodes.length<40);assert.deepEqual(nodes[0].p,points[0]);assert.deepEqual(nodes.at(-1).p,points.at(-1));
 assert.match(drawingPath({...drawing,points,smooth:true,nodes}),/ C/);assert.doesNotMatch(drawingPath({...drawing,points,smooth:false,nodes}),/ C/);
 assert.ok(nodes.every(n=>Object.values(n).flat().every(Number.isFinite)));
});
test('concurrent edits merge independent strokes and preserve both versions of a conflicting stroke',()=>{
 const added={...drawing,id:'added'},other={...drawing,id:'remote'};
 assert.equal(mergeDrawings([drawing],[drawing,added],[drawing,other]).drawings.length,3);
 const result=mergeDrawings([drawing],[{...drawing,color:'#FFFFFF'}],[{...drawing,color:'#111111'}]);assert.equal(result.conflicts,1);assert.equal(result.drawings.length,2);assert.notEqual(result.drawings[0].id,result.drawings[1].id);
 assert.notEqual(frameKey(record),frameKey({...record,clip:{...record.clip,version:2}}));
});
test('markup survives cut replacement, protects revisions, and detects changed original media',async t=>{
 const {c,root}=await setup(t),allowed=new Set([record.clip.video]);const saved=await saveAnnotation(c,record,0,allowed);assert.equal(saved.revision,1);assert.equal(saved.sourceStamp,await sourceStamp(c,record.clip));
 await assert.rejects(saveAnnotation(c,record,0,allowed),/Revision conflict/);
 await assert.rejects(saveAnnotation(c,{...record,frame:61},1,allowed),/cannot change/);
 await setCurrent(c,'demo',{...record.clip,video:'/media/demo/new.mp4',version:2},1);
 assert.equal((await listAnnotations(c))[0].clip.version,1);
 await writeFile(path.join(root,'media/film.mp4'),'different media');assert.notEqual(saved.sourceStamp,await sourceStamp(c,record.clip));
 assert.equal((await json(path.join(root,'content/demo/annotations/frame-one.json'))).frame,60);
});
test('markup API only accepts bounded, validated, same-origin writes to known media',async t=>{
 const {c}=await setup(t),server=await start(c,0);t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));const base=`http://127.0.0.1:${server.address().port}`;
 const put=(a,headers={},expected=0)=>fetch(base+'/api/annotations',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify({record:a,expected})});
 assert.equal((await put(record,{Origin:'https://attacker.example'})).status,403);
 assert.equal((await put(record,{'Content-Type':'text/plain'})).status,415);
 assert.equal((await put({...record,clip:{...record.clip,video:'/media/demo/unlisted.mp4'}})).status,400);
 assert.equal((await put({...record,id:'../escape'})).status,400);
 assert.equal((await put({...record,drawings:[{...drawing,color:'url(https://attacker.example)'}]})).status,400);
 assert.equal((await put(record)).status,200);assert.equal((await put(record)).status,409);
 const records=(await (await fetch(base+'/api/annotations')).json()).records;assert.equal(records.length,1);assert.equal(records[0].sourceChanged,false);
 await setCurrent(c,'demo',{...record.clip,video:'/media/demo/new.mp4'},1);
 await fetch(base+'/api/annotations');assert.equal((await fetch(base+record.clip.video)).status,200);
 assert.throws(()=>validateAnnotation({...record,thumbnail:'data:image/svg+xml,bad'}),/thumbnail/);
});

test('owner exports are explicit and rewrite media without private fingerprints',async t=>{
 const {exportStatic}=await import('../src/export.mjs');const {c,root}=await setup(t);
 await saveAnnotation(c,record,0,new Set([record.clip.video]));
 const out=path.join(root,'export');await exportStatic(c,{out,projects:['demo'],mediaBase:'https://media.example/'});
 assert.deepEqual((await json(path.join(out,'annotations.json'))).records,[]);
 await exportStatic(c,{out,projects:['demo'],mediaBase:'https://media.example/',annotationIds:['frame-one']});
 const a=(await json(path.join(out,'annotations.json'))).records[0];assert.match(a.clip.video,/^https:\/\/media.example\/\w+\.mp4$/);assert.equal(a.sourceStamp,undefined);assert.equal(a.frame,60);
 await assert.rejects(exportStatic(c,{out,projects:['demo'],annotationIds:['missing']}),/Unknown annotation/);
});

test('marked frames are scoped to the playing clip and version, grouped by frame, in video order',()=>{
 const later={...record,id:'later',frame:120},owner={...record,id:'owner',owner:true};
 const others=[{...record,id:'empty',drawings:[]},{...record,id:'old-cut',clip:{...record.clip,version:0}},
 {...record,id:'other-clip',clip:{...record.clip,video:'/media/demo/other.mp4'}},{...record,id:'other-project',clip:{...record.clip,project:'another'}}];
 const frames=markedFrames([later,...others,owner,record],record.clip);
 assert.deepEqual(frames.map(a=>a.frame),[60,120]);assert.deepEqual(frames[0].records.map(a=>a.id),['owner','frame-one']);
 assert.deepEqual(markedFrames([record],null),[]);
});
test('removing every drawing persists an empty frame and undo can restore it with revision protection',async t=>{
 const {c}=await setup(t),allowed=new Set([record.clip.video]);const saved=await saveAnnotation(c,record,0,allowed);
 const removed=await saveAnnotation(c,{...saved,drawings:[]},saved.revision,allowed);
 assert.deepEqual(markedFrames(await listAnnotations(c),record.clip),[]);
 await assert.rejects(saveAnnotation(c,saved,saved.revision,allowed),/Revision conflict/);
 const restored=await saveAnnotation(c,{...removed,drawings:saved.drawings},removed.revision,allowed);
 assert.equal(markedFrames(await listAnnotations(c),record.clip).length,1);assert.deepEqual(restored.drawings,saved.drawings);
 assert.deepEqual(mergeDrawings(record.drawings,[],record.drawings).drawings,[]);
});
