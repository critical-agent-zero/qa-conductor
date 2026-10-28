R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""That pane's spans then cover another window than the other pane's: they say so (`aligned: false`), are incomplete, and nothing in the base pane excuses a PR change there. A Re-baseline aligns the session span again; the boot span stays as it was.""",
     """That pane's spans then cover another window than the other pane's: they say so (`aligned: false`), are incomplete, and nothing in the base pane excuses a PR change there. A boot span is aligned only when both panes' baselines came from the ready read itself: when both ready reads failed, both panes' boot spans run on into the session, so they are unaligned too. `baselineAt` is the ready read's time only when a pane's baseline came from it. A Re-baseline aligns the session span again; the boot span stays as it was."""),
    ("""A span whose PR pane couldn't be read (a read that failed or hung, which PR code can cause with a lock) has a red `unreadable` flag: its changes are unknown, never none.""",
     """A span whose PR pane couldn't be read (a read that failed or hung, which PR code can cause with a lock) has a red `unreadable` flag: its changes are unknown, never none. So does one neither pane could be read for, once a snapshot was taken, and one whose PR pane's snapshot just became its baseline (its ready read failed), which has nothing yet to compare with. The flag's `reason` says which: `failed`, `neither` or `baseline`."""),
    ("""`boot` and `session` are each `{complete, aligned, flags, flagsCount, base, pr, divergence}`, or `null` before a snapshot. `base` and `pr` are each pane's diff, `null` for a pane with none; `aligned` is `false` when the panes' windows differ (one's ready read failed); `complete` is `false` in either case. The answer is bounded, at about 6 MB: a diff lists at most 1,000 collections, the changed first, with `collectionsCount`, and 50 rows of each kind, 50 dropped and 50 added fields a collection, with whole `counts`; divergence 50 changes a collection (`changesCount`); and a span at most 500 flags, red first, with whole `flagsCount` (`{red, amber}`). All of those lists share 2 MB a span; a collection the budget cut says `cut: true`.""",
     """`boot` and `session` are each `{complete, aligned, flags, flagsCount, base, pr, divergence}`, or `null` before a snapshot (`boot`: before the ready read). `base` and `pr` are each pane's diff, `null` for a pane with none; a span with neither has a red `unreadable` flag. `aligned` is `false` when the panes' windows differ (one's ready read failed); `complete` is `false` in either case.
  - **The answer is bounded, at about 4 MB:**
    - a diff lists at most 1,000 collections, with `collectionsCount`. Those with a red flag come first, then those with changed rows, then those with an amber flag, then any other change, so a PR's empty or count-only padding can't push a flagged one out;
    - each collection has 50 rows of each kind, 50 dropped and 50 added fields, with whole `counts`;
    - a divergence has 50 changes a collection (`changesCount`), ranked the same way;
    - a span has at most 500 flags, red first in the engine's order, with whole `flagsCount` (`{red, amber}`). Past 20 red `unverified` flags of named collections, the rest are one flag in their place, `{collection: null, kind: 'unverified', folded: true, collections, names}`;
    - each pane has 50 `problems`, with `problemsCount`, and an error's text is cut at 500 characters.

    The flags, then the PR pane's diff, the divergence and the base pane's diff, each collection's own entry (its name, key and counts) included, share 2 MB a span. A collection the budget cut says `cut: true`, and so does a diff or divergence whose listing it stopped.
  - **An answer still too big to build** is built without its lists. Each span then has `unlisted: true`, no `base`, `pr` or `divergence`, a red `unlisted` flag, and its first 20 red flags after it; `flagsCount` counts the `unlisted` flag too."""),
])

edit('CHANGELOG.md', [
    ("""A pane whose ready read failed keeps its seeded snapshot until a later one gives it a baseline; its spans then say their windows differ, and nothing in the base excuses a PR change there. A span whose PR pane couldn't be read has a red `unreadable` flag.""",
     """A pane whose ready read failed keeps its seeded snapshot until a later one gives it a baseline; its spans then say their windows differ, and nothing in the base excuses a PR change there. A boot span is aligned only when both baselines came from the ready read. A span whose PR pane couldn't be read, or neither pane after a snapshot, has a red `unreadable` flag, which says why."""),
    ("""  - **One answer stays small, about 6 MB at most:** 1,000 collections a diff, 50 rows, changes and fields of each kind a collection, and 500 flags a span, red first, within 2 MB a span, with whole counts. It is built once for each state.""",
     """  - **One answer stays small, about 4 MB at most:** 1,000 collections a diff, red-flagged and changed ones first, 50 rows, changes and fields of each kind a collection, 500 flags a span, red first, with `unverified` ones past 20 folded into one, and 50 problems a pane, within 2 MB a span that each collection's own entry counts against too, with whole counts. One still too big to build is built without its lists, keeping its counts and first red flags. It is built once for each state."""),
])
print('ok')
