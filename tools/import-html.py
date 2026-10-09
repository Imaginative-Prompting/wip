#!/usr/bin/env python3
"""Import existing WIP HTML without moving media. Safe to repeat: changed source
sections update only the revision last imported; native edits cause conflicts.
All old section IDs and HTML content survive, with asset URLs rewritten.
"""
import argparse, datetime, hashlib, html, json, os, re, sys, tempfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()

def atomic(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=file.name + '.', suffix='.tmp', dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, indent=2, ensure_ascii=False); f.write('\n')
        os.replace(name, file)
    finally:
        if os.path.exists(name): os.unlink(name)

def put(file, value, source_hash, identity):
    """A per-file lock plus imported fingerprint protects native and concurrent edits."""
    file.parent.mkdir(parents=True, exist_ok=True)
    lock = str(file) + '.lock'
    try: fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError: raise ValueError(f'Busy entry: {identity}')
    try:
        old = json.loads(file.read_text()) if file.exists() else None
        if old and old.get('legacy', {}).get('sourceHash') == source_hash:
            return 'unchanged'
        if old and (not old.get('legacy') or old['legacy'].get('writtenHash') != digest(json.dumps({k:v for k,v in old.items() if k not in ['legacy','revision']}, sort_keys=True))):
            raise ValueError(f'Native edit conflicts with changed legacy section: {identity}')
        value['legacy'] = {'source': identity, 'sourceHash': source_hash, 'writtenHash': digest(json.dumps(value, sort_keys=True))}
        value['revision'] = (old or {}).get('revision', 0) + 1
        atomic(file, value)
        return 'updated' if old else 'created'
    finally:
        os.close(fd); os.unlink(lock)

class Page(HTMLParser):
    def __init__(self, raw):
        super().__init__(convert_charrefs=False)
        self.raw=raw;self.offsets=[];n=0
        for line in raw.splitlines(True):self.offsets.append(n);n+=len(line)
        self.sections=[];self.stack=[];self.song=None;self.cut=None;self.script_start=None;self.title='';self.h1_start=None
    def pos(self):
        line,col=self.getpos();return self.offsets[line-1]+col
    def handle_starttag(self, tag, attrs):
        a=dict(attrs);p=self.pos()
        if tag=='details':self.stack.append((p,a) if 'sec' in a.get('class','').split() else None)
        if tag=='audio' and 'song' in a.get('class','').split():self.song=a.get('src')
        if tag=='script' and 'cut-data' in a.get('class','').split():self.script_start=p+len(self.get_starttag_text())
        if tag=='h1' and not self.title:self.h1_start=p+len(self.get_starttag_text())
    def handle_endtag(self, tag):
        p=self.pos()
        if tag=='details' and self.stack:
            item=self.stack.pop()
            if item:self.sections.append((item[0],p+len('</details>'),item[1]))
        if tag=='script' and self.script_start is not None:
            self.cut=json.loads(self.raw[self.script_start:p]);self.script_start=None
        if tag=='h1' and self.h1_start is not None:self.title=plain(self.raw[self.h1_start:p]);self.h1_start=None

def plain(s):return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()

def asset(url, page, mount, root, pages):
    url=html.unescape(url)
    if not url or url.startswith('#') or url.startswith('data:'):return url
    u=urlsplit(url)
    if u.scheme in ('http','https'):return url
    target=(page.parent/unquote(u.path)).resolve() if not u.path.startswith('/') else Path(unquote(u.path)).resolve()
    for p in pages:
        if target == Path(p['page']).resolve():return '/?project='+quote(p['id'])+('#'+u.fragment if u.fragment else '')
    try:rel=target.relative_to(root.resolve())
    except ValueError:return url
    return '/media/'+mount+'/'+quote(str(rel),safe='/')+('?' + u.query if u.query else '')+('#'+u.fragment if u.fragment else '')

def rewrite(body, page, mount, root, pages):
    def attr(m):return m[1]+m[2]+html.escape(asset(m[3],page,mount,root,pages),quote=True)+m[2]
    return re.sub(r'((?:src|href|poster)\s*=\s*)(["\'])(.*?)\2',attr,body,flags=re.S|re.I)

def tags(title, body):
    t=title.lower();out=[]
    if re.search(r'<video\b|href=["\'][^"\']+\.(?:mp4|webm)',body,re.I):out.append('renders')
    if re.search(r'concept|look\b|lookdev|options|style|proposal|your pick|test|study|studies|treatment',t):out.append('concepts')
    if re.search(r'<img\b',body,re.I):out.append('stills')
    if re.search(r'<audio\b',body,re.I) or re.search(r'\bsong\b|\bstems\b',t):out.append('audio')
    if re.search(r'plan|script|story|direction|calls|brief|structure',t):out.append('plans')
    if not out:out=['notes']
    return out

