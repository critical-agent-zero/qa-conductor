p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/test/harness.test.mjs'
L = open(p).read().split('\n')


def idx(prefix, start=0):
    for i in range(start, len(L)):
        if L[i].startswith(prefix):
            return i
    raise SystemExit('missing ' + prefix)


# conflict 1: fakeBrowser's signature, both the clock option and the query in the log
a = idx('<<<<<<< HEAD')
m = idx('=======', a)
e = idx('>>>>>>>', m)
L[a:e + 1] = [
    "function fakeBrowser({ hash = '#/', stored = null, routes = {}, elements = {}, clock = null }) {",
    "  const log = [] // ['fetch', method, path, headers, body, query] | ['replace', url] | ['source', url] | ['set', id, prop, value]",
]

# conflicts 2 and 3: PR D's panel tests (ending with the Actions test), then
# PR A's monotonic-clock test, each whole
a2 = idx('<<<<<<< HEAD')
m2 = idx('=======', a2)
e2 = idx('>>>>>>>', m2)
a3 = idx('<<<<<<< HEAD', e2)
m3 = idx('=======', a3)
e3 = idx('>>>>>>>', m3)
assert L[e3 + 1] == '})', L[e3 + 1]
ours1, theirs1 = L[a2 + 1:m2], L[m2 + 1:e2]
common = L[e2 + 1:a3]
ours2, theirs2 = L[a3 + 1:m3], L[m3 + 1:e3]
L[a2:e3 + 2] = ours1 + common + ours2 + ['})', ''] + theirs1 + common + theirs2 + ['})']
s = '\n'.join(L)
assert '<<<<<<<' not in s and '>>>>>>>' not in s
open(p, 'w').write(s)
print('ok')
