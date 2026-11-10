"""Print-space layout, routing and validation for the three process ERDs."""
import heapq
import io
import random
import re
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

import fitz
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

WIDTH, PRINT_WIDTH = 676, 468
SCALE = PRINT_WIDTH / WIDTH
BOX, HEADER, ROW = 156, 42, 20
BODY, SMALL, TITLE = 13, 11.6, 13
GAP, CLEAR, OFFSET = 9, 14.5, 10
HOME = {'academic_years','staff','sections','learners','enrollments','reporting_periods'}

def columns(constraint):
    return set(constraint['definition'].split('(',1)[1].split(')',1)[0].split(', '))

def foreign_key(schema, edge):
    return next(c for c in schema['constraints'] if c['table_name']==edge['child'] and c['contype']=='f'
                and f"REFERENCES edunexus.{edge['parent']}(" in c['definition'] and edge['fk'] in columns(c))

def child_cardinality(schema, edge):
    fk=columns(foreign_key(schema,edge))
    # A unique subset of the FK tuple suffices. A unique superset does NOT.
    keys=[columns(c) for c in schema['constraints'] if c['table_name']==edge['child'] and c['contype'] in ('p','u')]
    for idx in schema['indexes']:
        if idx['tablename']!=edge['child'] or ' WHERE ' in idx['indexdef']: continue
        match=re.search(r'USING btree \(([^()]+)\)$',idx['indexdef'])
        if match and re.fullmatch(r'[a-z_, ]+',match[1]): keys.append(set(match[1].split(', ')))
    return '0..1' if any(k <= fk for k in keys) else '0..N'

def key(schema,table,field):
    tags=set()
    for c in schema['constraints']:
        if c['table_name']==table and field in columns(c):
            if c['contype']=='u' and len(columns(c))>1: continue
            tags.add({'p':'PK','f':'FK','u':'UQ'}[c['contype']])
    return '/'.join(k for k in ['PK','FK','UQ'] if k in tags)

def rect(node): return (node['x'],node['y'],node['x']+BOX,node['y']+node['h'])
def expanded(r,pad): return (r[0]-pad,r[1]-pad,r[2]+pad,r[3]+pad)
def overlaps(a,b): return a[0]<b[2] and b[0]<a[2] and a[1]<b[3] and b[1]<a[3]
def segments(points): return list(zip(points,points[1:]))
def seg_hits(seg,r):
    (x,y),(xx,yy)=seg
    if x==xx: return r[0]<x<r[2] and max(min(y,yy),r[1])<min(max(y,yy),r[3])
    return r[1]<y<r[3] and max(min(x,xx),r[0])<min(max(x,xx),r[2])

def crossing(a,b):
    if a[0][0]==a[1][0]: a,b=b,a
    if a[0][1]!=a[1][1] or b[0][0]!=b[1][0]: return None
    x,y=b[0][0],a[0][1]
    if min(a[0][0],a[1][0])<x<max(a[0][0],a[1][0]) and min(b[0][1],b[1][1])<y<max(b[0][1],b[1][1]): return x,y

def too_close(a,b):
    va=a[0][0]==a[1][0]; vb=b[0][0]==b[1][0]
    if va!=vb: return False
    axis=1 if va else 0; normal=1-axis
    return abs(a[0][normal]-b[0][normal])<GAP and max(min(p[axis] for p in a),min(p[axis] for p in b))<min(max(p[axis] for p in a),max(p[axis] for p in b))

def label(point,direction,text,edge_index):
    x,y=point; dx,dy=direction; width=stringWidth(text,'Helvetica',SMALL)
    if dx: x=x+OFFSET if dx>0 else x-OFFSET-width; y-=SMALL+5
    else: x+=7; y=y+OFFSET if dy>0 else y-OFFSET-SMALL
    return dict(box=(x,y,x+width,y+SMALL),text=text,edge=edge_index)

def row_y(n,field): return n['y']+HEADER+ROW*(n['fields'].index(field)+0.5)

def port(n,side,field=None,position=0.5):
    x,y=n['x'],n['y']
    if side in ('L','R'):
        return ((x if side=='L' else x+BOX,row_y(n,field)),(-1 if side=='L' else 1,0))
    return ((x+BOX*position,y if side=='T' else y+n['h']),(0,-1 if side=='T' else 1))

