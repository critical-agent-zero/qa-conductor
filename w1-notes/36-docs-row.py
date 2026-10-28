p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/README.md'
orig = open('/private/tmp/claude-502/-Users-mc-Documents-GitHub-homefree--claude-worktrees-qa-conductor-stage05/013e4732-ceef-439a-94a4-f253ff944b6b/scratchpad/readme-36-head.md').read()
lines = open(p).read().split('\n')
start = next(i for i, l in enumerate(lines) if l.startswith('| `GET /api/data` |'))
end = next(i for i in range(start, len(lines)) if lines[i].startswith('  - **An answer still too big to build**'))
row = lines[start]
tail_marker = "`complete` is `false` in either case."
assert row.endswith(tail_marker), row[-80:]
orow = next(l for l in orig.split('\n') if l.startswith('| `GET /api/data` |'))
after = orow.split("a collection the budget cut says `cut: true`.", 1)[1]
new = (row + " **The answer is bounded, at about 4 MB:** a diff lists at most 1,000 collections, with `collectionsCount`: those with a red flag first, then those with changed rows, then those with an amber flag, then any other change, so a PR's empty or count-only padding can't push a flagged one out. Each has 50 rows of each kind, 50 dropped and 50 added fields, with whole `counts`; a divergence has 50 changes a collection (`changesCount`), ranked the same way. A span has at most 500 flags, red first in the engine's order, with whole `flagsCount` (`{red, amber}`); past 20 red `unverified` flags of named collections, the rest are one flag in their place, `{collection: null, kind: 'unverified', folded: true, collections, names}`. Each pane has at most 50 `problems`, with `problemsCount`, and an error's text is cut at 500 characters. The flags, then the PR pane's diff, the divergence and the base pane's diff, each collection's own entry (its name, key and counts) included, share 2 MB a span; a collection the budget cut says `cut: true`, and so does a diff or divergence whose listing it stopped. An answer still too big to build is built without its lists: each span then has `unlisted: true`, no `base`, `pr` or `divergence`, a red `unlisted` flag and its first 20 red flags, and `flagsCount` counts the `unlisted` flag too." + after)
lines[start:end + 1] = [new]
open(p, 'w').write('\n'.join(lines))
print('ok', new[-200:])
