p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-capture.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


# bytes, not characters
sub("""// At most `most` of a list, while `budget.left` bytes last. `cut` says the
// budget, not the count, stopped it.
function within(list, most, budget) {
  const out = []
  let cut = false
  for (const item of list.slice(0, most)) {
    const size = JSON.stringify(item).length""", """// The bytes a value takes in the answer: its JSON, as UTF-8.
const bytesOf = value => Buffer.byteLength(JSON.stringify(value))
// At most `most` of a list, while `budget.left` bytes last. `cut` says the
// budget, not the count, stopped it.
function within(list, most, budget) {
  const out = []
  let cut = false
  for (const item of list.slice(0, most)) {
    const size = bytesOf(item)""")

sub("""// At most LISTED_COLLECTIONS of a diff's collections, by rank (lowest
// first), then in name order: a PR's padding, empty or kept as counts,
// can't push a flagged or changed collection out.
function chosen(collections, rank) {
  return Object.keys(collections)
    .map(name => [rank(name, collections[name]), name])
    .sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0))
    .slice(0, LISTED_COLLECTIONS)
    .map(([, name]) => name)
}
const putOwn = (obj, name, value) => Object.defineProperty(obj, name, { enumerable: true, writable: true, configurable: true, value })
// What a collection's entry costs before its lists: its name, and its
// fields but the lists (its key among them), with room for the counts.
const ENTRY_EXTRA = 200
const entrySize = (name, rest) => JSON.stringify(name).length + JSON.stringify(rest).length + ENTRY_EXTRA
// A collection a diff changed, past its status: rows, fields or key.
const rowsChanged = c => c.inserted.length + c.updated.length + c.deleted.length + c.fieldsDropped.length + c.fieldsAdded.length > 0 || c.keyLost
// A diff as an answer lists it: each collection's entry, and its rows,
// changes and fields cut, with whole counts beside them, and `cut` on a
// collection the budget cut. Collections with a red flag come first, then
// changed rows, then an amber flag, then any other change. When the budget
// runs out, no more are listed, and the diff says `cut: true`.
// `flagged` maps a collection to the most severe of its flags.
const rankOf = (flagged, name, moved, changed) => (flagged.get(name) === 'red' ? 0 : moved ? 1 : flagged.has(name) ? 2 : changed ? 3 : 4)
function listed(diff, budget, flagged) {
  if (!diff) return diff
  const collections = {}
  let stopped = false
  const rank = (name, c) => rankOf(flagged, name, rowsChanged(c), c.status !== 'same')
  for (const name of chosen(diff.collections, rank)) {
    const c = diff.collections[name]
    const { inserted, updated, deleted, fieldsDropped, fieldsAdded, ...rest } = c
    const size = entrySize(name, rest)
    if (size > budget.left) { stopped = true; break }
    budget.left -= size
    let cut = false
    const part = list => {
      const got = within(list, LISTED, budget)
      cut ||= got.cut
      return got.out
    }
    const value = {
      ...rest,
      inserted: part(inserted), updated: part(updated), deleted: part(deleted),
      fieldsDropped: part(fieldsDropped), fieldsAdded: part(fieldsAdded),
      counts: { inserted: inserted.length, updated: updated.length, deleted: deleted.length, fieldsDropped: fieldsDropped.length, fieldsAdded: fieldsAdded.length },
    }
    if (cut) value.cut = true
    putOwn(collections, name, value)
  }
  return { collections, collectionsCount: Object.keys(diff.collections).length, ...(stopped ? { cut: true } : {}) }
}
function listedDivergence(div, budget, flagged) {
  if (!div) return div
  const collections = {}
  let stopped = false
  const moved = c => c.changes.length > 0 || [c.counts.base, c.counts.pr].some(n => n.inserted + n.updated + n.deleted > 0)
  const rank = (name, c) => rankOf(flagged, name, moved(c), c.status !== 'same')
  for (const name of chosen(div.collections, rank)) {
    const { changes, ...rest } = div.collections[name]
    const size = entrySize(name, rest)
    if (size > budget.left) { stopped = true; break }
    budget.left -= size
    const { out, cut } = within(changes, LISTED, budget)
    putOwn(collections, name, { ...rest, changes: out, changesCount: changes.length, ...(cut ? { cut: true } : {}) })
  }
  return { collections, collectionsCount: Object.keys(div.collections).length, ...(stopped ? { cut: true } : {}) }
}""", """const putOwn = (obj, name, value) => Object.defineProperty(obj, name, { enumerable: true, writable: true, configurable: true, value })
// What a collection's entry costs before its lists: its name, and its
// fields but the lists (its key among them), with room for the counts.
const ENTRY_EXTRA = 200
const entrySize = (name, rest) => bytesOf(name) + bytesOf(rest) + ENTRY_EXTRA
// A collection a diff changed, past its status: rows, fields or key.
const rowsChanged = c => c.inserted.length + c.updated.length + c.deleted.length + c.fieldsDropped.length + c.fieldsAdded.length > 0 || c.keyLost
const divergenceMoved = c => c.changes.length > 0 || [c.counts.base, c.counts.pr].some(n => n.inserted + n.updated + n.deleted > 0)

// A collection's rank in a list, lowest first: a red flag (then by where
// its first flag stands in the engine's order, so the base pane's
// collections, and what loses data, come first), changed rows, an amber
// flag, any other change, none; then by name. `order` maps a collection to
// the index of its first flag, and `red` to whether it has a red one.
function rankOf({ order, red }, name, moved, changed) {
  if (red.has(name)) return [0, order.get(name)]
  return [moved ? 1 : order.has(name) ? 2 : changed ? 3 : 4, 0]
}
const byRank = (x, y) => x.rank[0] - y.rank[0] || x.rank[1] - y.rank[1] || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)
// A list's candidates: at most LISTED_COLLECTIONS of its collections, by
// rank.
function candidates(collections, flagged, moved) {
  return Object.keys(collections)
    .map(name => ({ name, rank: rankOf(flagged, name, moved(collections[name]), collections[name].status !== 'same') }))
    .sort(byRank)
    .slice(0, LISTED_COLLECTIONS)
}

// A span's PR diff, divergence and base diff, as an answer lists them. Each
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
          if (size > budget.left) { stopped = true; break }
          budget.left -= size
          const { out, cut } = within(changes, LISTED, budget)
          putOwn(list.collections, name, { ...rest, changes: out, changesCount: changes.length, ...(cut ? { cut: true } : {}) })
        } else {
          const { inserted, updated, deleted, fieldsDropped, fieldsAdded, ...rest } = c
          const size = entrySize(name, rest)
          if (size > budget.left) { stopped = true; break }
          budget.left -= size
          let cut = false
          const part = items => {
            const got = within(items, LISTED, budget)
            cut ||= got.cut
            return got.out
          }
          const value = {
            ...rest,
            inserted: part(inserted), updated: part(updated), deleted: part(deleted),
            fieldsDropped: part(fieldsDropped), fieldsAdded: part(fieldsAdded),
            counts: { inserted: inserted.length, updated: updated.length, deleted: deleted.length, fieldsDropped: fieldsDropped.length, fieldsAdded: fieldsAdded.length },
          }
          if (cut) value.cut = true
          putOwn(list.collections, name, value)
        }
        list.done++
      }
    }
  }
  const out = { pr: pr ?? null, divergence: div ?? null, base: base ?? null }
  for (const list of lists) {
    out[list.which] = { collections: list.collections, collectionsCount: Object.keys(list.d.collections).length, ...(stopped && list.done < list.todo.length ? { cut: true } : {}) }
  }
  return out
}""")

