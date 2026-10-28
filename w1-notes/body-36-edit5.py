import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
s = open(N + 'body-36-live5.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:80], s.count(a))
    s = s.replace(a, b, 1)


sub("**Draft. Depends on #35; review only what is past #35's head, `4ed6449`** (which carries `main` at `561bd84`): `4ed6449..f9c79a5`.",
    "**Draft. Depends on #35; review only what is past #35's head, `4033285`** (which carries `main` at `561bd84`): `4033285..46d0197`.")
sub("The answers, item by item, are in the comments, round 4's in comment 6346159242.",
    "**Round 6:** `feb0d43` merges #35's round 6 (`4033285`) in, and `46d0197` answers round 5's review of `f9c79a5` (comment 6346995789). The answers, item by item, are in the comments: round 4's in comment 6346159242, round 5's in comment 6348104440.")
sub("""  - **Collections:** a diff lists at most 1,000 collections, ranked:
    1. those with a red flag, in the order of their first flag in the engine's order. So the base pane's collections come before the PR's own, and what lost data comes before column and mass-change flags (round 5);
    2. changed rows;
    3. an amber flag;
    4. any other change.
""", """  - **Collections:** a diff lists at most 1,000 collections, the base pane's (seeded) ones first (round 6), ranked:
    1. seeded, with a red flag;
    2. seeded, with changed rows;
    3. seeded, with any flag;
    4. the PR's own, with a red flag;
    5. then changed rows, an amber flag, any other change, none.

    Flagged ones go by their first flag's place in the flags' order, then all by name. A seeded collection is one the span's base diff has; without one (the base pane's read failed, or became its late baseline), one in the base pane's newest snapshot, else one the PR pane's boot didn't add.
""")
sub("  - **Flags:** a span lists at most 500, red first in the engine's order. Red `unverified` flags past 20 are one flag in their place.",
    "  - **Flags:** a span lists at most 500: every flag of the seeded collections first, amber ones too, then the PR's own, red first within each (round 6). Within those, what loses rows (and a seeded collection the PR left out or cut short) comes before a lost key, before the rest, each in the engine's order. Red `unverified` flags past 20 are one flag in their place.")
sub("Then the PR pane's diff, the divergence and the base pane's diff are listed by rank across all three: every list's red-flagged collections, then every list's changed ones, and so on (round 5). A collection the budget cut says `cut`, and so does a diff whose listing it stopped.",
    "Then the PR pane's diff, the divergence and the base pane's diff are listed from one queue by the whole rank (tier, first flag, name), the lists in turn on a tie (round 6), so a collection's entry in each list comes before any lower-ranked entry of any list. Listing stops at the first entry that doesn't fit. A collection the budget cut says `cut`, and so does a list that stopped short of its end.")
sub("A PR that drops its padding raises thousands of red `dropped` flags on collections only it has, and those must not bury a seeded collection's `unverified`.",
    "A PR that drops its padding raises thousands of red `dropped` flags on collections only it has, and those must not bury a seeded collection's `unverified`. Since round 6 that holds without a base diff too, and for a seeded collection with only an amber flag.")
sub("| 22.3 s; now about 0.4 s, since #35's `tally()` is linear |",
    "| 22.3 s; now about 1.1 s on the same machine, since #35's `tally()` is linear |")
sub("    - **This is accepted:** the PR's authors passed the trust gate, it needs the harness capability, and it shows no masked value and hides or excuses no destructive change. It only slows that PR's review.",
    "    - **This is accepted:** the PR's authors passed the trust gate, it needs the harness capability, and it shows no masked value and hides or excuses no destructive change. It only slows that PR's review. Since round 6, `ready()` and `snapshot()` wait for every pane's raw read before masking any, so one pane's slow masking can't time out the other's read and leave a span without its base diff.")
sub("- **Tests:** 889 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). New here:\n  - `test/data-capture.test.mjs`: 40 tests;",
    "- **Tests:** 900 passed on Node 24 and on Node 22 (`node --test --test-force-exit`). New here:\n  - `test/data-capture.test.mjs`: 47 tests;")
sub("Round 5 added 12 more on the ranking by flag order, the tiers across lists, the cut marker, the byte count and the reason, all killed, and assertions for the 11 round 4 found alive.",
    "Round 5 added 12 more on the ranking by flag order, the tiers across lists, the cut marker, the byte count and the reason, all killed, and assertions for the 11 round 4 found alive. Round 6 added 14 on the one queue, the seeded tell, the answer's order, the raw reads first and the reason, all killed, and tests for the 8 round 5 found alive: 7 are killed or moot, and one is equivalent (below).")
sub("  Two survive as equivalent:\n  - a second `close()` closing nothing more, because the probes are already gone;\n  - the route's own \"the session ended\" check, which the capture's makes redundant. I kept it as a guard.",
    "  Three survive as equivalent:\n  - a second `close()` closing nothing more, because the probes are already gone;\n  - the route's own \"the session ended\" check, which the capture's makes redundant. I kept it as a guard;\n  - the PR's own collections' amber-flag tier: an own collection's only possible amber flag is `cleared`, whose rows changed, so it already ranks as changed rows.")
json.dump({'body': s}, open(N + 'body-36-new5.json', 'w'))
print('ok')
