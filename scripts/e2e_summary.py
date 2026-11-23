import json,sys
r=json.load(open('tests/.e2e-result.json'))
def walk(s):
    for x in s.get('suites',[]): yield from walk(x)
    for sp in s.get('specs',[]):
        for t in sp['tests']:
            res=t['results'][-1]
            yield sp['title'], res['status'], (res.get('error') or {}).get('message','')
for s in r['suites']:
    for t,st,m in walk(s):
        print(st,'|',t)
        if m: print('   ', m.replace('\n',' ')[:700])
