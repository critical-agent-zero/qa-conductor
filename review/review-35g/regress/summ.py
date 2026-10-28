import json, sys, glob, collections
# Per-run totals, and masking regressions bucketed by class.
tot = 0
for f in sorted(glob.glob('sum-*.json')):
    t = open(f).read()
    try:
        d = json.loads(t[t.index('{'):])
    except Exception as e:
        print(f, 'unreadable', e, t[:200]); continue
    tot += d['cases']
    print(f"{f:28} cases {d['cases']:7} regress {d['regress']:5} mask {d['regressMask']:5} byOld {d['byOld']} ms {d['ms']}")
print('total cases', tot)

import re
def klass(d):
    t = d['text']; hs = sorted(d['mask'])
    if hs == ['2ec0bba']: return 'P5 short scheme value (by design since 7193877)'
    if re.search(r'%3[0-9A-Fa-f]?[A-Fa-f]?', t) and set(hs) <= {'2ec0bba', '7193877'}: return 'P4? escape hex digit as key letter'
    if re.search(r'<[\w:.-]+\s', t) and re.search(r'value\s*=', t, re.I):
        if len(t) > 1000: return 'E1 tag over 1024 raw (JWT/DSN in sibling attr)'
        return 'E* element vs DSN/scheme order'
    if re.search(r'(?i)(bearer|basic|token)\s', t): return 'A* scheme rescan / P2/P3'
    return 'other'
groups = collections.defaultdict(list)
for f in sorted(glob.glob('out-fuzz-*.jsonl')):
    for line in open(f):
        d = json.loads(line)
        if not d['mask']: continue
        groups[(klass(d), ','.join(sorted(d['mask'])))].append(d)
for k, v in sorted(groups.items(), key=lambda kv: (kv[0][0], -len(kv[1]))):
    print(f'{len(v):6}  {k[0]:50} masked at [{k[1]}]')
if '-o' in sys.argv:
    for k, v in groups.items():
        if k[0] == 'other' or k[0].startswith('A*'):
            for d in sorted(v, key=lambda d: len(d['text']))[:4]:
                print('--', k, repr(d['text'])[:300]); print('   head', d['out'].get('4033285', '')[:300])
