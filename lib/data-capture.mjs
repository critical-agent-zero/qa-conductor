// A session's data capture (#8): the probes the optional inspector seam
// (adapters.inspector) opens, one per pane, and the snapshots taken through
// them. The conductor makes one per boot (lib/server.mjs), bootSession
// calls `seeded` right after each pane's seed and `ready` once both panes
// are up (lib/session.mjs), and the harness asks for more through the API.
// In memory only, dropped with the session.
//
// - seeded (S0): a pane's data before any of the PR's code has run on it;
// - ready (S1): both panes' data once migrations ran and the reviewer is
//   signed in: the baseline. S0 → S1 is the boot span. A pane whose ready
//   read failed keeps its S0, and its first later snapshot is its baseline,
//   so the boot span is never lost;
// - now (Sn): "Snapshot now". The baseline → Sn is the session span. A
//   re-baseline makes now the baseline instead, after a manual sign-in, say:
//   both panes or neither.
//
// An inspector that throws, hangs past limits.timeoutMs or returns nonsense
// never fails the boot or the session: its pane says why it has no data,
// and a call that times out is signalled to stop. An aborted boot calls the
// inspector no more. A late probe is closed unused. Nothing here logs or
// broadcasts a value: onCapture gets the pane, the phase and whether it
// worked, for the boot's two phases only.

import { randomBytes } from 'node:crypto'

import { LIMITS, createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, trustOf } from './data-diff.mjs'

const PANES = ['base', 'pr']
// How long closing a probe may take: it holds up a teardown.
const CLOSE_MS = 5_000
// What one answer lists of a collection's rows and changes: at most this
// many of each, and at most VIEW_BYTES of rows in all. The counts are whole.
const LISTED = 50
const VIEW_BYTES = 4 * 1024 * 1024

const conflict = message => Object.assign(new Error(message), { status: 409 })
const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

function messageOf(err) {
  try {
    return String(err?.message ?? err)
  } catch {
    return 'an error that is not an Error'
  }
}

// fn(signal)'s result, or a rejection once `ms` pass or `parent` aborts.
// The signal fn gets aborts then too, so the call can stop.
function bounded(fn, ms, parent) {
  return new Promise((resolve, reject) => {
    if (parent?.aborted) return reject(aborted())
    const own = new AbortController()
    const signal = parent ? AbortSignal.any([parent, own.signal]) : own.signal
    let done = false
    const finish = (settle, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      parent?.removeEventListener('abort', onAbort)
      settle(value)
    }
    const onAbort = () => finish(reject, aborted())
    const timer = setTimeout(() => {
      const err = new Error(`timed out after ${ms} ms`)
      own.abort(err)
      finish(reject, err)
    }, ms)
    parent?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => fn(signal)).then(value => finish(resolve, value), err => finish(reject, err))
  })
}

// A diff as an answer lists it: its rows and changes cut to LISTED each,
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
}

