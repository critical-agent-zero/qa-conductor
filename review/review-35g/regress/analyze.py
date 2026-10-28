import json, sys, glob, collections, re
# Groups masking regressions (uncut) by which earlier heads hid them.
files = sys.argv[1:] or glob.glob('out-fuzz-*.jsonl')
groups = collections.defaultdict(list)
cutonly = collections.Counter()
for f in files:
    for line in open(f):
        d = json.loads(line)
        if not d['mask']:
            cutonly[','.join(sorted(d['regress']))] += 1
            continue
        key = ','.join(sorted(d['mask']))
        groups[key].append((f, d))
print('cut-only (truncation shift, not masking):', dict(cutonly))
for key, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
    print(f'\n##### masked at [{key}] shown at head: {len(items)}')
    # sort by text length, show a few shortest
    items.sort(key=lambda x: len(x[1]['text']))
    for f, d in items[: int(os_n) if (os_n := 6) else 6]:
        print('--', f, d['names'], d['wrap'], 'frags', d['mask'])
        print('   TEXT', repr(d['text'])[:400])
        print('   head', d['out']['4033285'][:400])
        for h in sorted(d['mask']):
            print('   ', h, d['out'][h][:400])