def timestamp(meta, fallback):
    m=re.search(r'(\d{1,2})\s+(Sep|Oct|Nov|Dec)(?:\s+2026)?(?:[, ·]+(\d{1,2}):(\d{2}))?',meta)
    if m:
        try:return datetime.datetime(2026,{'Sep':9,'Oct':10,'Nov':11,'Dec':12}[m[2]],int(m[1]),int(m[3] or 0),int(m[4] or 0),tzinfo=datetime.timezone(datetime.timedelta(hours=-4))).isoformat()
        except ValueError:pass
    return fallback

def section_value(raw, ident, order, page, mount, root, pages, fallback):
    summary=re.search(r'<summary\b[^>]*>(.*?)</summary>',raw,re.S|re.I)
    title_match=re.search(r'<h2\b[^>]*>(.*?)</h2>',summary[1] if summary else '',re.S|re.I)
    title=plain(title_match[1]) if title_match else ident
    meta_match=re.search(r'<span\b[^>]*class=["\']sec-meta["\'][^>]*>(.*?)</span>',summary[1] if summary else '',re.S|re.I)
    meta=plain(meta_match[1]) if meta_match else ''
    start=summary.end() if summary else raw.find('>')+1
    body=raw[start:raw.rfind('</details>')].strip()
    return {'id':ident,'title':title,'summary':meta,'tags':tags(title,body),'format':'html','body':rewrite(body,page,mount,root,pages),'searchText':plain(body),'updatedAt':timestamp(meta,fallback),'order':order}

def track_value(cut, song, page, mount, root, pages, project):
    conv=lambda v:asset(v,page,mount,root,pages) if v else None
    out={'title':project['title'],'audio':conv(song),'video':conv(cut.get('src')),'lite':conv(cut.get('lite')),'poster':conv(cut.get('poster')),'version':cut.get('version'),'duration':cut.get('duration') or cut.get('songEnd'),'songEnd':cut.get('songEnd'),'builtLabel':cut.get('builtLabel'),'chapters':cut.get('chapters',[]),'lines':cut.get('lines',[]),'segments':cut.get('segments',[])}
    if cut.get('board'):out['board']={**cut['board'],'src':conv(cut['board']['src'])}
    return {k:v for k,v in out.items() if v is not None}

def migrate(specfile, only=None):
    spec=json.loads(Path(specfile).read_text());content=Path(spec['content']);root=Path(spec['root']);mount=spec.get('mount','channel');pages=spec['projects']
    report={'created':0,'updated':0,'unchanged':0,'conflicts':[],'projects':[]}
    for project in pages:
        if only and project['id']!=only:continue
        page=Path(project['page']);raw=page.read_text();parsed=Page(raw);parsed.feed(raw);parsed.sections.sort()
        fallback=datetime.datetime.fromtimestamp(page.stat().st_mtime,datetime.timezone.utc).isoformat()
        folder=content/project['id'];(folder/'entries').mkdir(parents=True,exist_ok=True)
        config={k:project[k] for k in ['id','title','description','order'] if k in project}
        if parsed.song:
            song={'title':project['title'],'audio':asset(parsed.song,page,mount,root,pages)}
            if parsed.cut:song.update({k:parsed.cut[k] for k in ['chapters','lines'] if k in parsed.cut});song['duration']=parsed.cut.get('songEnd')
            config['song']=song
        # Project settings are authored after first import; never overwrite them on a rescan.
        if not (folder/'project.json').exists():atomic(folder/'project.json',config)
        seen=set()
        for order,(a,b,attrs) in enumerate(parsed.sections):
            ident=attrs.get('id',f'section-{order+1}')
            if ident in seen:report['conflicts'].append(f'{project["id"]}: duplicate ID {ident}');continue
            if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,119}',ident):report['conflicts'].append(f'Unsupported ID: {ident}');continue
            seen.add(ident)
            value=section_value(raw[a:b],ident,order,page,mount,root,pages,fallback)
            try:report[put(folder/'entries'/f'{ident}.json',value,digest(raw[a:b]),f'{project["id"]}#{ident}')]+=1
            except ValueError as e:report['conflicts'].append(str(e))
        if parsed.cut and parsed.cut.get('src'):
            track=track_value(parsed.cut,parsed.song,page,mount,root,pages,project)
            try:report[put(folder/'current.json',track,digest(json.dumps(parsed.cut,sort_keys=True)),f'{project["id"]}#cut')]+=1
            except ValueError as e:report['conflicts'].append(str(e))
        report['projects'].append({'id':project['id'],'sections':len(parsed.sections),'imported':len(seen)})
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('spec');p.add_argument('--project');args=p.parse_args()
    result=migrate(args.spec,args.project);print(json.dumps(result,indent=2));sys.exit(bool(result['conflicts']))
