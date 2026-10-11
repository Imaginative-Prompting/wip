import {MarkupStorage} from './markup-storage.js';
import {clone,clipKey,frameKey,fittedBox,distance,shapePoints,linePoints,smoothNodes,drawingPath,translateDrawing,add,sub} from './markup-geometry.js';
const NS='http://www.w3.org/2000/svg';
const $=id=>document.getElementById(id);
const el=(tag,attrs={},text)=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!=null)n.textContent=text;return n;};
const svg=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const icons={pen:'M4 20l4-1L20 7l-3-3L5 16Z M14 7l3 3',select:'M5 3v17l5-5 4 7 3-2-4-7h8Z',shapes:'M3 3h12v12H3Z M15 9a6 6 0 1 1-6 6',undo:'M9 5 3 11l6 6 M3 11h11a6 6 0 0 1 6 6',redo:'m15 5 6 6-6 6 M21 11H10a6 6 0 0 0-6 6',trash:'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 10v7 M14 10v7',frames:'M3 5h14v11H3Z M7 20h14V9',close:'m6 6 12 12 M6 18 18 6',settings:'M4 7h16 M4 17h16 M9 4v6 M15 14v6',smooth:'M3 18C3 2 21 22 21 6',download:'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4'};
function button(name,icon,action){const b=el('button',{type:'button','aria-label':name,title:name,class:'markup-icon'});if(icon){const s=svg('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':true});s.append(svg('path',{d:icons[icon]}));b.append(s);}else b.textContent=name;b.onclick=action;return b;}
function download(blob,name){const a=el('a',{href:URL.createObjectURL(blob),download:name});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);}
export class Markup {
  constructor(player,previewWindow,{base,staticMode,copyText}){
    this.player=player;this.window=previewWindow;this.static=staticMode;this.copyText=copyText;this.storage=new MarkupStorage(base,staticMode);
    this.tool='pen';this.color='#F0E442';this.width=4;this.smooth=false;this.tolerance=2;this.editing=false;this.histories=new Map();this.selected=null;this.doc=null;this.key='';this.panelOpen=false;
    this.preview=$('preview');this.video=$('video');this.build();
    this.storage.addEventListener('change',()=>{this.status.textContent=this.storage.status;this.renderList();if(!this.gesture)this.sync(true);});
    this.storage.ready.then(()=>this.sync(true));
    player.addEventListener('change',()=>this.sync());
    for(const event of ['loadedmetadata','seeked','error'])this.video.addEventListener(event,()=>this.sync(true));
    this.observer=new ResizeObserver(()=>this.layout());this.observer.observe(this.preview);this.observer.observe($('dock'));
    addEventListener('resize',()=>this.layout());
    document.addEventListener('fullscreenchange',()=>{(document.fullscreenElement||document.body).append(this.panel);this.layout();});
    document.addEventListener('keydown',e=>this.keydown(e),true);
    addEventListener('beforeunload',e=>{if(this.storage.unsaved){e.preventDefault();e.returnValue='';}});
    this.sync();
  }
  build(){
    this.layer=svg('svg',{id:'markup-canvas',tabindex:0,'aria-label':'Frame drawing canvas'});this.layer.hidden=true;
    this.layer.addEventListener('pointerdown',e=>this.start(e));
    this.layer.addEventListener('pointermove',e=>this.move(e));
    this.layer.addEventListener('pointerup',e=>this.end(e));
    this.layer.addEventListener('pointercancel',()=>this.cancel());
    this.layer.addEventListener('lostpointercapture',()=>{if(this.gesture)this.cancel();});
    this.layer.addEventListener('dblclick',e=>e.preventDefault());
    this.preview.append(this.layer);
    this.toggle=button('Draw on this frame','pen',()=>this.setEditing(!this.editing));this.toggle.id='markup-toggle';this.toggle.classList.add('markup-toggle');this.toggle.setAttribute('aria-pressed','false');this.preview.append(this.toggle);
    this.dockButton=button('Marked frames','frames',()=>this.openPanel(!this.panelOpen));this.dockButton.id='marked-frames';$('browse-clips').after(this.dockButton);
    this.toolbar=el('div',{id:'markup-toolbar',role:'toolbar','aria-label':'Drawing tools'});this.toolbar.hidden=true;
    this.tools={};
    for(const [name,label,icon]of [['select','Select and edit paths (V)','select'],['pen','Draw freehand (B)','pen']]){
      const b=button(label,icon,()=>this.setTool(name));b.dataset.tool=name;this.tools[name]=b;this.toolbar.append(b);
    }
    this.shapeButton=button('Shapes','shapes',()=>this.popover(this.shapes,this.shapeButton));this.shapeButton.setAttribute('aria-expanded','false');this.toolbar.append(this.shapeButton);
    this.shapes=el('div',{class:'markup-popover markup-shapes',popover:'auto'});this.shapes.hidden=true;
    for(const [name,label]of [['rect','Rectangle'],['ellipse','Ellipse'],['line','Line'],['arrow','Arrow']]){const b=button(label,null,()=>{this.setTool(name);this.closePopovers();});b.dataset.tool=name;this.tools[name]=b;this.shapes.append(b);}
    this.shapes.append(el('small',{},'Shift: constrain · Option/Alt: from centre'));this.toolbar.append(this.shapes);
    this.smoothButton=button('Smooth stroke · editable Bézier curves','smooth',()=>{const d=this.selectedDrawing();this.smooth=!(d?.smooth??this.smooth);if(d?.type==='pen')this.change(()=>{d.smooth=this.smooth;if(d.smooth&&!d.nodes)d.nodes=smoothNodes(d.points,this.tolerance);});this.controls();});this.smoothButton.id='markup-smooth';this.toolbar.append(this.smoothButton);
    this.styleButton=button('Stroke colour, width and smoothing','settings',()=>this.popover(this.settings,this.styleButton));this.styleButton.setAttribute('aria-expanded','false');this.toolbar.append(this.styleButton);
    this.settings=el('div',{class:'markup-popover markup-settings',popover:'auto'});this.settings.hidden=true;
    const colors=el('div',{class:'markup-colors'});
    for(const [color,name]of [['#F0E442','Yellow'],['#56B4E9','Blue'],['#D55E00','Orange'],['#CC79A7','Pink'],['#FFFFFF','White'],['#111111','Black']]){const b=button(name,null,()=>{this.color=color;const d=this.selectedDrawing();if(d)this.change(()=>d.color=color);this.controls();});b.textContent='';b.style.setProperty('--swatch',color);b.dataset.color=color;colors.append(b);}
    this.settings.append(colors);
    const widthLabel=el('label',{},'Stroke width');this.widthInput=el('input',{type:'range',min:1,max:12,step:1,'aria-label':'Stroke width',value:this.width});widthLabel.append(this.widthInput);this.settings.append(widthLabel);
    this.widthInput.oninput=()=>{this.width=+this.widthInput.value;};this.widthInput.onchange=()=>{const d=this.selectedDrawing();if(d)this.change(()=>d.width=this.width);};
    const smoothing=el('label',{},'Curve smoothing');this.smoothingInput=el('input',{type:'range',min:.5,max:8,step:.5,value:2,'aria-label':'Curve smoothing'});smoothing.append(this.smoothingInput);this.settings.append(smoothing);
    this.smoothingInput.onchange=()=>{this.tolerance=+this.smoothingInput.value;const d=this.selectedDrawing();if(d?.type==='pen')this.change(()=>{d.smooth=true;d.nodes=smoothNodes(d.points,this.tolerance);this.smooth=true;});};this.toolbar.append(this.settings);
    this.undoButton=button('Undo drawing (⌘/Ctrl Z)','undo',()=>this.undo());this.redoButton=button('Redo drawing (⌘/Ctrl Shift Z)','redo',()=>this.undo(true));this.deleteButton=button('Delete selected drawing','trash',()=>this.remove());
    this.doneButton=button('Done drawing','close',()=>this.setEditing(false));this.toolbar.append(this.undoButton,this.redoButton,this.deleteButton,this.doneButton);this.preview.append(this.toolbar);
    this.hint=el('div',{id:'markup-hint'});this.preview.append(this.hint);
    this.snapshot=el('img',{id:'markup-snapshot',alt:'Saved marked frame'});this.snapshot.hidden=true;this.preview.insertBefore(this.snapshot,this.layer);
    this.panel=el('aside',{id:'markup-panel','aria-label':'Marked frames'});this.panel.hidden=true;
    const heading=el('div',{class:'markup-heading'});heading.append(el('h2',{},'Marked frames'),button('Close marked frames','close',()=>this.openPanel(false)));this.panel.append(heading);
    this.status=el('p',{class:'markup-status',role:'status'},this.storage.status);this.panel.append(this.status);
    const actions=el('div',{class:'markup-actions'});this.copyButton=button('Copy frame reference',null,()=>this.copyReference());this.pngButton=button('Save image',null,()=>this.exportImage());actions.append(this.copyButton,this.pngButton);this.panel.append(actions);
    this.list=el('div',{class:'markup-list'});this.panel.append(this.list);
    const footer=el('div',{class:'markup-panel-footer'});
    footer.append(button('Download backup',null,()=>download(new Blob([JSON.stringify({schema:1,records:this.storage.records},null,2)],{type:'application/json'}),'wip-markup.json')));
    const restore=button('Restore backup',null,()=>this.importInput.click());footer.append(restore);
    this.importInput=el('input',{type:'file',accept:'.json,application/json',hidden:''});this.importInput.onchange=()=>this.restore();footer.append(this.importInput);
    if(!this.static)footer.append(button('Retry saves',null,()=>this.storage.retry()));
    footer.append(el('small',{},this.static?'Owner drawings are published with the site. Your drawings stay on this device.':'Saved per frame, including older drafts. Agents can read the annotation JSON.'));this.panel.append(footer);document.body.append(this.panel);
    this.controls();
  }
  closePopovers(){for(const [panel,b] of [[this.shapes,this.shapeButton],[this.settings,this.styleButton]]){panel.hidePopover?.();panel.hidden=true;b.setAttribute("aria-expanded","false");}}
  popover(panel,b){
    const open=panel.matches(":popover-open");this.closePopovers();if(open)return;panel.hidden=false;panel.showPopover?.();b.setAttribute("aria-expanded","true");
    const anchor=b.getBoundingClientRect(),box=panel.getBoundingClientRect();Object.assign(panel.style,{position:"fixed",margin:"0",left:`${Math.max(8,Math.min(innerWidth-box.width-8,anchor.left))}px`,top:`${Math.max(8,anchor.top-box.height-10)}px`,bottom:"auto"});
  }
  selectedDrawing(){return this.doc?.drawings.find(d=>d.id===this.selected);}
  frame(){return this.player.frame;}
  matching(a){return clipKey(a.clip)===clipKey(this.player.track)&&a.frame===this.frame()&&a.fps===this.player.fps;}
  available(){return !!this.player.track?.video&&!this.player.playing&&this.player.preview&&!this.video.seeking&&this.player.hasPicture&&this.video.readyState>=2&&!this.player.error&&!this.doc?.sourceChanged;}
  sync(force=false){
    if(this.gesture&&(this.player.playing||clipKey(this.player.track)!==clipKey(this.doc.clip)||this.frame()!==this.doc.frame))this.cancel();
    const key=JSON.stringify([clipKey(this.player.track),this.frame(),this.player.fps]);
    if(key!==this.key||force){
      this.key=key;
      const found=this.storage.records.find(a=>a.id===this.focusedId&&this.matching(a))||this.storage.records.find(a=>this.matching(a));
      if(!this.gesture)this.doc=found||null;
      if(!this.doc?.drawings.some(d=>d.id===this.selected))this.selected=null;
      this.owners=this.storage.owners.filter(a=>this.matching(a));
      this.render();this.highlightList();
    }
    if(this.player.playing&&this.editing)this.setEditing(false);
    this.layer.style.visibility=this.player.playing||this.video.seeking?'hidden':'visible';
    const fallback=[this.doc,...(this.owners||[])].find(a=>a?.thumbnail&&(a.sourceChanged||this.player.error));
    this.snapshot.hidden=!fallback||this.player.playing;if(fallback)this.snapshot.src=fallback.thumbnail;
    this.toggle.disabled=!this.player.track?.video;this.toolbar.hidden=!this.editing;
    this.layer.classList.toggle('editing',this.editing&&this.available());
    this.hint.textContent=fallback?'Saved frame · original media is unavailable or changed':this.editing?(this.available()?(this.tool==='select'?'Drag to move · Bézier handles adjust curves · Option/Alt breaks a tangent':'Shift: constrain shapes · Option/Alt: draw from centre'):'Waiting for the exact video frame…'):'';
    this.hint.hidden=!this.hint.textContent;this.controls();this.layout();
  }
  setEditing(on){
    if(on){this.player.pause();this.player.showPreview(true);const frame=this.frame();this.player.seek(frame/this.player.fps+(this.player.track.offset||0),{frame:true});this.openPanel(true);}
    this.editing=on;this.preview.classList.toggle('markup-editing',on);this.toggle.setAttribute('aria-pressed',String(on));this.closePopovers();if(!on){this.cancel();this.selected=null;}this.sync(true);
  }
  setTool(tool){this.tool=tool;this.selected=null;this.controls();this.render();}
  openPanel(on){this.panelOpen=on;this.panel.hidden=!on;this.dockButton.setAttribute('aria-expanded',String(on));document.body.classList.toggle('markup-open',on);this.layout();this.renderList();}
  layout(){
    const mobile=innerWidth<=700;const inset=this.panelOpen?(mobile?0:260):0,bottom=this.panelOpen&&mobile?210:0;
    document.documentElement.style.setProperty('--markup-side',`${inset}px`);document.documentElement.style.setProperty('--markup-bottom',`${bottom}px`);
    this.window.reserved={left:inset,bottom};this.window.layout();
    const v=this.video.getBoundingClientRect(),p=this.preview.getBoundingClientRect();
    const saved=[this.doc,...(this.owners||[])].find(a=>a&&(a.sourceChanged||this.player.error));
    const aspect=saved?saved.width/saved.height:this.video.videoWidth&&this.video.videoHeight?this.video.videoWidth/this.video.videoHeight:(this.doc?this.doc.width/this.doc.height:16/9);
    const r=fittedBox(v,aspect);this.box=r;
    for(const node of [this.layer,this.snapshot])Object.assign(node.style,{left:`${r.left-p.left}px`,top:`${r.top-p.top}px`,width:`${r.width}px`,height:`${r.height}px`});
  }
  controls(){
    for(const [name,b]of Object.entries(this.tools))b.setAttribute('aria-pressed',String(name===this.tool));
    this.shapeButton.setAttribute('aria-pressed',String(['rect','ellipse','arrow','line'].includes(this.tool)));
    this.smoothButton.setAttribute('aria-pressed',String(this.selectedDrawing()?.smooth??this.smooth));
    const history=this.doc&&this.histories.get(this.doc.id);this.undoButton.disabled=!history?.undo.length;this.redoButton.disabled=!history?.redo.length;this.deleteButton.disabled=!this.selectedDrawing();
    for(const b of this.settings.querySelectorAll('[data-color]'))b.setAttribute('aria-pressed',String(b.dataset.color===this.color));
    this.copyButton.disabled=!this.doc&&!this.owners?.length;this.pngButton.disabled=this.copyButton.disabled;
  }
  render(){
    this.layer.replaceChildren();const all=[...(this.owners||[]),...(this.doc?[this.doc]:[])];
    const height=this.doc?.height||this.owners?.[0]?.height||(1000*this.video.videoHeight/this.video.videoWidth)||562.5;
    this.layer.setAttribute('viewBox',`0 0 1000 ${height}`);this.layer.style.pointerEvents=this.editing?'auto':'none';
    for(const a of all)for(const d of a.drawings){const g=svg('g',{'data-drawing':d.id,...(a.owner?{'data-owner':'true'}:{})});
      const path=drawingPath(d);g.append(svg('path',{d:path,fill:'none',stroke:d.color,'stroke-width':d.width,'stroke-linecap':'round','stroke-linejoin':'round'}));
      if(!a.owner){g.append(svg('path',{d:path,fill:'none',stroke:'transparent','stroke-width':Math.max(16,d.width+10),'pointer-events':'stroke','data-hit':d.id}));}
      this.layer.append(g);
      if(this.editing&&!a.owner&&d.id===this.selected)this.handles(d);
    }
  }
  handles(d){
    const radius=Math.max(3,4*1000/(this.box?.width||480));
    const handle=(p,attrs,round=false)=>{const h=svg(round?'circle':'rect',round?{cx:p[0],cy:p[1],r:radius*.8}:{x:p[0]-radius,y:p[1]-radius,width:radius*2,height:radius*2});for(const[k,v]of Object.entries({...attrs,fill:'#fff',stroke:'#151515','stroke-width':1.2,'vector-effect':'non-scaling-stroke',class:'markup-handle'}))h.setAttribute(k,v);this.layer.append(h);};
    if(d.type==='pen'&&d.smooth&&d.nodes){d.nodes.forEach((n,i)=>{
      for(const which of ['in','out'])if((which==='in'&&i>0)||(which==='out'&&i<d.nodes.length-1)){this.layer.append(svg('path',{d:`M${n.p}L${n[which]}`,stroke:'#fff','stroke-width':1,'vector-effect':'non-scaling-stroke','pointer-events':'none'}));handle(n[which],{'data-node':i,'data-handle':which},true);}
      handle(n.p,{'data-node':i,'data-handle':'p'});
    });}else if(['rect','ellipse','line','arrow'].includes(d.type)){d.points.forEach((p,i)=>handle(p,{'data-point':i}));}
  }
  point(e){const height=this.doc?.height||1000*this.video.videoHeight/this.video.videoWidth;return [(e.clientX-this.box.left)/this.box.width*1000,(e.clientY-this.box.top)/this.box.height*height];}
  ensureDoc(){
    if(this.doc)return;const t=this.player.track,now=new Date().toISOString();
    const fields=['id','title','project','projectTitle','video','audio','lite','poster','version','fps','offset','duration','songEnd'];
    this.doc={schema:1,id:crypto.randomUUID(),project:t.project,clip:Object.fromEntries(fields.filter(k=>t[k]!=null).map(k=>[k,t[k]])),frame:this.frame(),fps:this.player.fps,width:1000,height:1000*this.video.videoHeight/this.video.videoWidth,drawings:[],createdAt:now,updatedAt:now,revision:0,thumbnail:this.thumbnail()};
    this.storage.replace(this.doc);
  }
  thumbnail(){try{const c=document.createElement('canvas');c.width=320;c.height=Math.round(320*this.video.videoHeight/this.video.videoWidth);c.getContext('2d').drawImage(this.video,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.72);}catch{return '';}}
  start(e){
    if(e.button!==0||!this.editing||!this.available()||this.gesture)return;e.preventDefault();e.stopPropagation();this.layer.focus({preventScroll:true});this.ensureDoc();
    if(this.doc.drawings.length>=500&&this.tool!=='select'){this.status.textContent='This frame has reached 500 drawings. Remove a drawing before adding another.';return;}
    const p=this.point(e);this.gesture={pointer:e.pointerId,start:p,before:clone(this.doc),tool:this.tool};this.layer.setPointerCapture(e.pointerId);
    if(this.tool==='select'){
      const hit=e.target.closest('[data-hit]')?.dataset.hit;
      if(e.target.dataset.handle){this.gesture.node=+e.target.dataset.node;this.gesture.handle=e.target.dataset.handle;}
      else if(e.target.dataset.point!=null)this.gesture.point=+e.target.dataset.point;
      else this.selected=hit||null;
      this.gesture.selected=this.selected;this.gesture.original=clone(this.selectedDrawing()||null);
      if(this.selectedDrawing()){this.color=this.selectedDrawing().color;this.width=this.selectedDrawing().width;this.widthInput.value=this.width;}
    }else{
      const drawing={id:crypto.randomUUID(),type:this.tool,color:this.color,width:this.width,points:[p],...(this.tool==='pen'?{smooth:false}:{})};
      if(this.tool!=='pen')drawing.points.push(p);this.doc.drawings.push(drawing);this.gesture.selected=drawing.id;this.selected=null;
    }
    this.render();this.controls();
  }
  move(e){
    const g=this.gesture;if(!g||g.pointer!==e.pointerId)return;e.preventDefault();
    const drawing=this.doc.drawings.find(d=>d.id===g.selected);if(!drawing)return;
    const p=this.point(e);
    if(g.tool==='select'){
      if(g.handle){const node=drawing.nodes[g.node],original=g.original.nodes[g.node];
        if(g.handle==='p'){const delta=sub(p,original.p);node.p=p;node.in=add(original.in,delta);node.out=add(original.out,delta);}
        else{node[g.handle]=p;if(!e.altKey){const opposite=g.handle==='in'?'out':'in',len=distance(original.p,original[opposite]),v=sub(p,node.p),l=Math.hypot(...v)||1;node[opposite]=[node.p[0]-v[0]/l*len,node.p[1]-v[1]/l*len];}}
      }else if(g.point!=null){const other=g.original.points[1-g.point];const ends=['line','arrow'].includes(drawing.type)?linePoints(other,p,e):shapePoints(other,p,e);drawing.points=g.point===0?[ends[1],ends[0]]:ends;}
      else{const next=translateDrawing(g.original,sub(p,g.start));Object.assign(drawing,next);}
    }else if(g.tool==='pen'){
      for(const event of e.getCoalescedEvents?.()||[e]){const pt=this.point(event);if(distance(drawing.points.at(-1),pt)>.3&&drawing.points.length<12000)drawing.points.push(pt);}
    }else drawing.points=['line','arrow'].includes(g.tool)?linePoints(g.start,p,e):shapePoints(g.start,p,e);
    this.render();
  }
  end(e){
    const g=this.gesture;if(!g||g.pointer!==e.pointerId)return;this.move(e);const d=this.doc.drawings.find(d=>d.id===g.selected);
    if(g.tool==='pen'&&d){d.smooth=this.smooth;if(d.smooth)d.nodes=smoothNodes(d.points,this.tolerance);}
    this.gesture=null;if(this.layer.hasPointerCapture(e.pointerId))this.layer.releasePointerCapture(e.pointerId);
    if(JSON.stringify(g.before.drawings)!==JSON.stringify(this.doc.drawings)){this.checkpoint(g.before.drawings);this.persist(g.before);}
    this.render();this.controls();
  }
  cancel(){const g=this.gesture;if(!g)return;this.doc.drawings=clone(g.before.drawings);this.gesture=null;if(this.layer.hasPointerCapture(g.pointer))this.layer.releasePointerCapture(g.pointer);this.render();}
  checkpoint(before){let h=this.histories.get(this.doc.id);if(!h){h={undo:[],redo:[]};this.histories.set(this.doc.id,h);}h.undo.push(clone(before));if(h.undo.length>60)h.undo.shift();h.redo=[];}
  persist(before){this.doc.updatedAt=new Date().toISOString();this.storage.save(clone(this.doc),before);this.renderList();}
  change(fn){if(!this.doc||this.doc.sourceChanged)return;const before=clone(this.doc);fn();this.checkpoint(before.drawings);this.persist(before);this.render();this.controls();}
  undo(redo=false){const h=this.doc&&this.histories.get(this.doc.id),from=redo?h?.redo:h?.undo,to=redo?h?.undo:h?.redo;if(!from?.length)return;const before=clone(this.doc);to.push(clone(before.drawings));this.doc.drawings=from.pop();this.selected=null;this.persist(before);this.render();this.controls();}
  remove(){if(!this.selectedDrawing())return;this.change(()=>{this.doc.drawings=this.doc.drawings.filter(d=>d.id!==this.selected);this.selected=null;});}
  keydown(e){
    if(!this.editing||e.target.closest('input,textarea,select')||e.target.isContentEditable)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();this.undo(e.shiftKey);return;}
    if(e.key==='Escape'){if(this.shapes.matches(':popover-open')||this.settings.matches(':popover-open')){this.closePopovers();e.preventDefault();e.stopPropagation();return;}e.preventDefault();e.stopPropagation();if(this.gesture)this.cancel();else if(this.selected){this.selected=null;this.render();this.controls();}else this.setEditing(false);return;}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();this.remove();return;}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key.toLowerCase()==='v'||e.key.toLowerCase()==='b'){e.preventDefault();this.setTool(e.key.toLowerCase()==='v'?'select':'pen');}
    if(e.key===' '&&e.target===this.layer){e.preventDefault();this.player.toggle();}
  }
  renderList(){
    const focus=document.activeElement?.dataset.annotation;
    this.list.replaceChildren();const records=[...this.storage.owners,...this.storage.records].filter(a=>a.drawings.length).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    this.dockButton.title=`Marked frames · ${records.length}`;
    if(!records.length)this.list.append(el('p',{class:'markup-empty'},'Draw on a paused frame. It will appear here.'));
    for(const a of records){const b=el('button',{type:'button',class:'markup-frame','data-annotation':a.id,'data-owner':String(!!a.owner)});const picture=el('div',{class:'markup-thumb'});
      if(a.thumbnail)picture.append(el('img',{src:a.thumbnail,alt:'',loading:'lazy'}));
      const overlay=svg('svg',{viewBox:`0 0 ${a.width} ${a.height}`,'aria-hidden':true});for(const d of a.drawings)overlay.append(svg('path',{d:drawingPath(d),fill:'none',stroke:d.color,'stroke-width':d.width,'stroke-linecap':'round','stroke-linejoin':'round'}));picture.append(overlay);
      b.append(picture,el('span',{},`${a.clip.title}${a.clip.version!=null?` · v${a.clip.version}`:''}`),el('small',{},`${a.clip.projectTitle||a.project} · Frame ${a.frame}${a.owner?' · Owner':this.static?' · Yours':''}`));b.onclick=()=>this.jump(a);this.list.append(b);
    }
    this.highlightList();if(focus)this.list.querySelector(`[data-annotation="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  highlightList(){for(const b of this.list.querySelectorAll('[data-annotation]'))b.setAttribute('aria-current',String(b.dataset.annotation===this.doc?.id||this.owners?.some(a=>a.id===b.dataset.annotation)));}
  jump(a){this.focusedId=a.owner?null:a.id;this.cancel();this.player.pause();this.editing=false;this.preview.classList.remove('markup-editing');this.toggle.setAttribute('aria-pressed','false');
    if(clipKey(this.player.track)!==clipKey(a.clip))this.player.load(a.clip,{time:a.frame/a.fps+(a.clip.offset||0),autoplay:false,preview:true});
    else this.player.showPreview(true);
    this.player.seek(a.frame/a.fps+(a.clip.offset||0),{frame:true});this.sync(true);
  }
  async copyReference(){const a=this.doc||this.owners?.[0];if(!a)return;
    const text=[`Project: ${a.clip.projectTitle||a.project}`,`Clip: ${a.clip.title}${a.clip.version!=null?` (v${a.clip.version})`:''}`,`Frame: ${a.frame} (zero-based, ${a.fps} fps)`,`Media: ${new URL(a.clip.video,location.href).href}`,`Markup: ${this.static?a.id:`content/${a.project}/annotations/${a.id}.json`}`].join('\n');
    try{await this.copyText(text);this.status.textContent='Copied clip, frame and markup reference';}catch{this.status.textContent='Clipboard unavailable. Try again.';}
  }
  async exportImage(){try{
    const records=[...(this.owners||[]),...(this.doc?[this.doc]:[])];const a=records[0];if(!a)return;
    const canvas=document.createElement('canvas');canvas.width=Math.max(1000,this.video.videoWidth||0);canvas.height=Math.round(canvas.width*a.height/a.width);const ctx=canvas.getContext('2d');
    if(this.available())ctx.drawImage(this.video,0,0,canvas.width,canvas.height);else if(a.thumbnail){const im=new Image();im.src=a.thumbnail;await im.decode();ctx.drawImage(im,0,0,canvas.width,canvas.height);}
    ctx.scale(canvas.width/a.width,canvas.height/a.height);ctx.lineCap='round';ctx.lineJoin='round';for(const r of records)for(const d of r.drawings){ctx.strokeStyle=d.color;ctx.lineWidth=d.width;ctx.stroke(new Path2D(drawingPath(d)));}
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('No image');download(blob,`frame-${a.frame}-markup.png`);this.status.textContent='Saved annotated image';
    }catch{this.status.textContent='This media host prevents image export. Download the markup backup instead.';}
  }
  async restore(){
    try{const file=this.importInput.files[0];if(!file)return;if(file.size>25000000)throw new Error('Backup is too large');const data=JSON.parse(await file.text());if(data.schema!==1||!Array.isArray(data.records))throw new Error('Invalid backup');
      const {validateAnnotation}=await import('./markup-validation.js');
      for(const a of data.records)validateAnnotation(a);
      for(const a of data.records){const existing=this.storage.records.find(r=>r.id===a.id);if(existing&&JSON.stringify(existing.drawings)===JSON.stringify(a.drawings))continue;const copy={...a,id:crypto.randomUUID(),revision:0};delete copy.owner;delete copy.sourceChanged;await this.storage.save(copy,null);}
      this.renderList();this.sync(true);this.status.textContent='Backup restored';
    }catch(e){this.status.textContent=`Could not restore: ${e.message}`;}finally{this.importInput.value='';}
  }
}
