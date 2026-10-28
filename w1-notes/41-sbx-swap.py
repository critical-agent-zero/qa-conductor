p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/docs.test.mjs'
c = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/41-sbx-test.mjs'
s = open(p).read()
start = s.index("// The README's sandbox-exec profile, run as written, on a Mac")
end_marker = "  assert.match(missing.stderr, /string-append/)\n})\n"
end = s.index(end_marker, start) + len(end_marker)
s = s[:start] + open(c).read() + s[end:]
open(p, 'w').write(s)
print('ok')
