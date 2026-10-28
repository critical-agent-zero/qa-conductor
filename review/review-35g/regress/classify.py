import json, glob, collections, re
# Final per-class counts of masking regressions at 4033285 (uncut), all head runs.
def klass(d):
    t = d['text']; hs = sorted(d['mask'])
    if hs == ['2ec0bba']: return 'P5 short scheme value (by design since 7193877)'
    if set(hs) <= {'2ec0bba', '7193877', '4a284f9'} and re.search(r'%3[0-9A-Fa-f]', t) and not re.search(r'value\s*=', t, re.I):
        return 'P4 escape hex digit read as a key letter'
    if re.search(r'(?i)\bbasic\s{1,4}[A-Za-z0-9+/]*(bearer|token|basic)\s', t) and hs == ['7193877']:
        return 'P2 Basic base64-like value swallows the next scheme word (since 4a284f9)'
    if re.search(r'(?i)\b(key|name|id|type)\s*=\s*(\s[\w-]+|(key|name|id|type))=', t) and '4ed6449' not in hs:
        return 'P1 empty name-like attribute takes the next name (since 4ed6449)'
    if len(t) > 1000 and re.search(r'<[\w:.-]+\s', t): return 'E1 tag over 1024 raw (JWT/DSN in a sibling attribute)'
    if re.search(r'<[\w:.-]+\s', t) and re.search(r'(?i)value\s*=', t): return 'E2/E3 element vs DSN order'
    if re.search(r'(?i)(bearer|basic|token)\s', t): return 'A1/P3 scheme rescan'
    return 'other'
groups = collections.defaultdict(list)
total = 0
for f in sorted(glob.glob('out-fuzz-*.jsonl')):
    for line in open(f):
        d = json.loads(line)
        if not d['mask']: continue
        groups[(klass(d), ','.join(sorted(d['mask'])))].append(d)
for k, v in sorted(groups.items()):
    print(f'{len(v):6}  {k[0]:70} masked at [{k[1]}]')
for k, v in sorted(groups.items()):
    if k[0] in ('other', 'A1/P3 scheme rescan', 'P1 empty name-like attribute takes the next name (since 4ed6449)'):
        for d in sorted(v, key=lambda d: len(d['text']))[:3]:
            print('--', k, repr(d['text'])[:220])
