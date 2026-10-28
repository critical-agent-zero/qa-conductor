p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/README.md'
lines = open(p).read().split('\n')
i = lines.index('<<<<<<< HEAD')
j = lines.index('=======', i)
k = lines.index('>>>>>>> 46d0197', j)
ours = lines[i + 1:j]
theirs = lines[j + 1:k]
assert len(ours) == 2 and len(theirs) == 2
assert ours[0].startswith('| `GET /api/actions') and theirs[1].startswith('| `GET /api/data`')
lines[i:k + 1] = [ours[0], theirs[1]]
open(p, 'w').write('\n'.join(lines))
print('ok')
