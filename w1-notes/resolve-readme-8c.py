p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/README.md'
lines = open(p).read().split('\n')
start = lines.index('<<<<<<< HEAD')
mid = lines.index('=======', start)
end = next(i for i in range(mid, len(lines)) if lines[i].startswith('>>>>>>> '))
ours = lines[start + 1:mid]
theirs = lines[mid + 1:end]
assert ours[0].startswith('| `GET /api/actions') and theirs[0].startswith('| `GET /api/actions') and len(theirs) == 1
merged = theirs + ours[1:]
lines[start:end + 1] = merged
open(p, 'w').write('\n'.join(lines))
print('resolved', len(merged))
