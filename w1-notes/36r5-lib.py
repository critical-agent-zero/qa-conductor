R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/data-capture.mjs', [
    # rank: seeded first
    ("""// A collection's rank in a list, lowest first: a red flag (then by where
// its first flag stands in the engine's order, so the base pane's
// collections, and what loses data, come first), changed rows, an amber
// flag, any other change, none; then by name. `order` maps a collection to
// the index of its first flag, and `red` to whether it has a red one.
function rankOf({ order, red }, name, moved, changed) {
  if (red.has(name)) return [0, order.get(name)]
  return [moved ? 1 : order.has(name) ? 2 : changed ? 3 : 4, 0]
}""",
     """// A collection's rank in a list, lowest first: the base pane's (seeded)
// collections with a red flag, then with any flag, then the PR's own with a
// red flag, each by where its first flag stands in the answer's order (so
// what loses rows comes first); then changed rows, an amber flag, any other
// change, none; then by name. `order` maps a collection to the index of
// its first flag, `red` to whether it has a red one, and `own` to whether
// it is the PR's own.
function rankOf({ order, red, own }, name, moved, changed) {
  if (order.has(name) && !own(name)) return [red.has(name) ? 0 : 1, order.get(name)]
  if (red.has(name)) return [2, order.get(name)]
  return [moved ? 3 : order.has(name) ? 4 : changed ? 5 : 6, 0]
}"""),
    # the listing: one queue
    ("""// A span's PR diff, divergence and base diff, as an answer lists them. Each
// collection's entry is charged to the span's budget, with its rows,
// changes and fields cut (`cut` on the collection), and whole counts beside
// them. Listing goes by rank across the three lists: every list's red-flagged
// collections, then every list's changed ones, and so on, so a list's
// padding can't starve another's flagged entries. When the budget runs out,
// nothing more is listed, and a list that had more says `cut: true`.
function listedLists({ pr, divergence: div, base }, budget, flagged) {
  const lists = [['pr', pr, rowsChanged], ['divergence', div, divergenceMoved], ['base', base, rowsChanged]]
    .filter(([, d]) => d)
    .map(([which, d, moved]) => ({ which, d, todo: candidates(d.collections, flagged, moved), done: 0, collections: {} }))
  let stopped = false
  for (let tier = 0; tier <= 4 && !stopped; tier++) {
    for (const list of lists) {
      while (!stopped && list.done < list.todo.length && list.todo[list.done].rank[0] === tier) {
        const { name } = list.todo[list.done]
        const c = list.d.collections[name]
        if (list.which === 'divergence') {
          const { changes, ...rest } = c
          const size = entrySize(name, rest)
          if (size > budget.left) { stopped = true; break }""",
     """// A span's PR diff, divergence and base diff, as an answer lists them. Each
// collection's entry is charged to the span's budget, with its rows,
// changes and fields cut (`cut` on the collection), and whole counts beside
// them. Listing takes one queue across the three lists, by the whole rank
// (tier, first flag, name), and the lists in turn on a tie: so users's
// entry in the PR diff, then in the divergence, then in the base diff,
// before any lower-ranked entry of any list. When the budget runs out,
// nothing more is listed, and a list that had more says `cut: true`.
function listedLists({ pr, divergence: div, base }, budget, flagged) {
  const lists = [['pr', pr, rowsChanged], ['divergence', div, divergenceMoved], ['base', base, rowsChanged]]
    .filter(([, d]) => d)
    .map(([which, d, moved]) => ({ which, d, todo: candidates(d.collections, flagged, moved), done: 0, collections: {} }))
  const queue = lists.flatMap((list, at) => list.todo.map(item => ({ list, at, item }))).sort((x, y) => byRank(x.item, y.item) || x.at - y.at)
  let stopped = false
  for (const { list, item } of queue) {
    {
      {
        const { name } = item
        const c = list.d.collections[name]
        if (list.which === 'divergence') {
          const { changes, ...rest } = c
          const size = entrySize(name, rest)
          if (size > budget.left) { stopped = true; break }"""),
    # the flags' order in the answer
    ("""// A span's flags as an answer lists them, in the engine's order (the base
// pane's collections first, destructive kinds before `unverified`), red
// first.""",
     """// A span's flags as an answer lists them, in the answer's order (inAnswerOrder).
// The PR's own past LISTED_UNVERIFIED and so on, as before."""),
    # take: read and mask apart
    ("""  // A pane's snapshot through its probe, sanitized, or null with why.
  async function take(pane, phase, signal) {
    const probe = probes[pane]
    try {
      const raw = await bounded(s => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, timeoutMs: lim.timeoutMs }, signal: s }), lim.timeoutMs, signal)
      return { snap: { at: now(), ...sanitizeSnapshot(raw, { masker, rules, limits: lim }) }, error: null }
    } catch (err) {
      return { snap: null, error: `the ${phase} snapshot failed: ${messageOf(err)}` }
    }
  }""",
     """  // A pane's raw snapshot through its probe, or the reason it has none.
  async function read(pane, phase, signal) {
    const probe = probes[pane]
    try {
      return { raw: await bounded(s => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, timeoutMs: lim.timeoutMs }, signal: s }), lim.timeoutMs, signal), error: null }
    } catch (err) {
      return { raw: null, error: `the ${phase} snapshot failed: ${messageOf(err)}` }
    }
  }
  // A raw read, sanitized: masking runs on the event loop.
  const masked = ({ raw, error }) => (error !== null ? { snap: null, error } : { snap: { at: now(), ...sanitizeSnapshot(raw, { masker, rules, limits: lim }) }, error: null })
  // A pane's snapshot, sanitized, or null with why.
  const take = async (pane, phase, signal) => masked(await read(pane, phase, signal))
  // Every pane's raw read first, then each masked: one pane's masking,
  // which a PR's data can make long, never holds the event loop while
  // another pane's read is still timed.
  async function takeAll(panes, phase, signal) {
    const raws = await Promise.all(panes.map(pane => read(pane, phase, signal)))
    return raws.map(masked)
  }"""),
    ("""    const reads = await Promise.all(panes.map(pane => take(pane, 'ready', signal)))""",
     """    const reads = await takeAll(panes, 'ready', signal)"""),
    ("""      const reads = await Promise.all(panes.map(pane => take(pane, phase, life.signal)))""",
     """      const reads = await takeAll(panes, phase, life.signal)"""),
    # span: the answer's order, own, reason
    ("""    const span = (base, pr, aligned, why, div) => {
      if (!base && !pr && why === null) return null
      // each span its own share of the budget
      const budget = { left: Math.floor(viewBytes / 2) }
      const flags = pr ? flagChanges(base ?? { collections: {} }, pr, rules, { trusted: trust === 'trusted' && aligned }) : [unreadable(why === 'baseline' ? 'baseline' : base ? why ?? 'failed' : 'neither')]""",
     """    // Whether a collection is the PR's own, for a span: not in the span's
    // base diff; without one (the base pane's read failed, or its baseline
    // came late), not in the base pane's newest snapshot; without that,
    // one the PR's boot added.
    const ownOf = base => {
      if (base) return name => !Object.hasOwn(base.collections, name)
      const known = latest.base ?? baseline.base ?? seeded.base
      if (known) return name => !Object.hasOwn(known.collections, name)
      if (boot.pr) return name => Object.hasOwn(boot.pr.collections, name) && boot.pr.collections[name].status === 'added'
      return () => false
    }
    // `baseRead`: the base pane was read for this span, though it may have
    // no diff yet (its read became its late baseline)
    const span = (base, pr, aligned, why, div, baseRead = Boolean(base)) => {
      if (!base && !pr && why === null) return null
      // each span its own share of the budget
      const budget = { left: Math.floor(viewBytes / 2) }
      const own = ownOf(base)
      const flags = pr
        ? inAnswerOrder(flagChanges(base ?? { collections: {} }, pr, rules, { trusted: trust === 'trusted' && aligned }), own, pr)
        : [unreadable(why === 'baseline' ? 'baseline' : baseRead ? why ?? 'failed' : 'neither')]"""),
    ("""      const out = listedLists({ pr, divergence: base && pr ? div() : null, base }, budget, { order, red: reds })""",
     """      const out = listedLists({ pr, divergence: base && pr ? div() : null, base }, budget, { order, red: reds, own })"""),
    ("""      session: latestAt === null ? null : span(session.base, session.pr, both(session, baseRun), fresh.pr ? 'baseline' : 'failed', () => divergence(session.base, session.pr)),""",
     """      session: latestAt === null ? null : span(session.base, session.pr, both(session, baseRun), fresh.pr ? 'baseline' : 'failed', () => divergence(session.base, session.pr), Boolean(session.base) || fresh.base),"""),
])

