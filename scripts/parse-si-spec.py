import re, json, sys
t=open(sys.argv[1],encoding='utf8').read().splitlines()
kpis=[];reports=[];dom=None;rdom=None;sec=None
for l in t:
    m=re.match(r'^### ([A-Z]+) \| (.+)$',l)
    if m: dom=(m.group(1),m.group(2).strip()); sec='kpi'; continue
    m=re.match(r'^### 8\.(\d+) (.+)$',l)
    if m: rdom=(int(m.group(1)),m.group(2).strip()); sec='rep'; continue
    if l.startswith('### ') or l.startswith('## '): sec=None if not re.match(r'^### ([A-Z]+) \|',l) else sec
    if l.startswith('|') and not l.startswith('|---'):
        c=[x.strip() for x in l.strip('|').split('|')]
        if sec=='kpi' and re.match(r'^[A-Z]+-\d{3}$',c[0]):
            kpis.append(dict(id=c[0],domain=dom[0],domainName=dom[1],name=c[1],definition=c[2],unit=c[3]))
        if sec=='rep' and re.match(r'^R\d\d-\d\d$',c[0]):
            reports.append(dict(id=c[0],domain=rdom[0],domainName=rdom[1],name=c[1],question=c[2],grain=c[3]))
print(len(kpis),len(reports),file=sys.stderr)
json.dump(dict(kpis=kpis,reports=reports),open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
