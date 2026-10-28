import json
import sys
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
REPLY = sys.argv[1]
s = open(N + 'body-36-live.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""**Draft. Depends on #35; review only the commits after 7193877** (#35's head, which carries `main` at `561bd84`): `7193877..7055c24`. This branch follows #35 by merging, never by rebasing.""",
    """**Draft. Depends on #35; review only what is past #35's head, `4a284f9`** (which carries `main` at `561bd84`): `4a284f9..2b8379d`. This branch follows #35 by merging, never by rebasing.""")
sub("""**Round 4:** `7055c24` fixes round 3's review of `a2bbc7c` (comment 6198758962). The answers, item by item, are in the comments, the last in comment 6340303860.""",
    f"""**Round 4:** `7055c24` fixes round 3's review of `a2bbc7c` (comment 6198758962). **Round 5:** `2b8379d` answers round 4's review of `7055c24` (comment 6341158113), under the owner's decision W28=B. The answers, item by item, are in the comments, the last in comment {REPLY}.""")
sub("""  - **Collections:** a diff lists at most 1,000 collections, ranked:
    1. those with a red flag;
    2. changed rows;
    3. an amber flag;
    4. any other change.""",
    """  - **Collections:** a diff lists at most 1,000 collections, ranked:
    1. those with a red flag, in the order of their first flag in the engine's order. So the base pane's collections come before the PR's own, and what lost data comes before column and mass-change flags (round 5);
    2. changed rows;
    3. an amber flag;
    4. any other change.""")
sub("""  - **The budget:** all of those lists, and each collection's own entry (name, key, counts), share 2 MB a span, in this order: the flags, the PR pane's diff, the divergence, then the base pane's diff.""",
    """  - **The budget:** all of those lists, and each collection's own entry (name, key, counts), share 2 MB a span, counted in bytes as UTF-8. The flags go first. Then the PR pane's diff, the divergence and the base pane's diff are listed by rank across all three: every list's red-flagged collections, then every list's changed ones, and so on (round 5).""")
sub("""  - Paging the rest is left for later.""",
    """  - Paging the rest is left for later.
  - **Its time isn't bounded** (owner decision W28=B, round 5). The engine runs on the conductor's event loop: `take()` masks a snapshot, `settle()` diffs one, and each answer's build diffs both panes' session snapshots, flags them and lists them, once per state and trust.
    - **The worst cases round 4's review measured** within the default limits (10,000 rows, 32 MB), as the event loop's longest hold:

      | Probe | Ready | Snapshot now | Answer build |
      |---|---|---|---|
      | 200 PR tables of 10,000 rows | 18.2 s | 6.9 s | 7–9 s |
      | 4 seeded tables × 96 fields, rewritten | 10.3 s | 7.0 s | 8.0 s |
      | one 10,000-row table with 100 fields cleared | | | 22.3 s; now about 0.4 s, since #35's `tally()` is linear |

    - Masking can be slower still in the worst shapes: #35's review measured about 4 minutes for a 32 MB snapshot of lines that look like JSON.
    - **This is accepted:** the PR's authors passed the trust gate, it needs the harness capability, and it shows no masked value and hides or excuses no destructive change. It only slows that PR's review.
    - The README says so in the `GET /api/data` row and under Known limits ("Hostile PR data and the conductor's responsiveness").
    - Moving the engine to a worker thread, or yielding between collections, is the fuller fix, and is left for a follow-up.""")
sub("""  - **Judgment call, round 4:** the flags keep the engine's order, the base pane's collections first and destructive kinds before `unverified`, rather than every non-`unverified` red flag first.""",
    """  - **Judgment call, round 4:** the flags keep the engine's order, the base pane's collections first and destructive kinds before `unverified`, rather than every non-`unverified` red flag first. Since round 5 the collections follow it too, and within the base pane's collections what loses data comes before column and mass-change flags (#35).""")
sub("""- **Tests:** 866 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). New here:
  - `test/data-capture.test.mjs`: 32 tests;""",
    """- **Tests:** 883 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). New here:
  - `test/data-capture.test.mjs`: 40 tests;""")
sub("""the late-baseline wording, the divergence's cut and count, and the budget's halves.""",
    """the late-baseline wording, the divergence's cut and count, and the budget's halves. Round 5 added 12 more on the ranking by flag order, the tiers across lists, the cut marker, the byte count and the reason, all killed, and assertions for the 11 round 4 found alive.""")
json.dump({'body': s}, open(N + 'body-36-new.json', 'w'))
print('ok')
