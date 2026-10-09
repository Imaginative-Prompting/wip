import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile);
test('legacy reimports remove private figures and documents without restoring them on a changed source',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'wip-import-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const content=path.join(root,'content');await mkdir(content);
 const policy=path.join(root,'privacy.json');
 await writeFile(policy,JSON.stringify({blockDocuments:true,blockedMedia:['/media/test/private.jpg'],replacements:[{pattern:'privatebrand',replacement:'the tools'}]}));
 const page=path.join(root,'wip.html');
 const html=label=>`<h1>Demo</h1><details class="sec" id="test"><summary><h2>${label}</h2></summary><p>PrivateBrand work.</p><figure><img src="private.jpg"><figcaption>Private photo</figcaption></figure><figure><img src="safe.jpg"><figcaption>Render</figcaption></figure><a href="secret.md">Notes</a></details>`;
 await writeFile(page,html('First'));
 const spec=path.join(root,'import.json');await writeFile(spec,JSON.stringify({root,content,mount:'test',privacy:policy,projects:[{id:'demo',title:'Demo',page}]}));
 const importer=fileURLToPath(new URL('../tools/import-html.py',import.meta.url));
 for(const label of ['First','Updated']) {
  await writeFile(page,html(label));await exec('python3',[importer,spec]);
  const entry=JSON.parse(await readFile(path.join(content,'demo/entries/test.json'),'utf8'));
  assert.equal(entry.title,label);assert.doesNotMatch(entry.body,/private\.jpg|privatebrand|secret\.md|Private photo/i);assert.match(entry.body,/safe\.jpg/);
 }
 const unchanged=JSON.parse((await exec('python3',[importer,spec])).stdout);assert.equal(unchanged.unchanged,1);
});
