p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/c37-r1.md'
s = open(p).read()
rep = {
    'HEAD8D': '16e03c1',
    'CI8D': 'green on Node 22 and 24',
    'TESTS8D': '817',
    'FIX8D': '16e03c1',
    'MUT8D': "52 hand mutants of these fixes and the carried items. 50 died at once. Two more died once tests were added: the Actions panel left open when the session ends, and a snapshot answer for an ended session being drawn. Every edge of `markOf` (its own pane, the window, both ties, the time-tie lookup) and each new CSP directive and its fallback are covered. So are the masker's raw `@` and `=` checks and its lower-case decoding.",
}
for k, v in rep.items():
    assert k in s, k
    s = s.replace(k, v)
open(p, 'w').write(s)
print('ok')
