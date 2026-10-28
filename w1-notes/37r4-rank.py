R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'public/harness.js'
s = open(R + P).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("""// The collections a span's view lists, as the data answer ranks them:
// those with a red flag first, in the order of their first red flag in the
// engine's order (so the base pane's collections, and what lost data, come
// before the PR's own and its padding); then those whose rows moved; then
// those with an amber flag; then any other change; then the rest; each in
// name order. So padding a PR adds, flagged or not, can't push a changed
// one out of those drawn.
""", """// The collections a span's view lists, ranked as the data answer ranks
// them. First the base pane's (seeded) ones, those its diff lists: with a
// red flag, by where their first red flag stands in the answer's order
// (so what lost data comes first); then those whose rows moved; then those
// with any flag. Then the others with a flag, by their first flag's place
// (the answer lists every flag of the seeded collections first, so a
// seeded one the base diff doesn't list still comes before the PR's own
// flagged tables); then those whose rows moved; then any other change;
// then the rest; each in name order. So padding a PR adds, flagged or not,
// can't push a seeded one out of those drawn. The answer's key order isn't
// used: a name like `0` sorts first in any object, whatever its rank.
""")
sub("""  const firstRed = new Map()
  const amber = new Set()
  ;(span.flags || []).forEach((f, i) => {
    if (!f || typeof f.collection !== 'string') return
    if (f.severity === 'red') { if (!firstRed.has(f.collection)) firstRed.set(f.collection, i) } else amber.add(f.collection)
  })
  const rank = name => {
    if (firstRed.has(name)) return [0, firstRed.get(name)]
    const c = collections[name]
    return [moved(c, view) ? 1 : amber.has(name) ? 2 : c && c.status !== 'same' ? 3 : 4, 0]
  }
""", """  const firstRed = new Map()
  const firstFlag = new Map()
  ;(span.flags || []).forEach((f, i) => {
    if (!f || typeof f.collection !== 'string') return
    if (!firstFlag.has(f.collection)) firstFlag.set(f.collection, i)
    if (f.severity === 'red' && !firstRed.has(f.collection)) firstRed.set(f.collection, i)
  })
  const rank = name => {
    const c = collections[name]
    const rows = moved(c, view)
    if (listedIn(span, 'base', name)) {
      if (firstRed.has(name)) return [0, firstRed.get(name)]
      if (rows) return [1, 0]
      if (firstFlag.has(name)) return [2, firstFlag.get(name)]
    }
    if (firstFlag.has(name)) return [3, firstFlag.get(name)]
    return [rows ? 4 : c && c.status !== 'same' ? 5 : 6, 0]
  }
""")
sub("""  // the flags, red first, at most SHOWN_FLAGS, and how many more there are
  const flags = [...flagsOf].sort((a, b) => (a.severity === 'red' ? 0 : 1) - (b.severity === 'red' ? 0 : 1))
""", """  // the flags in the answer's order (every flag of the seeded collections
  // first, amber ones too, then the PR's own, red first within each), at
  // most SHOWN_FLAGS, and how many more there are
  const flags = [...flagsOf]
""")
open(R + P, 'w').write(s)
print('ok')
