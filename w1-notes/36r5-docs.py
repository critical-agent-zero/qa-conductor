R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
s = open(R + 'README.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("a diff lists at most 1,000 collections, with `collectionsCount`: those with a red flag first (in the order of their first flag, so the base pane's collections, and what lost data, come first), then those with changed rows, then those with an amber flag, then any other change, so a PR's padding, flagged or not, can't push a seeded one out.",
    "a diff lists at most 1,000 collections, with `collectionsCount`: the base pane's (seeded) collections first, those with a red flag, then changed rows, then an amber flag; then the PR's own, those with a red flag, then changed rows, an amber flag, any other change. Flagged ones go by their first flag's place in the flags' order, then all by name. So the PR's own tables, flagged or not, can't push a seeded collection's change out. A seeded collection is one the span's base diff has; without one (the base pane's read failed, or became its late baseline), one in the base pane's newest snapshot, else one the PR pane's boot didn't add.")
sub("A span has at most 500 flags, red first in the engine's order, with whole `flagsCount` (`{red, amber}`);",
    "A span has at most 500 flags, with whole `flagsCount` (`{red, amber}`): every flag of the seeded collections first, amber ones too, then the PR's own, red first within each; within those, what loses rows (deletes, emptying, drops, and a seeded collection the PR's snapshots may have left out or cut short where the base pane's didn't) before a lost key, before the rest, each in the engine's order;")
sub("The flags first, then the PR pane's diff, the divergence and the base pane's diff by rank across all three (every list's red-flagged collections, then every list's changed ones, and so on), each collection's own entry (its name, key and counts) included, share 2 MB a span; a collection the budget cut says `cut: true`, and so does a diff or divergence whose listing it stopped.",
    "The flags first, then the PR pane's diff, the divergence and the base pane's diff, from one queue by the whole rank (tier, first flag, name), the lists in turn on a tie, so a collection's entry in each list comes before any lower-ranked entry of any list, each collection's own entry (its name, key and counts) included, share 2 MB a span. Listing stops at the first entry that doesn't fit: a collection the budget cut says `cut: true`, and so does a diff or divergence that stopped short of its end.")
sub("a red `unlisted` flag and its first 20 red flags (in the engine's order, so what loses data in the base pane's collections first)",
    "a red `unlisted` flag and its first 20 red flags (in the same order, so what loses data in the seeded collections first)")
sub("  - this is accepted. PR authors have passed the trust gate ([Security](#security)), and a stall shows no masked value and hides no destructive change: it only slows that PR's review. Tearing the session down ends it.",
    "  - every pane's read settles before any is masked, so one pane's masking, however slow, can't time out the other pane's read and leave a span without its base diff;\n  - this is accepted. PR authors have passed the trust gate ([Security](#security)), and a stall shows no masked value and hides no destructive change: it only slows that PR's review. Tearing the session down ends it.")
open(R + 'README.md', 'w').write(s)

c = open(R + 'CHANGELOG.md').read()
a = "1,000 collections a diff, red-flagged ones first in the order of their first flag (so the base pane's collections, and what lost data, come first), then changed ones, 50 rows, changes and fields of each kind a collection, 500 flags a span, red first, with `unverified` ones past 20 folded into one,"
b = "1,000 collections a diff, the base pane's first (red-flagged in the order of their first flag, so what lost data comes first, then changed, then amber-flagged), then the PR's own the same way, 50 rows, changes and fields of each kind a collection, 500 flags a span, every flag of the base pane's collections first, red first, with `unverified` ones past 20 folded into one,"
assert c.count(a) == 1
c = c.replace(a, b)
a = "The PR diff, the divergence and the base diff are listed by rank across all three."
b = "The PR diff, the divergence and the base diff are listed from one queue by rank across all three. A span without a base diff still tells the base pane's collections from the PR's own."
assert c.count(a) == 1
c = c.replace(a, b)
a = "Its time isn't bounded: a PR's data can hold the event loop for seconds (README, Known limits)."
b = "Its time isn't bounded: a PR's data can hold the event loop for seconds (README, Known limits). Every pane's read settles before any is masked, so one pane's slow masking can't time out the other's read."
assert c.count(a) == 1
c = c.replace(a, b)
open(R + 'CHANGELOG.md', 'w').write(c)
print('ok')
