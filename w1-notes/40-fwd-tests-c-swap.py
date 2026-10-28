p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/forwarder.test.mjs'
c = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/40-fwd-tests-c.mjs'
s = open(p).read()
marker = "\n// The other way: a PR uploading to a slow host"
at = s.index(marker)
assert s.count(marker) == 1
s = s[:at] + open(c).read()
open(p, 'w').write(s)
print('swapped')
