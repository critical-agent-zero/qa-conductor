R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'public/harness.js'
s = open(R + P).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b)


sub("""// The collections a span's view lists, ranked as the data answer ranks
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
""", """// The collections a span's view lists, ranked as the data answer ranks
// them. First the base pane's (seeded) ones, those the span's base diff
// lists: with a red flag, by where their first red flag stands in the
// answer's order (so what lost data comes first); then those whose rows
// moved; then those with an amber flag. Then the others the same way: a
// red flag, rows moved, an amber flag; then any other change; then the
// rest; each in name order. So padding a PR adds, flagged or not, can't
// push a seeded one out of those drawn. A seeded one the base diff doesn't
// list (the answer's size cut it there, or the span has none) ranks with
// the others: a red flag still puts it first among them, since the answer
// lists the seeded collections' flags first, and any flag of it opens it.
// The answer's key order isn't used: a name like `0` comes first in any
// object, whatever its rank.
""")
sub("""    if (firstFlag.has(name)) return [3, firstFlag.get(name)]
    return [rows ? 4 : c && c.status !== 'same' ? 5 : 6, 0]
""", """    if (firstRed.has(name)) return [3, firstRed.get(name)]
    if (rows) return [4, 0]
    if (firstFlag.has(name)) return [5, firstFlag.get(name)]
    return [c && c.status !== 'same' ? 6 : 7, 0]
""")
open(R + P, 'w').write(s)

T = 'test/harness.test.mjs'
t = open(R + T).read()


def tsub(a, b):
    global t
    assert t.count(a) == 1, (a[:90], t.count(a))
    t = t.replace(a, b)


tsub("test('the Data panel draws at most 300 collections and 100 flags, red first, and says how many more', () => {",
     "test('the Data panel draws at most 300 collections and 100 flags, in the answer\\'s order, and says how many more', () => {")
tsub("""  const data = sampleData({ session: { complete: true, base: pane, pr: pane, divergence: null, flags: [...amber, ...red] } })
  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 'c0279' })""",
     """  const data = sampleData({ session: { complete: true, base: pane, pr: pane, divergence: null, flags: [...red, ...amber] } })
  const nodes = dataNodes(data, { span: 'session', view: 'pr', open: 'c0279' })""")
open(R + T, 'w').write(t)
print('ok')