def compress(points):
    out=[]
    for p in points:
        if out and out[-1]==p: continue
        while len(out)>1 and (out[-2][0]==out[-1][0]==p[0] or out[-2][1]==out[-1][1]==p[1]): out.pop()
        out.append(p)
    return out

def find_path(start,end,nodes,labels,old_edges,own_labels,height):
    obstacles=[expanded(rect(n),4) for n in nodes]+[expanded(l['box'],CLEAR) for l in labels]+[expanded(l['box'],2) for l in own_labels]
    old=[s for e in old_edges for s in segments(e['points'])]
    xs={start[0],end[0],4,WIDTH-4}; ys={start[1],end[1],4,height-4}
    for n in nodes:
        xs.update([n['x']-12,n['x']-24,n['x']+BOX+12,n['x']+BOX+24])
        ys.update([n['y']-12,n['y']-24,n['y']+n['h']+12,n['y']+n['h']+24])
    for r in obstacles:
        xs.update([r[0]-1,r[2]+1]); ys.update([r[1]-1,r[3]+1])
    for s in old:
        for x,y in s:
            xs.update([x-GAP,x+GAP]); ys.update([y-GAP,y+GAP])
    xs=sorted(x for x in xs if 0<=x<=WIDTH); ys=sorted(y for y in ys if 0<=y<=height)
    source=(xs.index(start[0]),ys.index(start[1]),2); target=(xs.index(end[0]),ys.index(end[1]))
    queue=[(0,0,source)]; costs={source:0}; previous={}; cache={}
    def legal(a,b):
        ident=tuple(sorted((a,b)))
        if ident in cache: return cache[ident]
        seg=(a,b)
        if any(seg_hits(seg,r) for r in obstacles) or any(too_close(seg,s) for s in old): cache[ident]=None; return None
        hits=sum(crossing(seg,s) is not None for s in old)
        cache[ident]=hits*90; return cache[ident]
    while queue:
        _,cost,state=heapq.heappop(queue)
        if cost!=costs.get(state): continue
        ix,iy,d=state
        if (ix,iy)==target:
            points=[]
            while state in previous:
                points.append((xs[state[0]],ys[state[1]])); state=previous[state]
            return compress([start]+list(reversed(points)))
        for nx,ny,nd in [(ix-1,iy,0),(ix+1,iy,0),(ix,iy-1,1),(ix,iy+1,1)]:
            if not (0<=nx<len(xs) and 0<=ny<len(ys)): continue
            a,b=(xs[ix],ys[iy]),(xs[nx],ys[ny]); penalty=legal(a,b)
            if penalty is None: continue
            newcost=cost+abs(a[0]-b[0])+abs(a[1]-b[1])+penalty+(28 if d!=2 and d!=nd else 0)
            nxt=(nx,ny,nd)
            if newcost < costs.get(nxt,float('inf')):
                costs[nxt]=newcost; previous[nxt]=state
                estimate=abs(b[0]-end[0])+abs(b[1]-end[1])
                heapq.heappush(queue,(newcost+estimate,newcost,nxt))
    return None

SIDES={
 7:['L','L','R','L','L','R','R','L','R','R'],
 8:['L','L','R','L','R','L','L','R','L','R','L','R'],
 9:['L','L','R','R','L','L','R','L','R','R','R','L'],
}

