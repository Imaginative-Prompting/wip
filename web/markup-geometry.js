// Frame-space geometry. X spans 0..1000; Y uses the frame's aspect ratio.
export const clone = value => structuredClone(value);
export const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
export const add = (a,b) => [a[0]+b[0],a[1]+b[1]];
export const sub = (a,b) => [a[0]-b[0],a[1]-b[1]];
export const clipKey = t => JSON.stringify([t?.project,t?.video,t?.version ?? null]);
export const frameKey = d => JSON.stringify([clipKey(d.clip),d.frame,d.fps]);
export function fittedBox(box, aspect) {
  const width=Math.min(box.width,box.height*aspect), height=width/aspect;
  return {left:box.left+(box.width-width)/2,top:box.top+(box.height-height)/2,width,height};
}
export function shapePoints(a,b,{shiftKey=false,altKey=false}={}) {
  let [x,y]=sub(b,a);
  if(shiftKey) { const size=Math.max(Math.abs(x),Math.abs(y)); x=Math.sign(x||1)*size; y=Math.sign(y||1)*size; }
  return [altKey ? [a[0]-x,a[1]-y] : [...a],[a[0]+x,a[1]+y]];
}
export function linePoints(a,b,{shiftKey=false,altKey=false}={}) {
  let [x,y]=sub(b,a);
  if(shiftKey){const angle=Math.round(Math.atan2(y,x)/(Math.PI/4))*Math.PI/4, len=Math.hypot(x,y);x=Math.cos(angle)*len;y=Math.sin(angle)*len;}
  return [altKey?[a[0]-x,a[1]-y]:[...a],[a[0]+x,a[1]+y]];
}
function segmentDistance(p,a,b) {
  const [dx,dy]=sub(b,a), l=dx*dx+dy*dy;
  const t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;
  return distance(p,[a[0]+dx*t,a[1]+dy*t]);
}
// Iterative Ramer-Douglas-Peucker preserves corners without recursive stack limits.
export function simplify(points,tolerance=2) {
  if(points.length<3)return clone(points);
  const keep=new Set([0,points.length-1]), stack=[[0,points.length-1]];
  while(stack.length){const [a,b]=stack.pop();let max=tolerance,index=-1;
    for(let i=a+1;i<b;i++){const d=segmentDistance(points[i],points[a],points[b]);if(d>max){max=d;index=i;}}
    if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>[...points[i]]);
}
export function smoothNodes(points,tolerance=2) {
  // Average high-frequency hand jitter, preserving stroke endpoints and intentional corners.
  const filtered=points.map((p,i)=>i===0||i===points.length-1?p:[(points[i-1][0]+p[0]*2+points[i+1][0])/4,(points[i-1][1]+p[1]*2+points[i+1][1])/4]);
  const ps=simplify(filtered,tolerance);
  return ps.map((p,i)=>{
    const before=ps[i-1]||p,after=ps[i+1]||p, delta=sub(after,before),length=distance(before,after)||1;
    const prev=distance(before,p),next=distance(p,after);
    // Bounded tangents prevent large loops around short adjacent segments.
    const tangent=[delta[0]/length,delta[1]/length];
    const left=Math.min(prev/3,(next||prev)/2),right=Math.min(next/3,(prev||next)/2);
    return {p:[...p],in:[p[0]-tangent[0]*left,p[1]-tangent[1]*left],out:[p[0]+tangent[0]*right,p[1]+tangent[1]*right]};
  });
}
const xy=p=>p.map(n=>Math.round(n*1000)/1000).join(' ');
export function drawingPath(d) {
  if(d.type==='pen'&&d.smooth&&d.nodes?.length){let s=`M${xy(d.nodes[0].p)}`;
    for(let i=1;i<d.nodes.length;i++)s+=` C${xy(d.nodes[i-1].out)} ${xy(d.nodes[i].in)} ${xy(d.nodes[i].p)}`;
    return s;
  }
  const [a,b]=[d.points[0],d.points.at(-1)];if(!a)return '';
  if(d.type==='rect')return `M${xy(a)} H${b[0]} V${b[1]} H${a[0]} Z`;
  if(d.type==='ellipse') {const rx=Math.abs(b[0]-a[0])/2,ry=Math.abs(b[1]-a[1])/2,cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2;
    return `M${cx-rx} ${cy} A${rx} ${ry} 0 1 0 ${cx+rx} ${cy} A${rx} ${ry} 0 1 0 ${cx-rx} ${cy}`;}
  let result=`M${xy(a)} `+d.points.slice(1).map(p=>`L${xy(p)}`).join(' ');
  if(d.points.length===1)result+=`l.001 0`;
  if(d.type==='arrow'){const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),size=Math.min(Math.max(d.width*4,14),distance(a,b)*.5);
    const p=[b[0]-size*Math.cos(angle-.5),b[1]-size*Math.sin(angle-.5)],q=[b[0]-size*Math.cos(angle+.5),b[1]-size*Math.sin(angle+.5)];
    result+=` M${xy(p)} L${xy(b)} L${xy(q)}`;}
  return result;
}
export function translateDrawing(d,delta) {
  const next=clone(d);next.points=next.points.map(p=>add(p,delta));
  if(next.nodes)next.nodes=next.nodes.map(n=>({p:add(n.p,delta),in:add(n.in,delta),out:add(n.out,delta)}));
  return next;
}
export function mergeDrawings(base,local,remote) {
  const before=new Map(base.map(d=>[d.id,d])),mine=new Map(local.map(d=>[d.id,d])), theirs=new Map(remote.map(d=>[d.id,d]));
  const result=[];let conflicts=0;
  for(const id of new Set([...before.keys(),...mine.keys(),...theirs.keys()])){
    const b=before.get(id),l=mine.get(id),r=theirs.get(id),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    if(same(l,b)){if(r)result.push(r);}
    else if(same(r,b)||same(l,r)){if(l)result.push(l);}
    else {if(r)result.push(r);if(l)result.push({...l,id:crypto.randomUUID()});conflicts++;}
  }
  return {drawings:result,conflicts};
}