# inAnswerOrder, after unreadable/unlisted definitions
edit('lib/data-capture.mjs', [
    ("""// An answer built without its lists: its details couldn't be listed.
const unlisted = () => ({ collection: null, kind: 'unlisted', severity: 'red', shared: false, pr: 1, base: 0 })""",
     """// An answer built without its lists: its details couldn't be listed.
const unlisted = () => ({ collection: null, kind: 'unlisted', severity: 'red', shared: false, pr: 1, base: 0 })
// A span's flags in the answer's order: the base pane's (seeded)
// collections' flags first, red then amber, before the PR's own red ones,
// so the PR's own tables can't push a seeded collection's flag out of a
// capped list; within each, what loses rows (deletes, emptying, drops, and
// a seeded collection the PR's snapshots may have left out) before a lost
// key, before the rest, each in the engine's order. `own` says whether a
// collection is the PR's own; `pr` is the PR pane's diff.
const ROW_LOSING = new Set(['delete', 'emptied', 'dropped'])
function inAnswerOrder(flags, own, pr) {
  const owned = f => (f.collection === null || own(f.collection) ? 1 : 0)
  const sev = f => (f.severity === 'red' ? 0 : 1)
  const leftOut = f => f.kind === 'unverified' && f.collection !== null && (!Object.hasOwn(pr.collections, f.collection) || Boolean(pr.collections[f.collection].omitted))
  const group = f => (ROW_LOSING.has(f.kind) || leftOut(f) ? 0 : f.kind === 'key-lost' ? 1 : 2)
  return flags.map((f, i) => [f, i]).sort(([a, i], [b, j]) => owned(a) - owned(b) || sev(a) - sev(b) || group(a) - group(b) || i - j).map(([f]) => f)
}"""),
])
print('ok')