def route(fig):
    lookup={n['table']:n for n in fig['nodes']}
    height=max(n['y']+n['h'] for n in fig['nodes'])+45
    best=None; best_score=float('inf')
    for attempt in range(80):
        rng=random.Random(200+attempt)
        order=list(range(len(fig['edges'])))
        if attempt: rng.shuffle(order)
        endpoints={}; all_labels=[]; terminals={}; failed=None
        # Reserve every child's FK label before routing any connection.
        for i in order:
            e=fig['edges'][i]; child=lookup[e['child']]
            sides=[SIDES[fig['number']][i]]
            sides.append('R' if sides[0]=='L' else 'L')
            if attempt and rng.random()<0.25: sides.reverse()
            if e['parent']==e['child']: sides=['R']
            for side in sides:
                cp,cd=port(child,side,e['fk']); l=label(cp,cd,e['cards'][1],i)
                cs=(cp[0]+cd[0]*36,cp[1]); seg=(cs,cp)
                if any(overlaps(expanded(l['box'],3),b['box']) or seg_hits(seg,expanded(b['box'],CLEAR)) for b in all_labels): continue
                if any(seg_hits(s,expanded(l['box'],CLEAR)) for ss in terminals.values() for s in ss): continue
                if any(overlaps(l['box'],rect(n)) or seg_hits(seg,rect(n)) for n in fig['nodes']): continue
                endpoints[i]=[None,None,cp,cs]; terminals[i]=[seg]; all_labels.append(l); break
            else: failed=i; break
        if failed is not None: continue
        for i in order:
            e=fig['edges'][i]; parent=lookup[e['parent']]; cp=endpoints[i][2]
            ports=[port(parent,s,position=p) for s in ('B','T') for p in (.2,.5,.8)]
            ports.sort(key=lambda p: abs(p[0][0]-cp[0])+abs(p[0][1]-cp[1]))
            if attempt: rng.shuffle(ports)
            if e['parent']==e['child']: ports=[port(parent,'T',position=.8)]
            for pp,pd in ports:
                ps=(pp[0]+pd[0]*38,pp[1]+pd[1]*38); seg=(pp,ps); l=label(pp,pd,e['cards'][0],i)
                if not (4<=ps[0]<=WIDTH-4 and 4<=ps[1]<=height-4): continue
                if any(overlaps(expanded(l['box'],3),b['box']) for b in all_labels): continue
                if any(seg_hits(seg,expanded(b['box'],CLEAR)) for b in all_labels if b['edge']!=i): continue
                if any(seg_hits(s,expanded(l['box'],CLEAR)) or too_close(seg,s) for j,ss in terminals.items() if i!=j for s in ss): continue
                if any(overlaps(l['box'],rect(n)) or seg_hits(seg,rect(n)) for n in fig['nodes']): continue
                endpoints[i][:2]=[pp,ps]; terminals[i].append(seg); all_labels.append(l); break
            else: failed=i; break
        if failed is not None: continue
        routed=[]
        for i in order:
            e=fig['edges'][i]; pp,ps,cp,cs=endpoints[i]
            own=[l for l in all_labels if l['edge']==i]; other=[l for l in all_labels if l['edge']!=i]
            old=routed+[{'points':list(s)} for j,ss in terminals.items() if j!=i for s in ss]
            middle=find_path(ps,cs,fig['nodes'],other,old,own,height)
            if middle is None: failed=i; break
            routed.append({**e,'points':compress([pp]+middle+[cp]),'index':i,'labels':own})
        if failed is None:
            crossings=sum(crossing(s,t) is not None for j,a in enumerate(routed) for b in routed[j+1:] for s in segments(a['points']) for t in segments(b['points']))
            length=sum(abs(a[0]-b[0])+abs(a[1]-b[1]) for e in routed for a,b in segments(e['points']))
            bends=sum(len(e['points'])-2 for e in routed)
            score=crossings*10000+length+bends*30
            if score<best_score:
                best_score=score; best=(sorted(routed,key=lambda e:e['index']),all_labels)
                print(f"Figure {fig['number']}: candidate with {crossings} crossings",flush=True)
    if best:
        fig['edges'],fig['labels']=best; return
    raise AssertionError(f"Unable to reserve and route figure {fig['number']}, edge {failed}")

