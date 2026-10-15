// A session's data capture (#8): the probes the optional inspector seam
// (adapters.inspector) opens, one per pane, and the snapshots taken through
// them. The conductor makes one per boot (lib/server.mjs), bootSession
// calls `seeded` right after each pane's seed and `ready` once both panes
// are up (lib/session.mjs), and the harness asks for more through the API.
// In memory only, dropped with the session.
//
// - seeded (S0): a pane's data before any of the PR's code has run on it;
// - ready (S1): both panes' data once migrations ran and the reviewer is
//   signed in. S0 → S1 is the boot delta, and S0 goes once it is known;
// - now (Sn): "Snapshot now". S1 → Sn is the session delta. A re-baseline
//   makes now the baseline instead, after a manual sign-in, say.
//
// An inspector that throws, hangs past limits.timeoutMs or returns nonsense
// never fails the boot or the session: its pane says why it has no data.
// An aborted boot calls the inspector no more. A late probe is closed
// unused. Nothing here logs or broadcasts a value: onCapture gets the pane,
// the phase and whether it worked.

import { randomBytes } from 'node:crypto'

import { LIMITS, createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, trustOf } from './data-diff.mjs'

const PANES = ['base', 'pr']
// How long closing a probe may take: it holds up a teardown.
const CLOSE_MS = 5_000

const conflict = message => Object.assign(new Error(message), { status: 409 })
const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

function messageOf(err) {
  try {
    return String(err?.message ?? err)
  } catch {
    return 'an error that is not an Error'
  }
}

// fn's result, or a rejection once `ms` pass or `signal` aborts.
function bounded(fn, ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted())
    let done = false
    const finish = (settle, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      settle(value)
    }
    const onAbort = () => finish(reject, aborted())
    const timer = setTimeout(() => finish(reject, new Error(`timed out after ${ms} ms`)), ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(fn).then(value => finish(resolve, value), err => finish(reject, err))
  })
}