// inspector: { open, rules? }; rules: validated (validateRules). key: the
// session's HMAC key, fresh by default.
export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {} }) {
  const lim = { ...LIMITS, ...limits }
  const masker = createMasker({ key, rules })
  const probes = { base: null, pr: null }
  // why a pane has no data: for the boot span (an open, seeded or ready
  // read that failed: never erased), and for the latest session read
  const errors = { boot: { base: null, pr: null }, session: { base: null, pr: null } }
  const seeded = { base: null, pr: null } // S0, until the pane has a baseline
  const baseline = { base: null, pr: null } // S1
  const latest = { base: null, pr: null } // Sn, from the latest run
  const boot = { base: null, pr: null } // S0 → S1 per pane
  let baselineAt = null
  let rebaselined = false
  let latestAt = null
  let closed = false
  let inFlight = null // { rebaseline, promise }
  const life = new AbortController() // aborted by close
  // a version for each change of what view() shows, and the answer cached
  let version = 0
  let cached = null // { id, json }

  const report = (pane, phase, ok) => {
    try { onCapture({ pane, phase, ok }) } catch { /* a listener's bug fails nothing */ }
  }

  // A pane's snapshot through its probe, sanitized, or null with why.
  async function take(pane, phase, signal) {
    const probe = probes[pane]
    try {
      const raw = await bounded(s => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, timeoutMs: lim.timeoutMs }, signal: s }), lim.timeoutMs, signal)
      return { snap: { at: now(), ...sanitizeSnapshot(raw, { masker, rules, limits: lim }) }, error: null }
    } catch (err) {
      return { snap: null, error: `the ${phase} snapshot failed: ${messageOf(err)}` }
    }
  }

  // A pane has a baseline: its boot span, from its S0, if it has one.
  function settle(pane, snap) {
    baseline[pane] = snap
    if (seeded[pane]) boot[pane] = diffSnapshots(seeded[pane], snap)
    seeded[pane] = null
  }

  // Right after a pane's seed: open its probe, with the db the Provisioner
  // gave, and take S0.
  async function seededPane({ paneRef, db, databases, signal }) {
    const pane = paneRef.role
    if (closed || signal?.aborted || !PANES.includes(pane)) return
    let opening
    let probe
    try {
      probe = await bounded(s => { opening = Promise.resolve().then(() => inspector.open({ paneRef, db, databases, signal: s })); return opening }, lim.timeoutMs, signal)
    } catch (err) {
      // a probe that comes after all is closed, unused
      opening?.then(late => closeProbe(late), () => {})
      errors.boot[pane] = `the inspector's open failed: ${messageOf(err)}`
      version++
      return report(pane, 'seeded', false)
    }
    if (!probe || typeof probe.snapshot !== 'function') {
      errors.boot[pane] = "the inspector's open gave no probe (an object with snapshot())"
      version++
      return report(pane, 'seeded', false)
    }
    if (closed) return closeProbe(probe)
    probes[pane] = probe
    if (signal?.aborted) return
    const { snap, error } = await take(pane, 'seeded', signal)
    seeded[pane] = snap
    errors.boot[pane] = error
    version++
    report(pane, 'seeded', snap !== null)
  }

  // Both panes are up: take S1, and the boot span where S0 and S1 exist.
  async function ready({ signal }) {
    if (closed || signal?.aborted) return
    const panes = PANES.filter(pane => probes[pane] !== null)
    const runs = await Promise.all(panes.map(pane => take(pane, 'ready', signal)))
    if (closed || signal?.aborted) return
    panes.forEach((pane, i) => {
      const { snap, error } = runs[i]
      if (snap) settle(pane, snap)
      else errors.boot[pane] = `${error}; its baseline will be its first later snapshot`
      report(pane, 'ready', snap !== null)
    })
    baselineAt = now()
    version++
  }

  // Snapshot now, or re-baseline. Concurrent calls of one kind share a run;
  // one of the other kind meanwhile is refused (409), as is one after the
  // session ended, and one in flight when it ends.
  // - now: each pane's snapshot is its latest, or none when its read
  //   failed; a pane with no baseline yet takes it as its baseline;
  // - re-baseline: both panes' snapshots become the baseline, or, when
  //   either read fails, neither does.
  function snapshot({ rebaseline = false } = {}) {
    if (closed) return Promise.reject(conflict('the session ended'))
    if (inFlight) return inFlight.rebaseline === rebaseline ? inFlight.promise : Promise.reject(conflict('a snapshot is already being taken'))
    const panes = PANES.filter(pane => probes[pane] !== null)
    if (panes.length === 0) return Promise.reject(conflict('neither pane has a probe: the inspector failed to open'))
    const phase = rebaseline ? 'baseline' : 'now'
    const promise = (async () => {
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
      version++
    })().finally(() => { inFlight = null })
    inFlight = { rebaseline, promise }
    return promise
  }

  // What the Data view shows: the boot and session spans, each pane's diff
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
  }

  async function closeProbe(probe) {
    if (!probe || typeof probe.close !== 'function') return
    try { await bounded(() => probe.close(), CLOSE_MS) } catch { /* it had its chance */ }
  }

  // Ends the capture: an in-flight snapshot is dropped, each probe closed
  // once, and every snapshot let go. A probe's close frees the conductor's
  // side only, and never touches the store.
  async function close() {
    if (closed) return
    closed = true
    life.abort()
    cached = null
    const open = PANES.map(pane => probes[pane])
    for (const pane of PANES) {
      probes[pane] = null
      seeded[pane] = baseline[pane] = latest[pane] = boot[pane] = null
    }
    await Promise.all(open.map(closeProbe))
  }

  return { seeded: seededPane, ready, snapshot, view, viewJson, close }
}