def validate(fig,schema):
    cols={(c['table_name'],c['column_name']):c for c in schema['columns']}
    nodes={n['table']:n for n in fig['nodes']}
    for n in fig['nodes']:
        for field in n['fields']: assert (n['table'],field) in cols
    for e in fig['edges']:
        foreign_key(schema,e)
        assert e['cards'][0]==('0..1' if cols[e['child'],e['fk']]['is_nullable']=='YES' else '1')
        assert e['cards'][1]==child_cardinality(schema,e),(e['child'],'child multiplicity')
        assert e['points'][-1][1]==row_y(nodes[e['child']],e['fk']), 'Child anchor is not its FK row'
        parent=nodes[e['parent']]; px,py=e['points'][0]
        assert parent['x']<=px<=parent['x']+BOX and py in (parent['y'],parent['y']+parent['h']), 'Parent anchor is not on the top/bottom edge'
        assert e['points'][-1][0] in (nodes[e['child']]['x'],nodes[e['child']]['x']+BOX), 'Child anchor is not on its border'
        for s in segments(e['points']):
            assert s[0][0]==s[1][0] or s[0][1]==s[1][1]
            assert not any(seg_hits(s,rect(n)) for n in fig['nodes']),('edge crosses box',e['parent'],e['child'])
    for i,a in enumerate(fig['labels']):
        for b in fig['labels'][i+1:]: assert not overlaps(a['box'],b['box']),('label overlap',a,b)
        for e in fig['edges']:
            if e['index']!=a['edge']:
                assert not any(seg_hits(s,expanded(a['box'],CLEAR)) for s in segments(e['points'])),('line near label',a,e)
    for i,a in enumerate(fig['edges']):
        for b in fig['edges'][i+1:]:
            assert not any(too_close(s,t) for s in segments(a['points']) for t in segments(b['points'])),('parallel/shared lines',a['index'],b['index'])
    assert min(BODY,SMALL,TITLE)*SCALE>=8

def txt(x,y,text,size=BODY,bold=False,anchor='start'):
    return f'<text x="{x:g}" y="{y:g}" font-family="Helvetica,Arial,sans-serif" font-size="{size}" font-weight="{"bold" if bold else "normal"}" text-anchor="{anchor}" fill="#111">{escape(text)}</text>'

def heading(name):
    tokens=re.findall(r'[^_]+_?',name.upper()); lines=['']
    for token in tokens:
        if stringWidth(lines[-1]+token,'Helvetica-Bold',TITLE)>BOX-10: lines.append(token)
        else: lines[-1]+=token
    assert ''.join(lines)==name.upper()
    assert len(lines)<=2,lines
    return lines

def path_with_hops(edge,edges):
    points=edge['points']; path=f'M {points[0][0]} {points[0][1]}'
    for seg in segments(points):
        (x,y),(xx,yy)=seg
        if y==yy:
            hits=sorted(set(crossing(seg,s)[0] for other in edges if other is not edge for s in segments(other['points']) if crossing(seg,s)),reverse=xx<x)
            direction=1 if xx>x else -1
            for cx in hits:
                assert abs(cx-x)>5 and abs(cx-xx)>5,('hop at corner',edge['index'],cx,y)
                path+=f' L {cx-direction*4} {y} A 4 4 0 0 {1 if direction>0 else 0} {cx+direction*4} {y}'
        path+=f' L {xx} {yy}'
    return path

