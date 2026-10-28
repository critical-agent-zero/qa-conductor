p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/pr34-live-body.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b, 1)


sub("""  - comes from a budget of 2,000 per pane that refills one a second, so the PR pane can use up its own marks for as long as it keeps posting, never the base pane's. Each pane keeps its last 8,000 marks;
  - when refused, is counted per pane in `marksDropped`.""",
    """  - comes from a budget of 2,000 per pane that refills one a second, so the PR pane can use up its own marks for as long as it keeps posting, never the base pane's;
  - is kept in a ring of the pane's last 8,000 marks, so an older one is evicted;
  - when refused or evicted, is counted per pane in `marksDropped`.""")
sub("""A reader that reads on until `more` is false has had everything, once.""",
    """A reader that reads on until `more` is false has had everything still kept, once: `seq` is dense, so a gap means items were dropped.""")
sub("""  - else the nearest of the marks up to 300 ms after it started, the earlier on a tie;
  - else the landing.""",
    """  - else the nearest of the marks up to 300 ms after it started, the earlier (then the lower `seq`) on a tie;
  - else, when no mark is that early, the landing.""")
sub("""They cover masking, paging, grouping and its edges, per-pane caps, and the recorder's binding across a boot of the same PR.""",
    """They cover masking, paging, per-pane caps and evictions, and the recorder's binding across a boot of the same PR. Grouping is the reader's now, so its tests (its own pane, the window after a request, ties, the landing) are in #37, with the harness that groups.""")
sub("""- **Round 2** (three medium findings, and lows) is answered in `07098b8`, with 10 hand mutants of its changes, all killed.""",
    """- **Round 2** (three medium findings, and lows) is answered in `07098b8`, with 10 hand mutants of its changes, all killed.
- **Round 3** approved `07098b8`. Its lows and nits are carried into #37, so this head stays put: the five raw-escape table rows, the README's `GET /api/actions` row made precise, four separators between digits, `limit` 0 and −1, which clicks the harness's 100 ms gap posts, and the server test's name.""")
open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/pr8a-body-r3.md', 'w').write(s)
print('ok')
