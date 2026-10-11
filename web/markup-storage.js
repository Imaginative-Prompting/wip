import {clone,mergeDrawings} from './markup-geometry.js';
const request = req => new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
export class MarkupStorage extends EventTarget {
  constructor(base,staticMode){super();this.base=base;this.static=staticMode;this.records=[];this.owners=[];this.jobs=new Map();this.status='Loading marked frames…';this.pending=new Map();this.ready=this.init();}
  update(message){this.status=message;this.dispatchEvent(new Event('change'));}
  async init(){
    try{
      const opening=indexedDB.open(`wip-markup:${this.base}`,1);
      opening.onupgradeneeded=()=>{opening.result.createObjectStore('records',{keyPath:'id'});opening.result.createObjectStore('outbox',{keyPath:'id'});};
      this.db=await request(opening);
      const local=await this.all('records'),pending=await this.all('outbox');
      if(!this.static) for(const p of pending)this.pending.set(p.id,p);
      if(this.static){this.records=local;const r=await fetch(this.base+'annotations.json');if(r.ok)this.owners=(await r.json()).records.map(a=>({...a,owner:true}));else if(r.status!==404)throw new Error('Owner markup could not load');}
      else {
        const r=await fetch(this.base+'api/annotations');if(!r.ok)throw new Error('Local viewer needs its markup server update');
        this.records=(await r.json()).records;
        for(const p of pending){this.replace(p.record);this.pending.set(p.id,p);}
      }
      this.update(this.static?'Your drawings stay in this browser':'Saved in workspace');
      for(const p of this.pending.values())this.queue(p.record,p.base);
    }catch(e){this.records=await this.all('records').catch(()=>[]);this.update(`${e.message}. Drawings are kept in this browser until retry.`);this.offline=true;}
  }
  all(store){return request(this.db.transaction(store).objectStore(store).getAll());}
  write(store,value,remove=false){return new Promise((resolve,reject)=>{const tx=this.db.transaction(store,'readwrite');const s=tx.objectStore(store);remove?s.delete(value):s.put(clone(value));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage was interrupted'));});}
  replace(a){const i=this.records.findIndex(r=>r.id===a.id);if(i>=0)this.records[i]=a;else this.records.push(a);}
  async save(record,base){
    this.replace(record);this.update('Saving…');
    try{
      await this.write('records',record);
      if(this.static){this.update('Saved in this browser');return;}
      const original=this.pending.get(record.id)?.base||base;
      const pending={id:record.id,record:clone(record),base:clone(original)};this.pending.set(record.id,pending);
      await this.write('outbox',pending);this.queue(record,original);
    }catch(e){this.update(`Not saved: ${e.message}. Keep this tab open and download a backup.`);this.unsaved=true;}
  }
  queue(record,base){
    const id=record.id;if(this.jobs.has(id))return;
    const work=async()=>{
      let snapshot=clone(this.pending.get(id)?.record||record),previous=clone(base),conflicts=0;
      for(let attempt=0;attempt<4;attempt++){
        const response=await fetch(this.base+'api/annotations',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({record:snapshot,expected:previous?.revision||0})});
        if(response.status===409){
          const r=await fetch(this.base+'api/annotations');if(!r.ok)throw new Error('Could not refresh saved drawings');
          const remote=(await r.json()).records.find(a=>a.id===id);
          if(remote){const merged=mergeDrawings(previous?.drawings||[],snapshot.drawings,remote.drawings);snapshot.drawings=merged.drawings;conflicts+=merged.conflicts;previous=remote;}
          await new Promise(resolve=>setTimeout(resolve,100));continue;
        }
        if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.error||'Workspace save unavailable');}
        const saved=await response.json();this.offline=false;
        const pending=this.pending.get(id);
        if(pending&&JSON.stringify(pending.record.drawings)!==JSON.stringify(record.drawings)){
          // Preserve edits made while this request was in flight, including remote edits.
          const merged=mergeDrawings(record.drawings,pending.record.drawings,saved.drawings);
          const next={...pending.record,drawings:merged.drawings,revision:saved.revision};
          this.replace(next);this.pending.set(id,{id,record:next,base:saved});await this.write('records',next);await this.write('outbox',this.pending.get(id));
        }else{this.replace(saved);this.pending.delete(id);await this.write('records',saved);await this.write('outbox',id,true);}
        this.update(conflicts?'Saved both concurrent edits — review the overlapping strokes':'Saved in workspace');return;
      }
      throw new Error('Another tab is editing this frame');
    };
    const promise=work().catch(e=>{this.offline=true;this.update(`${e.message} · saved in browser, retry to sync`);}).finally(()=>{
      this.jobs.delete(id);const next=this.pending.get(id);if(next&&!this.offline)this.queue(next.record,next.base);
    });this.jobs.set(id,promise);
  }
  retry(){this.offline=false;for(const p of this.pending.values())this.queue(p.record,p.base);}
}