def svg(fig,schema):
    validate(fig,schema)
    height=max(n['y']+n['h'] for n in fig['nodes'])+145
    fig['height']=height
    s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="468pt" height="{height*SCALE}pt" viewBox="0 0 {WIDTH} {height}" role="img">',
       f'<title>Figure {fig["number"]}. Entity-Relationship Diagram for {fig["title"]}</title>',
       '<desc>Selected physical entities and schema-verified relationships. Numeric multiplicities sit next to their entity. Dashed entities are defined in Figure 7.</desc>',
       f'<rect width="{WIDTH}" height="{height}" fill="white"/>']
    for e in fig['edges']: s.append(f'<path d="{path_with_hops(e,fig["edges"])}" fill="none" stroke="#222" stroke-width="1.1"/>')
    for n in fig['nodes']:
        x,y=n['x'],n['y']; context=fig['number']!=7 and n['table'] in HOME
        dash=' stroke-dasharray="5 3"' if context else ''
        s.append(f'<rect x="{x}" y="{y}" width="{BOX}" height="{n["h"]}" fill="white" stroke="#111" stroke-width="1.1"{dash}/>')
        s.append(f'<rect x="{x+1}" y="{y+1}" width="{BOX-2}" height="{HEADER-1}" fill="{"white" if context else "#e9edf1"}"/>')
        s.append(f'<path d="M {x} {y+HEADER} H {x+BOX}" stroke="#111" stroke-width="0.9"/>')
        lines=heading(n['table'])
        for i,line in enumerate(lines): s.append(txt(x+BOX/2,y+(18+i*15 if len(lines)>1 else 26),line,TITLE,True,'middle'))
        for i,field in enumerate(n['fields']):
            nullable=next(c['is_nullable']=='YES' for c in schema['columns'] if c['table_name']==n['table'] and c['column_name']==field)
            text=field+(' ?' if nullable else '')
            assert stringWidth(text,'Helvetica',BODY)<BOX-40,(n['table'],text)
            yy=y+HEADER+i*ROW+14
            badge=key(schema,n['table'],field)
            s.append(txt(x+3,yy,badge,SMALL,'/' not in badge))
            s.append(txt(x+39,yy,text))
            if i<len(n['fields'])-1: s.append(f'<path d="M {x+1} {yy+6} H {x+BOX-1}" stroke="#ccc" stroke-width="0.4"/>')
    for l in fig['labels']:
        x,y,xx,yy=l['box']; s.append(txt(x,yy-1,l['text'],SMALL))
    bottom=max(n['y']+n['h'] for n in fig['nodes'])+65
    for row,(left,right) in enumerate([
        (('PK','Primary key'),('1','Exactly one')),
        (('FK','Foreign key (or component)'),('0..1','Optional one')),
        (('UQ','Single-column unique key'),('0..N','Zero or many')),
        (('?','Nullable attribute'),('Dashed','Defined in another figure')),
    ]):
        for x,(symbol,meaning) in [(40,left),(350,right)]:
            s.append(txt(x,bottom+row*18,symbol,SMALL,True)); s.append(txt(x+53,bottom+row*18,meaning,SMALL))
    s.append(txt(40,bottom+74,'Selected attributes and relationships; additional context FKs and journals are omitted.',SMALL))
    s.append('</svg>'); return '\n'.join(s)

def reuse_svg_routes(fig,out,schema):
    """Reuse reviewed geometry only; all schema, anchors and clearances revalidate."""
    source=out/f'figure-{fig["number"]}-{fig["slug"]}.svg'
    paths=[p for p in ET.parse(source).getroot() if p.tag.endswith('path') and p.attrib.get('stroke')=='#222']
    assert len(paths)==len(fig['edges'])
    for i,(e,path) in enumerate(zip(fig['edges'],paths)):
        tokens=re.findall(r'[MLA]|-?\d+(?:\.\d+)?',path.attrib['d']); points=[]
        while tokens:
            command=tokens.pop(0); count=7 if command=='A' else 2
            values=[float(tokens.pop(0)) for _ in range(count)]; points.append(tuple(values[-2:]))
        e['points']=compress(points); e['index']=i; e['labels']=[]
        for end,near,card in [(0,1,e['cards'][0]),(-1,-2,e['cards'][1])]:
            p,q=e['points'][end],e['points'][near]
            delta=(q[0]-p[0],q[1]-p[1]); direction=tuple(0 if d==0 else 1 if d>0 else -1 for d in delta)
            e['labels'].append(label(p,direction,card,i))
    fig['labels']=[l for e in fig['edges'] for l in e['labels']]
    validate(fig,schema)

