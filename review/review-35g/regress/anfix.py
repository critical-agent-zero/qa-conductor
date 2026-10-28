import json, glob, collections, re
# The fix prototype (vfix) as the new head: what it shows that any head hid.
groups = collections.defaultdict(list)
cut = collections.Counter()
for f in sorted(glob.glob('fixrun/out-*.jsonl')):
    for line in open(f):
        d = json.loads(line)
        if not d['mask']:
            cut[','.join(sorted(d['regress']))] += 1
            continue
        hs = sorted(d['mask'])
        t = d['text']
        if hs == ['2ec0bba']:
            k = 'P5 short scheme value (design)'
        elif set(hs) <= {'2ec0bba', '7193877'} and re.search(r'%[0-9A-Fa-f]', t):
            k = 'P4? escape hex digit'
        else:
            k = 'OTHER'
        groups[(k, ','.join(hs))].append(d)
print('cut-only:', dict(cut))
for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1])):
    print(f'{len(v):6}  {k}')
    if k[0] in ('OTHER', 'P4? escape hex digit'):
        for d in sorted(v, key=lambda d: len(d['text']))[:6]:
            print('   TEXT', repr(d['text'])[:300])
            print('   vfix', d['out']['vfix'][:300])
            for h in d['mask']:
                print('   ', h, d['out'][h][:300])