sub("""// A span whose PR pane has no diff: its changes are unknown. `reason` says
// why: its read failed (`failed`), neither pane could be read (`neither`),
// or this snapshot became its baseline, so there is nothing yet to compare
// it with (`baseline`).""", """// A span whose PR pane has no diff: its changes are unknown. `reason` says
// why: this snapshot became its baseline, so there is nothing yet to
// compare it with (`baseline`); its read failed (`failed`); or neither
// pane's could be read (`neither`).""")

# the probe gets the cell limit too
sub("""      const raw = await bounded(s => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, timeoutMs: lim.timeoutMs }, signal: s }), lim.timeoutMs, signal)""",
    """      const raw = await bounded(s => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, maxCells: lim.maxCells, timeoutMs: lim.timeoutMs }, signal: s }), lim.timeoutMs, signal)""")

# a version for the boot span, which changes only when a pane settles or ready runs
sub("""  // a version for each change of what view() shows, and the answer cached
  let version = 0
  let cached = null // { id, json }""", """  // a version for each change of what view() shows, and the answer cached;
  // a version for the boot span, which changes only when a pane settles or
  // ready runs, and its spans cached by trust; the session span's diffs
  // and divergence, cached for each version (they don't depend on trust)
  let version = 0
  let cached = null // { id, json }
  let bootVersion = 0
  const bootSpans = new Map() // `${bootVersion} ${runs > 0} ${trusted}` -> span
  let sessionMemo = null // { version, base, pr, divergence }""")
