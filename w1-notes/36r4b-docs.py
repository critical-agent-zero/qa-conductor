R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""**The answer is bounded, at about 4 MB:** a diff lists at most 1,000 collections, with `collectionsCount`: those with a red flag first, then those with changed rows, then those with an amber flag, then any other change, so a PR's empty or count-only padding can't push a flagged one out.""",
     """**The answer is bounded, at about 4 MB (in bytes, as UTF-8):** a diff lists at most 1,000 collections, with `collectionsCount`: those with a red flag first (in the order of their first flag, so the base pane's collections, and what lost data, come first), then those with changed rows, then those with an amber flag, then any other change, so a PR's padding, flagged or not, can't push a seeded one out."""),
    ("""The flags, then the PR pane's diff, the divergence and the base pane's diff, each collection's own entry (its name, key and counts) included, share 2 MB a span;""",
     """The flags first, then the PR pane's diff, the divergence and the base pane's diff by rank across all three (every list's red-flagged collections, then every list's changed ones, and so on), each collection's own entry (its name, key and counts) included, share 2 MB a span;"""),
    ("""An answer still too big to build is built without its lists: each span then has `unlisted: true`, no `base`, `pr` or `divergence`, a red `unlisted` flag and its first 20 red flags,""",
     """**Its time isn't bounded:** it is built on the event loop that serves the panes, and a PR's data within the limits can hold that loop for seconds ([Known limits](#known-limits)). An answer still too big to build is built without its lists: each span then has `unlisted: true`, no `base`, `pr` or `divergence`, a red `unlisted` flag and its first 20 red flags (in the engine's order, so what loses data in the base pane's collections first),"""),
    ("""  - masking works through the raw data a PR's store holds, not just what is kept: every cell is read, and text that looks like JSON is parsed, before the budget is checked;""",
     """  - masking works through the raw data a PR's store holds, not just what is kept: every cell is read, and text that looks like JSON is parsed, before the budget is checked;
  - the data answer (`GET /api/data`) diffs both panes' snapshots, flags them and lists them on each build, once for each state and trust: 200 PR tables of 10,000 rows took about 7 to 9 s a build, and the ready read 18 s;"""),
])
print('ok')
