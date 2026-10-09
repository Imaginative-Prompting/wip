import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,mkdir,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomic,config,upsert } from '../src/store.mjs';
import { exportStatic } from '../src/export.mjs';
test('static export includes only allowlisted projects and never embeds local upload paths',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'wip-export-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const id of ['public','private']){await mkdir(path.join(root,'content',id,'entries'),{recursive:true});await atomic(path.join(root,'content',id,'project.json'),{id,title:id});}
  await mkdir(path.join(root,'media'));await writeFile(path.join(root,'media/image.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await atomic(path.join(root,'config.json'),{content:'content',mounts:{test:'media'}});const c=await config(path.join(root,'config.json'));
  await upsert(c,'public',{id:'test',title:'Public',body:'![Image](/media/test/image.svg)',tags:['stills'],updatedAt:new Date().toISOString()});
  await assert.rejects(exportStatic(c,{out:path.join(root,'out')}),/allowlist/);
  const result=await exportStatic(c,{out:path.join(root,'out'),projects:['public']});
  const raw=await readFile(path.join(root,'out/workspace.json'),'utf8');const data=JSON.parse(raw);
  assert.deepEqual(data.projects.map(p=>p.id),['public']);assert.equal(result.uploads.length,1);assert.equal(raw.includes(root),false);assert.equal(raw.includes('/media/test/'),false);
  assert.match(await readFile(path.join(root,'out/index.html'),'utf8'),/data-mode="static"/);
  assert.ok((await readFile(path.join(root,'out/vendor/purify.js'),'utf8')).includes('export'));
});
