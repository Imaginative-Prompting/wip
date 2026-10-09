"""Optional workspace privacy rules for legacy imports. Never modifies source media."""
import html,json,re
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote

VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class Tree(HTMLParser):
 def __init__(self,s):
  super().__init__(convert_charrefs=True);self.root=['root',[],[]];self.stack=[self.root];self.feed(s)
 def handle_starttag(self,tag,attrs):
  n=[tag,attrs,[]];self.stack[-1][2].append(n)
  if tag not in VOID:self.stack.append(n)
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i][0]==tag:self.stack=self.stack[:i];break
 def handle_data(self,data):self.stack[-1][2].append(data)

def canonical(ref):return unquote(urlsplit(html.unescape(ref)).path)
def load(file):return json.loads(open(file).read()) if file else {}
def blocked(ref,policy):
 p=canonical(ref)
 return p in {canonical(x) for x in policy.get('blockedMedia',[])} or (policy.get('blockDocuments') and p.startswith('/media/') and not re.search(r'\.(mp4|webm|mp3|m4a|wav|avif|png|jpg|jpeg|webp|gif|svg)$',p,re.I))
def text(s,policy):
 for rule in policy.get('replacements',[]):s=re.sub(rule['pattern'],rule['replacement'],s,flags=re.I)
 return s

def clean_html(s,policy):
 root=Tree(s).root
 def bad(n):
  return isinstance(n,list) and (any(k in ['src','href','poster'] and v and blocked(v,policy) for k,v in n[1]) or any(bad(c) for c in n[2]))
 def render(n):
  if isinstance(n,str):return html.escape(text(n,policy),quote=False)
  tag,attrs,children=n
  if tag in ['script','iframe','object','embed']:return ''
  if tag=='figure' and bad(n):return ''
  unsafe=any(k in ['src','href','poster'] and v and blocked(v,policy) for k,v in attrs)
  if unsafe and tag!='a':return ''
  inside=''.join(render(c) for c in children)
  if tag=='root' or (tag=='a' and unsafe):return inside
  attrs=[(k,text(v or '',policy)) for k,v in attrs if not k.startswith('on')]
  opening='<'+tag+''.join(' '+k+'="'+html.escape(v,quote=True)+'"' for k,v in attrs)+'>'
  return opening+('' if tag in VOID else inside+'</'+tag+'>')
 return render(root)

def clean(value,policy):
 if not policy:return value
 if isinstance(value,str):return text(value,policy)
 if isinstance(value,list):return [clean(v,policy) for v in value]
 if not isinstance(value,dict):return value
 out={k:clean(v,policy) for k,v in value.items() if k not in ['legacy','searchText']}
 if value.get('format')=='html':out['body']=clean_html(value['body'],policy)
 if value.get('media'):
  out['media']=[m for m in out['media'] if not blocked(m.get('src',''),policy)]
  for m in out['media']:
   if blocked(m.get('poster',''),policy):m.pop('poster',None)
 for k in ['video','lite','poster','audio']:
  if isinstance(out.get(k),str) and blocked(out[k],policy):out.pop(k)
 if isinstance(out.get('board'),dict) and blocked(out['board'].get('src',''),policy):out.pop('board')
 if out.get('format')=='html':out['searchText']=re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',out['body']))).strip()
 return out
