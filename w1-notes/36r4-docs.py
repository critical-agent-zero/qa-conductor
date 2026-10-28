R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""**The answer is bounded, at about 4 MB:** a diff lists at most 1,000 collections, with `collectionsCount`: those with a red flag first, then those with changed rows, then those with an amber flag, then any other change, so a PR's empty or count-only padding can't push a flagged one out.""",
     """**The answer is bounded, at about 4 MB (in bytes, as UTF-8):** a diff lists at most 1,000 collections, with `collectionsCount`: those with a red flag first (in the order of their first flag, so the base pane's collections, and what lost data, come first), then those with changed rows, then those with an amber flag, then any other change, so a PR's padding, flagged or not, can't push a seeded one out."""),
    ("""The flags, then the PR pane's diff, the divergence and the base pane's diff, each collection's own entry (its name, key and counts) included, share 2 MB a span; a collection the budget cut says `cut: true`, and so does a diff or divergence whose listing it stopped.""",
     """The flags first, then the PR pane's diff, the divergence and the base pane's diff by rank across all three (every list's red-flagged collections, then every list's changed ones, and so on), each collection's own entry (its name, key and counts) included, share 2 MB a span; a collection the budget cut says `cut: true`, and so does a diff or divergence whose listing it stopped. **Its time is bounded too:** the work runs on the event loop that serves the panes, in proportion to the cells the snapshots keep (`LIMITS.maxCells`, 500,000 a snapshot). The session span's diffs are made once for each state, and the boot span once for each settle, whatever the trust. On the Mac this was measured on, a read at the bound held the loop about 0.5 s, and the answer's first build after it about 0.7 s."""),
])
edit('CHANGELOG.md', [
    ("""  - **One answer stays small, about 4 MB at most:**""",
     """  - **Bounded in time too:** a snapshot keeps at most 500,000 cells, so a read, and the answer built after it, hold the event loop that serves the panes for under a second at the bound, where 1 million PR rows held it 7 to 22 s. The session span's diffs are made once for each state, the boot span once for each settle, whatever the trust.
  - **One answer stays small, about 4 MB at most:**"""),
])
print('ok')