def render_figures(figures,schema,root,reuse_routes=False):
    out=root/'docs/diagrams/paper'; pdf_path=root/'output/pdf/edunexus-figures-7-9.pdf'
    out.mkdir(parents=True,exist_ok=True); pdf_path.parent.mkdir(parents=True,exist_ok=True)
    (root/'.local').mkdir(exist_ok=True)
    for f in figures:
        rows={7:[55,280,565],8:[55,250,480,735],9:[55,230,455,670]}[f['number']]
        for n in f['nodes']:
            col=round((n['x']-8)/162)
            oldy=n['y']; row=0 if oldy<100 else 1 if oldy<300 else 2 if oldy<540 else 3
            n['x']=40+220*col; n['y']=rows[row]
            if f['number']==7 and n['table']=='import_previews': n['y']+=40
            if f['number']==7 and n['table']=='enrollment_events': n['y']+=120
            if f['number']==7 and n['table']=='learners': n['y']+=80
            if f['number']==8 and n['table']=='instructional_days': n['y']+=40
            if f['number']==9 and n['table'] in ('section_subjects','assessment_scores'): n['y']+=60
            if f['number']==9 and n['table']=='assessment_policy_bindings': n['y']+=20
            if f['number']!=7 and n['table'] in HOME:
                needed={field for field in n['fields'] if 'PK' in key(schema,n['table'],field)}
                for e in f['edges']:
                    if e['child']==n['table']: needed.update(columns(foreign_key(schema,e)))
                n['fields']=[field for field in n['fields'] if field in needed]
            n['fields'].sort(key=lambda field: 0 if 'PK' in key(schema,n['table'],field) else 1 if 'FK' in key(schema,n['table'],field) else 2)
            n['h']=HEADER+ROW*len(n['fields'])+4
        if f['number']==7:
            f['edges'].append(dict(parent='learners',child='learners',fk='merged_into',points=[],cards=['0..1','0..N']))
        if reuse_routes: reuse_svg_routes(f,out,schema)
        else: route(f)
        validate(f,schema)
        print(f"Figure {f['number']}: routes and labels validated",flush=True)
    pdf=canvas.Canvas(str(pdf_path),pagesize=A4,invariant=1)
    pdf.setTitle('EDUNEXUS - Figures 7, 8 and 9'); pdf.setAuthor('EDUNEXUS')
    for f in figures:
        data=svg(f,schema); name=f'figure-{f["number"]}-{f["slug"]}'
        (out/f'{name}.svg').write_text(data,encoding='utf-8',newline='\n')
        drawing=svg2rlg(io.BytesIO(data.encode())); assert abs(drawing.width-PRINT_WIDTH)<0.01
        renderPDF.draw(drawing,pdf,85,A4[1]-30-drawing.height)
        y=A4[1]-30-drawing.height-17
        pdf.setFont('Times-Bold',11); pdf.drawString(85,y,f'Figure {f["number"]}. Entity-Relationship Diagram for {f["title"]}')
        pdf.setFont('Times-Roman',9)
        for note in f['notes']: y-=12; pdf.drawString(85,y,note)
        assert y>20,(f['number'],'too tall',y)
        pdf.showPage()
        # Rasterize the same ReportLab vector output as the PDF. MuPDF's SVG
        # importer drops dashed borders, so it is not an equivalent renderer.
        buf=io.BytesIO(); figure_pdf=canvas.Canvas(buf,pagesize=(PRINT_WIDTH,drawing.height),invariant=1)
        renderPDF.draw(drawing,figure_pdf,0,0); figure_pdf.save()
        rendered=fitz.open('pdf',buf.getvalue())
        rendered[0].get_pixmap(dpi=600,alpha=False).save(out/f'{name}.png')
        rendered[0].get_pixmap(dpi=135,alpha=False).save(root/f'.local/erd-figure-{f["number"]}-review.png')
    pdf.save()
    for i,page in enumerate(fitz.open(pdf_path)): page.get_pixmap(dpi=110).save(root/f'.local/erd-paper-page-{i+1}.png')
    write_package(root)
    print('Wrote all SVG, 600-dpi PNG, PDF and ZIP outputs.',flush=True)

def write_package(root):
    out=root/'docs/diagrams/paper'; pdf_path=root/'output/pdf/edunexus-figures-7-9.pdf'
    with zipfile.ZipFile(root/'output/edunexus-capstone-figures-7-9.zip','w',zipfile.ZIP_DEFLATED) as package:
        package.writestr('START-HERE.txt','EDUNEXUS capstone Figures 7-9\n\nIndividual SVG/PNG files in docs/diagrams/paper print at exactly 6.5 inches wide. Captions belong below them in Word.\nThe three-page output/pdf/edunexus-figures-7-9.pdf provides a captioned preview. Read docs/diagrams/paper/README.md for notation and scope.\nGenerators require a full EDUNEXUS checkout.\n')
        files=[*out.glob('*'),pdf_path,root/'docs/system-and-erd-review-2026-09-28.md',root/'scripts/render-paper-erds.py',root/'scripts/paper_erd_geometry.py',root/'scripts/check-paper-erds.py',root/'scripts/export-erd-schema.ts']
        for p in sorted(files):
            if p.is_file(): package.write(p,p.relative_to(root).as_posix())
