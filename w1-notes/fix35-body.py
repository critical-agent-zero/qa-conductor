p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/pr8b-body.md'
s = open(p).read()
first = s.split('\n', 1)[0]
s = s.replace(first, "**Draft. Depends on #34; review only the commits after 07098b8** (#34's head): `07098b8..79e3efc`. That is 4 commits plus 3 merges of #34, 5 files. The rest of the diff is #34. This branch follows #34 by merging, never by rebasing.", 1)
a = s[s.index("- **G. A truncated collection"):s.index("- **I. The design's thresholds")]
b = """- **G. A truncated collection compares only counts, and never claims nothing changed.** Its status is `unknown` when the count stayed put, or when only one pane's is truncated.
  - **Its budget is shared fairly:** the fewest rows first, each with at most an equal share of what is left, and at most 1,000 collections. One collection can't starve the others.
  - **A collection the PR pane cut short where the base's wasn't,** or a cut-short one whose count changed, is a red `unverified` flag. It is amber only when trusted and the base was cut short with the same change.
- **H. A flag is amber only when the base made the same change (`shared`), and only when `trusted` is `true`.**
  - **The same change means:** the same rows by key (or as a multiset), with the same fields changed; the same field; or, for two cut-short collections, the same change in count.
  - **Counts:** a count stands for rows only when both panes have only counts.
  - **Otherwise the flag is red.** Following the owner's rule, an advisory session (any isolation verdict but `isolated`) makes every flag red. A `cleared` field is amber at most.
  - **`shared` is reported** whatever the trust, so the harness can say which changes only the PR made.
"""
s = s.replace(a, b, 1)
s = s.replace("- **Tests:** 770 passed on Node 24 and on Node 22 (`npm test`). 23 are in `test/data-diff.test.mjs`, all new.",
              "- **Tests:** 774 passed on Node 24 and on Node 22 (`npm test`). 33 are in `test/data-diff.test.mjs`, all new.\n- **The orchestrator's review** (two high, three medium, lows) is answered in `79e3efc`, item by item in a comment. 17 hand mutants of that round's changes, all killed after three more tests.")
open(p, 'w').write(s)
print('ok')
