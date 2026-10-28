import glob, json, re
R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/run/'
for f in sorted(glob.glob(R + 'review-36*/findings.json') + glob.glob(R + 'review-37*/findings.json') + glob.glob(R + 'review-35e/findings.json')):
    s = json.dumps(json.load(open(f)))
    hits = []
    for m in re.finditer(r'[^.]{0,200}(amber|cleared|base read|base pane.s read|no base diff|base diff is null|timers phase)[^.]{0,200}', s):
        t = m.group(0)
        if any(w in t for w in ('rank', 'push', 'listed', 'hidden', 'bury', 'timed out', 'null')):
            hits.append(t[:300])
    print('==', f.replace(R, ''), len(hits))
    for h in hits[:6]:
        print('   ', h)
