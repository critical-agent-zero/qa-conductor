import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
s = open(N + 'body-36-live2.md').read()
pairs = [
    ("**Draft. Depends on #35; review only what is past #35's head, `4a284f9`** (which carries `main` at `561bd84`): `4a284f9..2b8379d`.",
     "**Draft. Depends on #35; review only what is past #35's head, `4ed6449`** (which carries `main` at `561bd84`): `4ed6449..f9c79a5`."),
    ("The answers, item by item, are in the comments, the last in comment 6346159242.",
     "`f9c79a5` merges #35's round 5 in, and keeps the engine's new `fieldsBefore` out of the answer (comment 6346527434). The answers, item by item, are in the comments, round 4's in comment 6346159242."),
    ("- **Tests:** 883 passed on Node 24 and on Node 22", "- **Tests:** 889 passed on Node 24 and on Node 22"),
]
for a, b in pairs:
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
json.dump({'body': s}, open(N + 'body-36-new2.json', 'w'))
print('ok')
