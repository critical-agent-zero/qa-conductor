R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
s = open(R + 'README.md').read()
a = "  - It shows at most 300 collections and 100 flags, the red first, and 50 rows of each kind a collection, with how many more there are, from the answer's whole counts (fields dropped and added included). The collections come in the answer's order: those with a red flag first, in the order of their first red flag in the engine's order (so the base pane's collections, and what loses rows, come before the PR's own), then those whose rows moved, then those with an amber flag, then any other change, then the rest. So a PR's padding, flagged or not, can't push a changed seeded one out of those drawn."
b = "  - It shows at most 300 collections and 100 flags, and 50 rows of each kind a collection, with how many more there are, from the answer's whole counts (fields dropped and added included). The flags come in the answer's order: every flag of the base pane's (seeded) collections first, amber ones too, then the PR's own, red first within each. The collections are ranked as the answer ranks them: first the seeded ones the base pane's diff lists, those with a red flag (in the order of their first red flag, so what loses rows comes first), then those whose rows moved, then those with an amber flag; then the rest the same way, then any other change, then the rest. So a PR's padding, flagged or not, can't push a changed seeded one out of those drawn. A seeded one the base pane's diff doesn't list (the answer's size cut it there, or the span has none) ranks with the PR's own: its red flag still puts it first among them, and any of its flags opens it."
assert s.count(a) == 1
s = s.replace(a, b)
open(R + 'README.md', 'w').write(s)
c = open(R + 'CHANGELOG.md').read()
a = "Data draws at most 300 collections, in the answer's order (red flags in the engine's order first, then rows moved), 100 flags and 50 rows of each kind, and a flag opens its collection;"
b = "Data draws at most 300 collections, ranked as the answer ranks them (the base pane's first), 100 flags in the answer's order and 50 rows of each kind, and a flag opens its collection;"
assert c.count(a) == 1
c = c.replace(a, b)
open(R + 'CHANGELOG.md', 'w').write(c)
print('ok')
