W = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/'
s = open(W + 'notes/pr37-live.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("**Draft. Depends on #36; review only the commits after 31056d0** (#36's head): `31056d0..16e03c1`, 2 commits, 10 files, +1,244 −26.",
    "**Draft. Depends on #36; review only the commits after a2bbc7c** (#36's head): `a2bbc7c..fc2cc1a`, 3 commits, 10 files, +1,423 −26.")
i = s.index("**Round 2:** `16e03c1`")
j = s.index("\n", i)
s = s[:j] + "\n\n**Round 3:** `fc2cc1a` fixes round 2's review of `16e03c1`: a PR pane that couldn't be read shows as unknown changes (with #36's `unreadable` flag), Incomplete says why per pane, and separators are escaped; the answer, item by item, is in the comments." + s[j:]
i = s.index("- **C. Trusted vs advisory follows the isolation verdict,**")
j = s.index("\n", i)
s = s[:j] + " A PR pane that couldn't be read is a red flag too, counted in the badge: its changes are unknown, never \"No destructive change.\". The badge reads the answer's `flagsCount`, so flags the answer leaves out still count. A span whose panes' windows differ says so, and nothing in it is excused." + s[j:]
sub("- **Tests:** 817 passed on Node 24 and on Node 22 (`npm test`). New here:", "- **Tests:** 850 passed on Node 24 and on Node 22 (`npm test`). New here:")
i = s.index("  Round 2 added 52 more")
j = s.index("\n", i)
s = s[:j] + " Round 3 added 19 more, all killed: the badge's `flagsCount`, the unreadable text and its fallback, separators, cut digests, the wording per pane, the unaligned line, each pane's baseline, the flag count, a flag's class, grouping's window and ties, four strings set apart, a failed read's guard, and polling once." + s[j:]
open(W + 'pr8d-body.md', 'w').write(s)
print('ok')
