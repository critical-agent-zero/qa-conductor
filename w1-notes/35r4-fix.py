p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""// What a snapshot may hold: rows per collection, bytes per pane snapshot,
// and how long the inspector may take.
export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, maxCollections: 1_000, timeoutMs: 30_000 })""",
    """// What a snapshot may hold: rows per collection, bytes and cells (a row's
// fields) per pane snapshot, and how long the inspector may take. maxCells
// bounds the work: masking a snapshot, and diffing and flagging two, takes
// time in proportion to their cells, and runs on the conductor's event loop.
export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, maxCells: 500_000, maxCollections: 1_000, timeoutMs: 30_000 })""")

sub("""  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes, maxCollections = LIMITS.maxCollections } = limits ?? {}""",
    """  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes, maxCells = LIMITS.maxCells, maxCollections = LIMITS.maxCollections } = limits ?? {}""")

sub("""  // The byte budget is shared fairly: collections with the fewest rows go
  // first, and each may use at most an equal share of what is left, so one
  // collection (a PR's padding, say) can't starve the others.
  const order = names.filter(name => !counted.has(name)).map(name => [rowsOf(name), name]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)
  let left = maxBytes
  const kept = new Map()
  order.forEach((name, i) => {
    const budget = Math.floor(left / (order.length - i))
    try {
      const out = sanitizeCollection(name, own(given, name), { masker, rules, maxRows, budget, problems })
      if (out === null) return
      left -= out.size
      kept.set(name, out.collection)""", """  // The byte and cell budgets are shared fairly: collections with the
  // fewest rows go first, and each may use at most an equal share of what is
  // left, so one collection (a PR's padding, say) can't starve the others. A
  // collection past its share is cut short, so only its count is compared.
  const order = names.filter(name => !counted.has(name)).map(name => [rowsOf(name), name]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)
  let left = maxBytes
  let cellsLeft = maxCells
  const kept = new Map()
  order.forEach((name, i) => {
    const budget = Math.floor(left / (order.length - i))
    const cellBudget = Math.floor(cellsLeft / (order.length - i))
    try {
      const out = sanitizeCollection(name, own(given, name), { masker, rules, maxRows, budget, cellBudget, problems })
      if (out === null) return
      left -= out.size
      cellsLeft -= out.cells
      kept.set(name, out.collection)""")

sub("""function sanitizeCollection(name, c, { masker, rules, maxRows, budget, problems }) {""",
    """function sanitizeCollection(name, c, { masker, rules, maxRows, budget, cellBudget = Infinity, problems }) {""")
sub("""  const countOnly = { size: 0, collection: { key: null, fields: null, rows: [], count, truncated: true } }""",
    """  const countOnly = { size: 0, cells: 0, collection: { key: null, fields: null, rows: [], count, truncated: true } }""")
sub("""  const rows = []
  let bad = 0
  for (const r of c.rows.slice(0, maxRows)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { bad++; continue }
    const row = {}
    for (const field of Object.keys(r).sort()) {""", """  const rows = []
  let bad = 0
  let cells = 0
  for (const r of c.rows.slice(0, maxRows)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { bad++; continue }
    // counted before the row is read, so the work stays within the share
    const names = Object.keys(r)
    if (cells + names.length > cellBudget) { truncated = true; break }
    cells += names.length
    const row = {}
    for (const field of names.sort()) {""")
sub("""  return { size, collection: { key, fields, rows, count, truncated } }
}""", """  return { size, cells, collection: { key, fields, rows, count, truncated } }
}""")

# tally: merge items in place, linear
sub("""      const merged = !was ? items : was.items === null || items === null ? null : [...was.items, ...items]""",
    """      // in place: a spread copy each time made this quadratic in a field's rows
      let merged = null
      if (!was) merged = items
      else if (was.items !== null && items !== null) { merged = was.items; for (const item of items) merged.push(item) }""")

# the flags' order: data-losing kinds first
sub("""  const prOwn = f => (f.collection === null || !Object.hasOwn(baseDiff.collections, f.collection) ? 1 : 0)
  const late = f => (f.kind === 'unverified' || f.kind === 'cleared' ? 1 : 0)""",
    """  const prOwn = f => (f.collection === null || !Object.hasOwn(baseDiff.collections, f.collection) ? 1 : 0)
  // what loses data (rows, a collection, the key) before what changes it in
  // bulk (a column, a mass change), before what can't be seen or is cleared
  const late = f => (LOSES_DATA.has(f.kind) ? 0 : f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)""")
sub("""const KINDS = ['delete', 'emptied', 'dropped', 'column-dropped', 'mass-change', 'key-lost', 'unverified', 'cleared']""",
    """const KINDS = ['delete', 'emptied', 'dropped', 'column-dropped', 'mass-change', 'key-lost', 'unverified', 'cleared']
const LOSES_DATA = new Set(['delete', 'emptied', 'dropped', 'key-lost'])""")
sub("""// The order: red first; within a severity, collections the base pane has
// before those only the PR pane has; then the destructive kinds before
// unverified and cleared; then by collection, kind and field.""",
    """// The order: red first; within a severity, collections the base pane has
// before those only the PR pane has; then the kinds that lose data (delete,
// emptied, dropped, key-lost), then column-dropped and mass-change, then
// unverified and cleared; then by collection, kind and field. So many
// column or mass-change flags can't push a delete out of a capped list.""")
open(p, 'w').write(s)
print('ok')
