p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-capture.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""// What one answer lists: of a collection's rows, changes and fields, at most
// LISTED of each; at most LISTED_COLLECTIONS collections a diff, changed
// ones first; at most LISTED_FLAGS flags a span, red first; and at most
// VIEW_BYTES of all those lists, half for each span. The counts are whole.
const LISTED = 50
const LISTED_COLLECTIONS = 1_000
const LISTED_FLAGS = 500
const VIEW_BYTES = 4 * 1024 * 1024
// A span whose PR pane couldn't be read: its changes are unknown.
const unreadable = () => ({ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0 })
""", """// What one answer lists: of a collection's rows, changes and fields, at most
// LISTED of each; at most LISTED_COLLECTIONS collections a diff, flagged and
// changed ones first; at most LISTED_FLAGS flags a span, red first, with
// `unverified` ones past LISTED_UNVERIFIED folded into one; at most
// LISTED_PROBLEMS problems a pane; and at most VIEW_BYTES of all those lists
// and the collections' own entries (name, key, counts), half for each span.
// The counts are whole. An error's text is cut at ERROR_TEXT.
const LISTED = 50
const LISTED_COLLECTIONS = 1_000
const LISTED_FLAGS = 500
const LISTED_UNVERIFIED = 20
const LISTED_PROBLEMS = 50
const VIEW_BYTES = 4 * 1024 * 1024
const ERROR_TEXT = 500
// When the answer can't be built with its lists: the first red flags only.
const FALLBACK_FLAGS = 20
// A span whose PR pane has no diff: its changes are unknown. `reason` says
// why: its read failed (`failed`), neither pane could be read (`neither`),
// or this snapshot became its baseline, so there is nothing yet to compare
// it with (`baseline`).
const unreadable = reason => ({ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0, reason })
// An answer built without its lists: its details couldn't be listed.
const unlisted = () => ({ collection: null, kind: 'unlisted', severity: 'red', shared: false, pr: 1, base: 0 })
""")

sub("""function messageOf(err) {
  try {
    return String(err?.message ?? err)
  } catch {
    return 'an error that is not an Error'
  }
}""", """function messageOf(err) {
  let text
  try {
    text = String(err?.message ?? err)
  } catch {
    return 'an error that is not an Error'
  }
  return text.length > ERROR_TEXT ? `${text.slice(0, ERROR_TEXT)}…` : text
}""")

sub("""// At most LISTED_COLLECTIONS of a diff's collections, those that changed
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
}""", """// At most LISTED_COLLECTIONS of a diff's collections, by rank (lowest
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
// collection the budget cut. Flagged collections come first, then changed
// rows, then any other change. When the budget runs out, no more are
// listed, and the diff says `cut: true`.
function listed(diff, budget, flagged) {
  if (!diff) return diff
  const collections = {}
  let stopped = false
  const rank = (name, c) => (flagged.has(name) ? 0 : rowsChanged(c) ? 1 : c.status !== 'same' ? 2 : 3)
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
  const rank = (name, c) => (flagged.has(name) ? 0 : moved(c) ? 1 : c.status !== 'same' ? 2 : 3)
  for (const name of chosen(div.collections, rank)) {
    const { changes, ...rest } = div.collections[name]
    const size = entrySize(name, rest)
    if (size > budget.left) { stopped = true; break }
    budget.left -= size
    const { out, cut } = within(changes, LISTED, budget)
    putOwn(collections, name, { ...rest, changes: out, changesCount: changes.length, ...(cut ? { cut: true } : {}) })
  }
  return { collections, collectionsCount: Object.keys(div.collections).length, ...(stopped ? { cut: true } : {}) }
}
// A span's flags as an answer lists them, in the engine's order (the base
// pane's collections first, destructive kinds before `unverified`), red
// first. Past LISTED_UNVERIFIED red `unverified` flags of named collections,
// the rest are one flag in their place (`folded`, with how many and the
// first five names). At most LISTED_FLAGS in all, within the budget.
function listedFlags(flags, budget) {
  const out = []
  const rest = []
  let named = 0
  let foldAt = -1
  for (const f of flags) {
    if (f.severity !== 'red') continue
    if (f.kind === 'unverified' && f.collection !== null && ++named > LISTED_UNVERIFIED) {
      if (foldAt === -1) foldAt = out.length
      rest.push(f.collection)
      continue
    }
    out.push(f)
  }
  if (rest.length) out.splice(foldAt, 0, { collection: null, kind: 'unverified', severity: 'red', shared: false, pr: rest.length, base: 0, collections: rest.length, names: rest.slice(0, 5), folded: true })
  return within([...out, ...flags.filter(f => f.severity !== 'red')], LISTED_FLAGS, budget).out
}
// At most LISTED_PROBLEMS of a pane's problems.
const listedProblems = problems => problems.slice(0, LISTED_PROBLEMS)""")

# runs: the ready run, baselineAt only when a pane settled at ready, a fresh late baseline
sub("""  let runs = 0
  const baseRun = { base: null, pr: null }
  const bootRun = { base: null, pr: null }
  const baseAt = { base: null, pr: null }
  let baselineAt = null""", """  let runs = 0
  let readyRun = null
  const baseRun = { base: null, pr: null }
  const bootRun = { base: null, pr: null }
  const baseAt = { base: null, pr: null }
  // a pane whose baseline came from the latest Snapshot now, late: it has
  // no session span yet
  const fresh = { base: false, pr: false }
  let baselineAt = null""")

sub("""  function settle(pane, snap, run, at) {
    baseline[pane] = snap
    baseRun[pane] = run
    baseAt[pane] = at
    if (seeded[pane]) {
      boot[pane] = diffSnapshots(seeded[pane], snap)
      bootRun[pane] = run
    }
    seeded[pane] = null
  }""", """  function settle(pane, snap, run, at) {
    baseline[pane] = snap
    baseRun[pane] = run
    baseAt[pane] = at
    if (seeded[pane]) {
      boot[pane] = diffSnapshots(seeded[pane], snap)
      bootRun[pane] = run
    }
    seeded[pane] = null
    // a promised late baseline has come: say when
    if (errors.boot[pane]?.endsWith(LATE)) errors.boot[pane] = `${errors.boot[pane].slice(0, -LATE.length)}its baseline is the snapshot at ${new Date(at).toISOString()}`
  }""")

sub("""    const run = ++runs
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
  }""", """    const run = ++runs
    readyRun = run
    const at = now()
    panes.forEach((pane, i) => {
      const { snap, error } = reads[i]
      if (snap) settle(pane, snap, run, at)
      else {
        // kept beside any earlier reason, and a boot span promised only
        // when there is an S0 to make one from
        const why = seeded[pane] ? `${error}; ${LATE}` : `${error}; it has no seeded snapshot, so no boot span`
        errors.boot[pane] = errors.boot[pane] ? `${errors.boot[pane]}; ${why}` : why
      }
      report(pane, 'ready', snap !== null)
    })
    // the baseline's time, only when a pane has its baseline from ready
    if (reads.some(r => r.snap)) baselineAt = at
    version++
  }""")

sub("""        panes.forEach((pane, i) => {
          const { snap } = reads[i]
          if (snap && !baseline[pane]) { settle(pane, snap, run, at); latest[pane] = null } else latest[pane] = snap
        })
        latestAt = at""", """        panes.forEach((pane, i) => {
          const { snap } = reads[i]
          fresh[pane] = Boolean(snap && !baseline[pane])
          if (fresh[pane]) { settle(pane, snap, run, at); latest[pane] = null } else latest[pane] = snap
        })
        latestAt = at""")
sub("""        if (reads.every(r => r.snap)) {
          panes.forEach((pane, i) => settle(pane, reads[i].snap, run, at))""", """        if (reads.every(r => r.snap)) {
          panes.forEach((pane, i) => { settle(pane, reads[i].snap, run, at); fresh[pane] = false })""")

sub("""  // What the Data view shows: the boot and session spans, each pane's diff
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
  }""", """  // What the Data view shows: the boot and session spans, each pane's diff
  // (its rows, changes and fields listed in part, its counts whole), their
  // divergence and the PR's flags, trusted or advisory by the session's
  // isolation verdict.
  // - A span is complete when both panes are in it over the same window.
  // - Its windows differ (`aligned: false`) when one pane's baseline came
  //   from a later run (its ready read failed): then nothing in the base
  //   pane can excuse a PR change. A boot span is aligned only when both
  //   panes' baselines came from the ready run itself.
  // - A span whose PR pane has no diff has one red `unreadable` flag, and
  //   so does one with neither pane's, once a run has happened: its changes
  //   are unknown, never none.
  // - Without `lists` (an answer too big to build), a span keeps its counts
  //   and first red flags, after a red `unlisted` one, and lists nothing.
  function view({ isolation } = {}, { lists = true } = {}) {
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
      const flagged = new Set(flags.map(f => f.collection).filter(name => name !== null))
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
    const problemsOf = pane => newest(pane)?.problems ?? []
    return {
      available: true,
      active: true,
      trust,
      baselineAt,
      baselines: { ...baseAt },
      rebaselined,
      comparedAt: latestAt,
      errors: { boot: { ...errors.boot }, session: { ...errors.session } },
      problems: { base: listedProblems(problemsOf('base')), pr: listedProblems(problemsOf('pr')) },
      problemsCount: { base: problemsOf('base').length, pr: problemsOf('pr').length },
      boot: span(boot.base, boot.pr, bootAligned, runs > 0 ? 'failed' : null),
      session: latestAt === null ? null : span(session.base, session.pr, both(session, baseRun), fresh.pr ? 'baseline' : 'failed'),
    }
  }

  // view() as JSON, built once for each state and trust; one too big to
  // build is built again without its lists (a red `unlisted` flag says
  // so), and one that still fails fails again at once, until the state
  // changes.
  function viewJson({ isolation } = {}) {
    const id = `${version} ${closed} ${trustOf(isolation)}`
    if (cached?.id !== id) {
      try {
        cached = { id, json: JSON.stringify(view({ isolation })) }
      } catch {
        try {
          cached = { id, json: JSON.stringify(view({ isolation }, { lists: false })) }
        } catch (error) {
          cached = { id, error }
        }
      }
    }
    if (cached.error) throw cached.error
    return cached.json
  }""")

sub("""const conflict = message => Object.assign(new Error(message), { status: 409 })""", """const conflict = message => Object.assign(new Error(message), { status: 409 })
// What errors.boot promises a pane whose ready read failed, until its
// baseline comes.
const LATE = 'its baseline will be its first later snapshot'""")
open(p, 'w').write(s)
print('ok')
