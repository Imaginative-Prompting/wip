const slug = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(value);
const fail=message=>{throw new Error(message);};
const text=(v,max=500)=>typeof v==='string'&&v.length<=max;
const number=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>number(n,-10000,10000));
export function validateAnnotation(a) {
  if(!a||a.schema!==1||!slug(a.id)||!slug(a.project))fail('Invalid annotation identity');
  if(!a.clip||a.clip.project!==a.project||!text(a.clip.id,4000)||(a.clip.projectTitle!=null&&!text(a.clip.projectTitle))||!text(a.clip.title))fail('Invalid clip identity');
  for(const key of ["video","audio","lite","poster"]) if(a.clip[key] && !(typeof a.clip[key] === "string" && (/^\/media\/[a-z0-9_-]+\//.test(a.clip[key]) || /^https?:\/\//.test(a.clip[key])))) fail("Invalid media URL");
  if(!a.clip.video||!Number.isSafeInteger(a.frame)||a.frame<0||a.frame>1e9||!number(a.fps,1,240))fail('Invalid video frame');
  for(const key of ['duration','offset','songEnd'])if(a.clip[key]!=null&&!number(a.clip[key],0,1e9))fail('Invalid clip timing');
  if(a.clip.fps!=null&&a.clip.fps!==a.fps)fail('Clip frame rate does not match annotation');
  if(a.clip.version!=null&&!(typeof a.clip.version==='string'&&a.clip.version.length<100)&&!number(a.clip.version,0,1e9))fail('Invalid clip version');
  if(a.width!==1000||!number(a.height,1,10000))fail('Invalid frame dimensions');
  if(!Array.isArray(a.drawings)||a.drawings.length>500)fail('Too many drawings');
  const ids=new Set();
  for(const d of a.drawings){
    if(!slug(d.id)||ids.has(d.id)||!['pen','rect','ellipse','line','arrow'].includes(d.type)||!/^#[a-f\d]{6}$/i.test(d.color)||!number(d.width,.1,100))fail('Invalid drawing');
    ids.add(d.id);
    if(!Array.isArray(d.points)||!d.points.length||d.points.length>12000||!d.points.every(point))fail('Invalid drawing points');
    if(d.nodes&&(!Array.isArray(d.nodes)||d.nodes.length>12000||!d.nodes.every(n=>point(n.p)&&point(n.in)&&point(n.out))))fail('Invalid curve handles');
    if(d.smooth&&(!d.nodes?.length||d.type!=='pen'))fail('Invalid smooth stroke');
  }
  if(a.thumbnail&&(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(a.thumbnail)||a.thumbnail.length>220000))fail('Invalid frame thumbnail');
  for(const field of ['createdAt','updatedAt'])if(!Number.isFinite(Date.parse(a[field])))fail('Invalid annotation date');
  if(JSON.stringify(a).length>1800000)fail('Annotation is too large');
  return a;
}
