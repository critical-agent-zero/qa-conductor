p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/server.test.mjs'
L = open(p).read().split('\n')
a = next(i for i, l in enumerate(L) if l.startswith('<<<<<<< HEAD'))
m = next(i for i in range(a, len(L)) if L[i].startswith('======='))
e = next(i for i in range(m, len(L)) if L[i].startswith('>>>>>>>'))
# both: PR D's verdict test, then PR C's two new ones
L[a:e + 1] = L[a + 1:m] + [''] + L[m + 1:e]
s = '\n'.join(L)
assert '<<<<<<<' not in s and '>>>>>>>' not in s
open(p, 'w').write(s)
print('ok')