// inspector: { open, rules? }; rules: validated (validateRules). key: the
// session's HMAC key, fresh by default.
export function createDataCapture({ inspector, rules, limits = {}, key = randomBytes(32), now = Date.now, onCapture = () => {} }) {
  const lim = { ...LIMITS, ...limits }
  const masker = createMasker({ key, rules })
  const probes = { base: null, pr: null }
  const errors = { base: null, pr: null }
  const seeded = { base: null, pr: null } // S0, until ready
  const baseline = { base: null, pr: null } // S1
  const latest = { base: null, pr: null } // Sn
  let boot = null // { base, pr }: S0 → S1 per pane, once ready
  let baselineAt = null
  let rebaselined = false
  let latestAt = null
  let closed = false
  let inFlight = null // { rebaseline, promise }
  const life = new AbortController() // aborted by close

  const report = (pane, phase, ok) => {
    try { onCapture({ pane, phase, ok }) } catch { /* a listener's bug fails nothing */ }
  }

  // A pane's snapshot through its probe, sanitized, or null with the reason
  // in errors[pane].
  async function take(pane, phase, signal) {
    const probe = probes[pane]
    try {
      const raw = await bounded(() => probe.snapshot({ limits: { maxRows: lim.maxRows, maxBytes: lim.maxBytes, timeoutMs: lim.timeoutMs }, signal }), lim.timeoutMs, signal)
      const snap = { at: now(), ...sanitizeSnapshot(raw, { masker, rules, limits: lim }) }
      errors[pane] = null
      report(pane, phase, true)
      return snap
    } catch (err) {
      errors[pane] = `the ${phase} snapshot failed: ${messageOf(err)}`
      report(pane, phase, false)
      return null
    }
  }

  // Right after a pane's seed: open its probe, with the db the Provisioner
  // gave, and take S0.
  async function seededPane({ paneRef, db, databases, signal }) {
    const pane = paneRef.role
    if (closed || signal?.aborted || !PANES.includes(pane)) return
    const opening = Promise.resolve().then(() => inspector.open({ paneRef, db, databases, signal }))
    let probe
    try {
      probe = await bounded(() => opening, lim.timeoutMs, signal)
    } catch (err) {
      // a probe that comes after all is closed, unused
      opening.then(late => closeProbe(late), () => {})
      errors[pane] = `the inspector's open failed: ${messageOf(err)}`
      return report(pane, 'seeded', false)
    }
    if (!probe || typeof probe.snapshot !== 'function') {
      errors[pane] = "the inspector's open gave no probe (an object with snapshot())"
      return report(pane, 'seeded', false)
    }
    if (closed) return closeProbe(probe)
    probes[pane] = probe
    if (signal?.aborted) return
    seeded[pane] = await take(pane, 'seeded', signal)
  }

  // Both panes are up: take S1, and the boot delta where S0 and S1 exist.
  async function ready({ signal }) {
    if (closed || signal?.aborted) return
    const panes = PANES.filter(pane => probes[pane] !== null)
    const snaps = await Promise.all(panes.map(pane => take(pane, 'ready', signal)))
    if (closed || signal?.aborted) return
    panes.forEach((pane, i) => { baseline[pane] = snaps[i] })
    baselineAt = now()
    boot = {}
    for (const pane of PANES) boot[pane] = seeded[pane] && baseline[pane] ? diffSnapshots(seeded[pane], baseline[pane]) : null
    seeded.base = null
    seeded.pr = null
  }

  // Snapshot now, or re-baseline. Concurrent calls of one kind share a run;
  // one of the other kind meanwhile is refused (409), as is one after the
  // session ended, and one in flight when it ends.
  function snapshot({ rebaseline = false } = {}) {
    if (closed) return Promise.reject(conflict('the session ended'))
    if (inFlight) return inFlight.rebaseline === rebaseline ? inFlight.promise : Promise.reject(conflict('a snapshot is already being taken'))
    const panes = PANES.filter(pane => probes[pane] !== null)
    if (panes.length === 0) return Promise.reject(conflict('neither pane has a probe: the inspector failed to open'))
    const phase = rebaseline ? 'baseline' : 'now'
    const promise = (async () => {
      const snaps = await Promise.all(panes.map(pane => take(pane, phase, life.signal)))
      if (closed) throw conflict('the session ended while the snapshot was taken')
      if (rebaseline) {
        panes.forEach((pane, i) => { if (snaps[i]) baseline[pane] = snaps[i] })
        baselineAt = now()
        rebaselined = true
        latest.base = null
        latest.pr = null
        latestAt = null
      } else {
        panes.forEach((pane, i) => { if (snaps[i]) latest[pane] = snaps[i] })
        latestAt = now()
      }
    })().finally(() => { inFlight = null })
    inFlight = { rebaseline, promise }
    return promise
  }

  // What the Data view shows: the boot and session spans, each pane's diff,
  // their divergence and the PR's flags, trusted or advisory by the
  // session's isolation verdict.
  function view({ isolation } = {}) {
    if (closed) return { available: true, closed: true }
    const trust = trustOf(isolation)
    const span = (base, pr) => {
      if (!base && !pr) return null
      return {
        base,
        pr,
        divergence: base && pr ? divergence(base, pr) : null,
        flags: pr ? flagChanges(base ?? { collections: {} }, pr, rules, { trusted: trust === 'trusted' }) : [],
      }
    }
    const session = latestAt === null ? null : Object.fromEntries(PANES.map(pane => [pane, baseline[pane] && latest[pane] ? diffSnapshots(baseline[pane], latest[pane]) : null]))
    const newest = pane => latest[pane] ?? baseline[pane] ?? seeded[pane]
    return {
      available: true,
      trust,
      baselineAt,
      rebaselined,
      comparedAt: latestAt,
      errors: { ...errors },
      problems: { base: newest('base')?.problems ?? [], pr: newest('pr')?.problems ?? [] },
      boot: boot && span(boot.base, boot.pr),
      session: session && span(session.base, session.pr),
    }
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
    const open = PANES.map(pane => probes[pane])
    for (const pane of PANES) {
      probes[pane] = null
      seeded[pane] = baseline[pane] = latest[pane] = null
    }
    boot = null
    await Promise.all(open.map(closeProbe))
  }

  return { seeded: seededPane, ready, snapshot, view, close }
}
