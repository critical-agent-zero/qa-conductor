import json, sys, glob, collections, re
# Masking regressions masked only at 2ec0bba: are they all short scheme values?
files = sys.argv[1:]
other = []
n = 0
for f in files:
    for line in open(f):
        d = json.loads(line)
        if not d['mask'] or sorted(d['mask']) != ['2ec0bba']:
            continue
        n += 1
        out_old = d['out']['2ec0bba']
        frs = d['mask']['2ec0bba']
        # a fragment right after a scheme word at 2ec0bba's position
        sch = all(re.search(r'(Bearer|Basic|Token)\s{1,4}[A-Za-z0-9._~+/=-]*' + re.escape(fr), d['text']) for fr in frs)
        if not sch:
            other.append(d)
print('2ec0bba-only masking regressions:', n, 'not after a scheme word:', len(other))
for d in sorted(other, key=lambda d: len(d['text']))[:15]:
    print('--', d['names'], d['wrap'], d['mask'])
    print('   TEXT', repr(d['text'])[:300])
    print('   head', d['out']['4033285'][:300])
    print('   2ec0bba', d['out']['2ec0bba'][:300])