sub("""  function settle(pane, snap, run, at) {
    baseline[pane] = snap
    baseRun[pane] = run
    baseAt[pane] = at""", """  function settle(pane, snap, run, at) {
    baseline[pane] = snap
    baseRun[pane] = run
    baseAt[pane] = at
    bootVersion++""")
sub("""    const run = ++runs
    readyRun = run
    const at = now()""", """    const run = ++runs
    readyRun = run
    bootVersion++
    const at = now()""")

# the view: cached parts, the lists by rank across lists, the reason
sub("""  function view({ isolation } = {}, { lists = true } = {}) {
    if (closed) return { available: true, active: true, closed: true }
    const trust = trustOf(isolation)
    const span = (base, pr, aligned, why) => {
      if (!base && !pr && why === null) return null
      // each span its own share of the budget
      const budget = { left: Math.floor(viewBytes / 2) }
      const flags = pr ? flagChanges(base ?? { collections: {} }, pr, rules, { trusted: trust === 'trusted' && aligned }) : [unreadable(base ? why ?? 'failed' : 'neither')]
      const red = flags.filter(f => f.severity === 'red').length
      const complete = Boolean(base && pr) && aligned
      if (!lists) {
        return { complete, aligned, unlisted: true, flags: [unlisted(), ...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)], flagsCount: { red: red + 1, amber: flags.length - red }, base: null, pr: null, divergence: null }
      }
      // the flags first, then the PR pane's diff and the divergence, then
      // the base pane's diff, while the span's budget lasts
      const flagged = new Map()
      for (const f of flags) if (f.collection !== null && flagged.get(f.collection) !== 'red') flagged.set(f.collection, f.severity)
      const listedFlagsOut = listedFlags(flags, budget)
      const prOut = listed(pr, budget, flagged)
      const divOut = base && pr ? listedDivergence(divergence(base, pr), budget, flagged) : null
      const baseOut = listed(base, budget, flagged)
      return { complete, aligned, flags: listedFlagsOut, flagsCount: { red, amber: flags.length - red }, base: baseOut, pr: prOut, divergence: divOut }
    }
    const sessionOf = pane => (baseline[pane] && latest[pane] ? diffSnapshots(baseline[pane], latest[pane]) : null)
    const newest = pane => latest[pane] ?? baseline[pane] ?? seeded[pane]
    const both = (pair, runOf) => !(pair.base && pair.pr) || runOf.base === runOf.pr
    const bootAligned = !(boot.base && boot.pr) || (bootRun.base === readyRun && bootRun.pr === readyRun)
    const session = { base: sessionOf('base'), pr: sessionOf('pr') }
    const problemsOf = pane => newest(pane)?.problems ?? []""", """  function view({ isolation } = {}, { lists = true } = {}) {
    if (closed) return { available: true, active: true, closed: true }
    const trust = trustOf(isolation)
    const span = (base, pr, aligned, why, div) => {
      if (!base && !pr && why === null) return null
      // each span its own share of the budget
      const budget = { left: Math.floor(viewBytes / 2) }
      const flags = pr ? flagChanges(base ?? { collections: {} }, pr, rules, { trusted: trust === 'trusted' && aligned }) : [unreadable(why === 'baseline' ? 'baseline' : base ? why ?? 'failed' : 'neither')]
      const red = flags.filter(f => f.severity === 'red').length
      const complete = Boolean(base && pr) && aligned
      if (!lists) {
        return { complete, aligned, unlisted: true, flags: [unlisted(), ...flags.filter(f => f.severity === 'red').slice(0, FALLBACK_FLAGS)], flagsCount: { red: red + 1, amber: flags.length - red }, base: null, pr: null, divergence: null }
      }
      // the flags first, then the lists by rank, while the span's budget
      // lasts. A collection's rank follows its first flag in the engine's
      // order.
      const order = new Map()
      const reds = new Set()
      flags.forEach((f, i) => {
        if (f.collection === null) return
        if (!order.has(f.collection)) order.set(f.collection, i)
        if (f.severity === 'red') reds.add(f.collection)
      })
      const listedFlagsOut = listedFlags(flags, budget)
      const out = listedLists({ pr, divergence: base && pr ? div() : null, base }, budget, { order, red: reds })
      return { complete, aligned, flags: listedFlagsOut, flagsCount: { red, amber: flags.length - red }, base: out.base, pr: out.pr, divergence: out.divergence }
    }
    // The session span's diffs and divergence: once for each state, whatever
    // the trust. The boot span: once for each settle, for each trust.
    if (sessionMemo?.version !== version) {
      const sessionOf = pane => (baseline[pane] && latest[pane] ? diff(baseline[pane], latest[pane]) : null)
      sessionMemo = { version, base: sessionOf('base'), pr: sessionOf('pr'), divergence: null }
    }
    const memo = sessionMemo
    const sessionDivergence = () => (memo.divergence ??= divergence(memo.base, memo.pr))
    const newest = pane => latest[pane] ?? baseline[pane] ?? seeded[pane]
    const both = (pair, runOf) => !(pair.base && pair.pr) || runOf.base === runOf.pr
    const bootAligned = !(boot.base && boot.pr) || (bootRun.base === readyRun && bootRun.pr === readyRun)
    const bootKey = `${bootVersion} ${runs > 0} ${trust}`
    const bootSpan = () => {
      if (!lists) return span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null, () => divergence(boot.base, boot.pr))
      if (!bootSpans.has(bootKey)) {
        if (bootSpans.size >= 4) bootSpans.clear()
        bootSpans.set(bootKey, span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null, () => divergence(boot.base, boot.pr)))
      }
      return bootSpans.get(bootKey)
    }
    const problemsOf = pane => newest(pane)?.problems ?? []""")
sub("""      boot: span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null),
      session: latestAt === null ? null : span(session.base, session.pr, both(session, baseRun), fresh.pr ? 'baseline' : 'failed'),""",
    """      boot: bootSpan(),
      session: latestAt === null ? null : span(memo.base, memo.pr, both(memo, baseRun), fresh.pr ? 'baseline' : 'failed', sessionDivergence),""")

# the diff function, for tests to count
sub("""export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {}, viewBytes = VIEW_BYTES }) {""",
    """// diff: diffSnapshots, for tests.
export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {}, viewBytes = VIEW_BYTES, diff = diffSnapshots }) {""")
sub("""      boot[pane] = diffSnapshots(seeded[pane], snap)""", """      boot[pane] = diff(seeded[pane], snap)""")
# closing drops the caches
sub("""    closed = true
    life.abort()
    cached = null""", """    closed = true
    life.abort()
    cached = null
    sessionMemo = null
    bootSpans.clear()""")
open(p, 'w').write(s)
print('ok')
