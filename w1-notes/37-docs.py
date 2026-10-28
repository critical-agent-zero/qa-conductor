R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""  - It shows at most 300 collections and 100 flags, the red first, and 50 rows of each kind a collection, with how many more there are.""",
     """  - It shows at most 300 collections and 100 flags, the red first, and 50 rows of each kind a collection, with how many more there are, from the answer's whole counts (fields dropped and added included). The collections with a red flag come first, then any that changed or are unknown, so a PR's padding can't push a changed one out of those drawn. One flag can stand for many collections: those only the PR pane has, or those past the ones listed one by one."""),
    ("""  - A span whose PR pane couldn't be read says its changes are unknown, red, and the badge counts it. A span says why it is incomplete: a pane with no data, or windows that differ (a pane's ready read failed), which a Re-baseline fixes for the session span.""",
     """  - A span whose PR pane couldn't be read says its changes are unknown, red, and the badge counts it, and so does one neither pane could be read for. "Nothing to compare yet" is only for before the first snapshot. A PR pane whose baseline is the snapshot just taken (its ready read failed) says so: take another to see its changes. A span says why it is incomplete: a pane with no data, or windows that differ (a pane's ready read failed), which a Re-baseline fixes for the session span only. A span whose details were too big to list shows its counts and first red flags."""),
])
edit('CHANGELOG.md', [
    ("""A PR pane that couldn't be read is red and counted: its changes are unknown, never "no destructive change";""",
     """A PR pane that couldn't be read is red and counted, and so is a span neither pane could be read for after a snapshot: its changes are unknown, never "no destructive change" or "nothing to compare". Flagged and changed collections are drawn first;"""),
])
print('ok')
