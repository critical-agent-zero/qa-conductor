p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-capture.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""// What one answer lists of a collection's rows and changes: at most this
// many of each, and at most VIEW_BYTES of rows in all. The counts are whole.
const LISTED = 50
const VIEW_BYTES = 4 * 1024 * 1024""", """// What one answer lists: of a collection's rows, changes and fields, at most
// LISTED of each; at most LISTED_COLLECTIONS collections a diff, changed
// ones first; at most LISTED_FLAGS flags a span, red first; and at most
// VIEW_BYTES of all those lists, half for each span. The counts are whole.
const LISTED = 50
const LISTED_COLLECTIONS = 1_000
const LISTED_FLAGS = 500
const VIEW_BYTES = 4 * 1024 * 1024
// A span whose PR pane couldn't be read: its changes are unknown.
const unreadable = () => ({ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0 })""")

sub("""// A diff as an answer lists it: its rows and changes cut to LISTED each,
// while `budget.left` bytes last, with whole counts beside them.
function listed(diff, budget) {
  if (!diff) return diff
  const collections = {}
  for (const name of Object.keys(diff.collections)) {
    const c = diff.collections[name]
    const cut = list => {
      const out = []
      for (const item of list.slice(0, LISTED)) {
        const size = JSON.stringify(item).length
        if (size > budget.left) break
        budget.left -= size
        out.push(item)
      }
      return out
    }
    Object.defineProperty(collections, name, {
      enumerable: true, writable: true, configurable: true,
      value: {
        ...c,
        inserted: cut(c.inserted), updated: cut(c.updated), deleted: cut(c.deleted),
        counts: { inserted: c.inserted.length, updated: c.updated.length, deleted: c.deleted.length },
      },
    })
  }
  return { collections }
}
function listedDivergence(div, budget) {
  if (!div) return div
  const collections = {}
  for (const name of Object.keys(div.collections)) {
    const c = div.collections[name]
    const changes = []
    for (const change of c.changes.slice(0, LISTED)) {
      const size = JSON.stringify(change).length
      if (size > budget.left) break
      budget.left -= size
      changes.push(change)
    }
    Object.defineProperty(collections, name, { enumerable: true, writable: true, configurable: true, value: { ...c, changes, changesCount: c.changes.length } })
  }
  return { collections }
}""", """// At most `most` of a list, while `budget.left` bytes last. `cut` says the
// budget, not the count, stopped it.
function within(list, most, budget) {
  const out = []
  let cut = false
  for (const item of list.slice(0, most)) {
    const size = JSON.stringify(item).length
    if (size > budget.left) { cut = true; break }
    budget.left -= size
    out.push(item)
  }
  return { out, cut }
}
// At most LISTED_COLLECTIONS of a diff's collections, those that changed
// first, then in name order.
function chosen(collections, changed) {
  const names = Object.keys(collections)
  if (names.length <= LISTED_COLLECTIONS) return names
  const keep = new Set([...names.filter(name => changed(collections[name])), ...names].slice(0, LISTED_COLLECTIONS))
  return names.filter(name => keep.has(name))
}
const putOwn = (obj, name, value) => Object.defineProperty(obj, name, { enumerable: true, writable: true, configurable: true, value })
// A diff as an answer lists it: its rows, changes and fields cut, with whole
// counts beside them, and `cut` on a collection the budget cut.
function listed(diff, budget) {
  if (!diff) return diff
  const collections = {}
  for (const name of chosen(diff.collections, c => c.status !== 'same')) {
    const c = diff.collections[name]
    let cut = false
    const part = list => {
      const got = within(list, LISTED, budget)
      cut ||= got.cut
      return got.out
    }
    const value = {
      ...c,
      inserted: part(c.inserted), updated: part(c.updated), deleted: part(c.deleted),
      fieldsDropped: part(c.fieldsDropped), fieldsAdded: part(c.fieldsAdded),
      counts: { inserted: c.inserted.length, updated: c.updated.length, deleted: c.deleted.length, fieldsDropped: c.fieldsDropped.length, fieldsAdded: c.fieldsAdded.length },
    }
    if (cut) value.cut = true
    putOwn(collections, name, value)
  }
  return { collections, collectionsCount: Object.keys(diff.collections).length }
}
function listedDivergence(div, budget) {
  if (!div) return div
  const collections = {}
  for (const name of chosen(div.collections, c => c.status !== 'same')) {
    const c = div.collections[name]
    const { out, cut } = within(c.changes, LISTED, budget)
    putOwn(collections, name, { ...c, changes: out, changesCount: c.changes.length, ...(cut ? { cut: true } : {}) })
  }
  return { collections, collectionsCount: Object.keys(div.collections).length }
}
// A span's flags as an answer lists them: red first, at most LISTED_FLAGS,
// within the budget.
function listedFlags(flags, budget) {
  const red = flags.filter(f => f.severity === 'red')
  return within([...red, ...flags.filter(f => f.severity !== 'red')], LISTED_FLAGS, budget).out
}""")

sub("""export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {} }) {""",
    """export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {}, viewBytes = VIEW_BYTES }) {""")
sub("""  const boot = { base: null, pr: null } // S0 → S1 per pane
  let baselineAt = null""", """  const boot = { base: null, pr: null } // S0 → S1 per pane
  // Each run (ready, Snapshot now, Re-baseline) is numbered. A pane's
  // baseline and boot span name the run they came from, and when, so a span
  // knows whether both panes' windows match.
  let runs = 0
  const baseRun = { base: null, pr: null }
  const bootRun = { base: null, pr: null }
  const baseAt = { base: null, pr: null }
  let baselineAt = null""")

sub("""  // A pane has a baseline: its boot span, from its S0, if it has one.
  function settle(pane, snap) {
    baseline[pane] = snap
    if (seeded[pane]) boot[pane] = diffSnapshots(seeded[pane], snap)
    seeded[pane] = null
  }""", """  // A pane has a baseline, from run `run` at `at`: its boot span, from its
  // S0, if it has one, and only the first time.
  function settle(pane, snap, run, at) {
    baseline[pane] = snap
    baseRun[pane] = run
    baseAt[pane] = at
    if (seeded[pane]) {
      boot[pane] = diffSnapshots(seeded[pane], snap)
      bootRun[pane] = run
    }
    seeded[pane] = null
  }""")

sub("""    const runs = await Promise.all(panes.map(pane => take(pane, 'ready', signal)))
    if (closed || signal?.aborted) return
    panes.forEach((pane, i) => {
      const { snap, error } = runs[i]
      if (snap) settle(pane, snap)
      else errors.boot[pane] = `${error}; its baseline will be its first later snapshot`
      report(pane, 'ready', snap !== null)
    })
    baselineAt = now()
    version++
  }""", """    const reads = await Promise.all(panes.map(pane => take(pane, 'ready', signal)))
    if (closed || signal?.aborted) return
    const run = ++runs
    const at = now()
    panes.forEach((pane, i) => {
      const { snap, error } = reads[i]
      if (snap) settle(pane, snap, run, at)
      else {
        // kept beside any earlier reason, and a boot span promised only
        // when there is an S0 to make one from
        const why = seeded[pane] ? `${error}; its baseline will be its first later snapshot` : `${error}; it has no seeded snapshot, so no boot span`
        errors.boot[pane] = errors.boot[pane] ? `${errors.boot[pane]}; ${why}` : why
      }
      report(pane, 'ready', snap !== null)
    })
    baselineAt = at
    version++
  }""")

sub("""    const promise = (async () => {
      const runs = await Promise.all(panes.map(pane => take(pane, phase, life.signal)))
      if (closed) throw conflict('the session ended while the snapshot was taken')
      panes.forEach((pane, i) => { errors.session[pane] = runs[i].error })
      if (rebaseline) {
        if (runs.every(r => r.snap)) {
          panes.forEach((pane, i) => settle(pane, runs[i].snap))
          baselineAt = now()
          rebaselined = true
          latest.base = null
          latest.pr = null
          latestAt = null
        }
      } else {
        panes.forEach((pane, i) => {
          const { snap } = runs[i]
          if (snap && !baseline[pane]) { settle(pane, snap); latest[pane] = null } else latest[pane] = snap
        })
        latestAt = now()
      }
      version++""", """    const promise = (async () => {
      const reads = await Promise.all(panes.map(pane => take(pane, phase, life.signal)))
      if (closed) throw conflict('the session ended while the snapshot was taken')
      const run = ++runs
      const at = now()
      panes.forEach((pane, i) => { errors.session[pane] = reads[i].error })
      if (rebaseline) {
        if (reads.every(r => r.snap)) {
          panes.forEach((pane, i) => settle(pane, reads[i].snap, run, at))
          baselineAt = at
          rebaselined = true
          latest.base = null
          latest.pr = null
          latestAt = null
        }
      } else {
        // A pane with no baseline yet (its ready read failed) takes this one:
        // its windows then differ from the other pane's, which its spans say
        // until a re-baseline.
        panes.forEach((pane, i) => {
          const { snap } = reads[i]
          if (snap && !baseline[pane]) { settle(pane, snap, run, at); latest[pane] = null } else latest[pane] = snap
        })
        latestAt = at
      }
      version++""")

sub("""  // What the Data view shows: the boot and session spans, each pane's diff
  // (its rows and changes listed in part, its counts whole), their
  // divergence and the PR's flags, trusted or advisory by the session's
  // isolation verdict. A span with a pane missing says it is incomplete.
  function view({ isolation } = {}) {
    if (closed) return { available: true, active: true, closed: true }
    const trust = trustOf(isolation)
    const budget = { left: VIEW_BYTES }
    const span = (base, pr) => {
      if (!base && !pr) return null
      return {
        complete: Boolean(base && pr),
        base: listed(base, budget),
        pr: listed(pr, budget),
        divergence: base && pr ? listedDivergence(divergence(base, pr), budget) : null,
        flags: pr ? flagChanges(base ?? { collections: {} }, pr, rules, { trusted: trust === 'trusted' }) : [],
      }
    }
    const sessionOf = pane => (baseline[pane] && latest[pane] ? diffSnapshots(baseline[pane], latest[pane]) : null)
    const newest = pane => latest[pane] ?? baseline[pane] ?? seeded[pane]
    return {
      available: true,
      active: true,
      trust,
      baselineAt,
      rebaselined,
      comparedAt: latestAt,
      errors: { boot: { ...errors.boot }, session: { ...errors.session } },
      problems: { base: newest('base')?.problems ?? [], pr: newest('pr')?.problems ?? [] },
      boot: span(boot.base, boot.pr),
      session: latestAt === null ? null : span(sessionOf('base'), sessionOf('pr')),
    }
  }

  // view() as JSON, built once for each state and trust.
  function viewJson({ isolation } = {}) {
    const id = `${version} ${closed} ${trustOf(isolation)}`
    if (cached?.id !== id) cached = { id, json: JSON.stringify(view({ isolation })) }
    return cached.json
  }""", """  // What the Data view shows: the boot and session spans, each pane's diff
  // (its rows, changes and fields listed in part, its counts whole), their
  // divergence and the PR's flags, trusted or advisory by the session's
  // isolation verdict.
  // - A span is complete when both panes are in it over the same window.
  // - Its windows differ (`aligned: false`) when one pane's baseline came
  //   from a later run (its ready read failed): then nothing in the base
  //   pane can excuse a PR change.
  // - A span whose PR pane couldn't be read has one red `unreadable` flag.
  function view({ isolation } = {}) {
    if (closed) return { available: true, active: true, closed: true }
    const trust = trustOf(isolation)
    const span = (base, pr, aligned) => {
      if (!base && !pr) return null
      // each span its own share of the budget
      const budget = { left: Math.floor(viewBytes / 2) }
      const flags = pr ? flagChanges(base ?? { collections: {} }, pr, rules, { trusted: trust === 'trusted' && aligned }) : [unreadable()]
      const red = flags.filter(f => f.severity === 'red').length
      return {
        complete: Boolean(base && pr) && aligned,
        aligned,
        flags: listedFlags(flags, budget),
        flagsCount: { red, amber: flags.length - red },
        base: listed(base, budget),
        pr: listed(pr, budget),
        divergence: base && pr ? listedDivergence(divergence(base, pr), budget) : null,
      }
    }
    const sessionOf = pane => (baseline[pane] && latest[pane] ? diffSnapshots(baseline[pane], latest[pane]) : null)
    const newest = pane => latest[pane] ?? baseline[pane] ?? seeded[pane]
    const both = (pair, runOf) => !(pair.base && pair.pr) || runOf.base === runOf.pr
    const session = { base: sessionOf('base'), pr: sessionOf('pr') }
    return {
      available: true,
      active: true,
      trust,
      baselineAt,
      baselines: { ...baseAt },
      rebaselined,
      comparedAt: latestAt,
      errors: { boot: { ...errors.boot }, session: { ...errors.session } },
      problems: { base: newest('base')?.problems ?? [], pr: newest('pr')?.problems ?? [] },
      boot: span(boot.base, boot.pr, both(boot, bootRun)),
      session: latestAt === null ? null : span(session.base, session.pr, both(session, baseRun)),
    }
  }

  // view() as JSON, built once for each state and trust; one that fails to
  // build fails again at once, until the state changes.
  function viewJson({ isolation } = {}) {
    const id = `${version} ${closed} ${trustOf(isolation)}`
    if (cached?.id !== id) {
      try {
        cached = { id, json: JSON.stringify(view({ isolation })) }
      } catch (error) {
        cached = { id, error }
      }
    }
    if (cached.error) throw cached.error
    return cached.json
  }""")
open(p, 'w').write(s)
print('ok')
