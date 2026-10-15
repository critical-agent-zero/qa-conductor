// A session's data capture (lib/data-capture.mjs, #8): the probes the
// optional inspector opens, one per pane, and the snapshots taken through
// them: seeded (S0) right after each pane's seed, ready (S1) once both panes
// are up, and on demand. An inspector that throws, hangs or returns
// nonsense never fails anything: its pane says why it has no data.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDataCapture } from '../lib/data-capture.mjs'
import { validateRules } from '../lib/data-diff.mjs'

const ref = role => ({ role, slug: `qa-7-${role}`, publicOrigin: `http://127.0.0.1:${role === 'base' ? 1 : 2}` })

// One store per pane, which the test changes between snapshots. The probe
// reads it as the inspector would.
function fakeInspector({ open, snapshot } = {}) {
  const stores = { base: null, pr: null }
  const calls = []
  const inspector = {
    async open({ paneRef, db, databases, signal }) {
      calls.push(['open', paneRef.role, db, databases, signal instanceof AbortSignal])
      if (open) return open(paneRef.role)
      stores[paneRef.role] = db
      return {
        async snapshot({ limits, signal: s }) {
          calls.push(['snapshot', paneRef.role, typeof limits.maxRows, s instanceof AbortSignal])
          if (snapshot) return snapshot(paneRef.role)
          return { collections: structuredClone(stores[paneRef.role]) }
        },
        async close() { calls.push(['close', paneRef.role]) },
      }
    },
  }
  return { inspector, stores, calls }
}

const carts = rows => ({ saved_carts: { key: ['id'], fields: ['id', 'owner'], rows } })
const seed = () => carts([{ id: 1, owner: 'jane@example.org' }, { id: 2, owner: 'li@example.org' }])
const rules = validateRules({ classify: [{ collection: 'saved_carts', fields: ['owner'], as: 'pii' }] })

async function readyCapture(opts = {}) {
  const events = []
  const fake = fakeInspector(opts)
  const capture = createDataCapture({ inspector: fake.inspector, rules, onCapture: e => events.push(e), ...opts.capture })
  const signal = new AbortController().signal
  for (const role of ['base', 'pr']) await capture.seeded({ paneRef: ref(role), db: seed(), databases: ['shop'], signal })
  return { capture, events, signal, ...fake }
}

test('seeded opens a probe for the pane with its db and takes S0; ready takes S1 and the boot delta', async () => {
  const { capture, events, signal, stores, calls } = await readyCapture()
  assert.deepEqual(calls.slice(0, 2), [['open', 'base', stores.base, ['shop'], true], ['snapshot', 'base', 'number', true]])
  // a migration in the PR pane deleted a saved cart between S0 and S1
  stores.pr.saved_carts.rows.pop()
  await capture.ready({ signal })
  const view = capture.view({ isolation: { verdict: 'isolated' } })
  assert.equal(view.available, true)
  assert.equal(view.trust, 'trusted')
  assert.deepEqual([view.boot.base.collections.saved_carts.status, view.boot.pr.collections.saved_carts.status], ['same', 'changed'])
  assert.equal(view.boot.divergence.collections.saved_carts.status, 'pr-only')
  assert.deepEqual(view.boot.flags.map(f => [f.collection, f.kind, f.severity]), [['saved_carts', 'delete', 'red']])
  assert.equal(view.session, null, 'no session delta before a snapshot')
  assert.deepEqual(view.errors, { base: null, pr: null })
  assert.equal(typeof view.baselineAt, 'number')
  assert.deepEqual([view.rebaselined, view.comparedAt], [false, null])
  // events are value-free
  assert.deepEqual(events, [
    { pane: 'base', phase: 'seeded', ok: true }, { pane: 'pr', phase: 'seeded', ok: true },
    { pane: 'base', phase: 'ready', ok: true }, { pane: 'pr', phase: 'ready', ok: true },
  ])
  // pii shows as a fingerprint, never as the value
  assert.doesNotMatch(JSON.stringify(view), /example\.org|jane|li@/)
})

test('snapshot gives the session delta against the baseline; rebaseline makes now the baseline', async () => {
  const { capture, events, signal, stores } = await readyCapture()
  await capture.ready({ signal })
  stores.base.saved_carts.rows.splice(0, 2)
  stores.pr.saved_carts.rows.splice(0, 2)
  const out = await capture.snapshot()
  assert.equal(out, undefined)
  const view = capture.view({ isolation: { verdict: 'shared-host' } })
  assert.equal(view.trust, 'advisory')
  assert.equal(view.session.divergence.collections.saved_carts.status, 'both')
  // advisory: the base's deletes excuse nothing
  assert.deepEqual(view.session.flags.map(f => [f.kind, f.severity, f.base]), [['delete', 'red', 2], ['emptied', 'red', 1]])
  const trusted = capture.view({ isolation: { verdict: 'isolated' } })
  assert.deepEqual(trusted.session.flags.map(f => f.severity), ['amber', 'amber'])
  assert.equal(typeof view.comparedAt, 'number')
  assert.deepEqual(events.slice(-2), [{ pane: 'base', phase: 'now', ok: true }, { pane: 'pr', phase: 'now', ok: true }])

  await capture.snapshot({ rebaseline: true })
  const after = capture.view({ isolation: null })
  assert.deepEqual([after.rebaselined, after.session, after.comparedAt], [true, null, null])
  stores.pr.saved_carts.rows.push({ id: 9, owner: 'x@example.org' })
  await capture.snapshot()
  assert.deepEqual(capture.view({}).session.pr.collections.saved_carts.inserted.map(r => r.key), ['[9]'])
  assert.deepEqual(events.slice(-4).map(e => e.phase), ['baseline', 'baseline', 'now', 'now'])
})

test('an inspector that throws, hangs or returns nonsense fails nothing: its pane says why', async () => {
  // open throws for base, returns no probe for pr
  const bad = await readyCapture({ open: role => { if (role === 'base') throw new Error('no route to db'); return { nope: true } } })
  await bad.capture.ready({ signal: bad.signal })
  const v = bad.capture.view({})
  assert.match(v.errors.base, /the inspector's open failed: no route to db/)
  assert.match(v.errors.pr, /the inspector's open gave no probe/)
  assert.deepEqual([v.boot, v.session], [null, null])
  assert.deepEqual(bad.events.map(e => e.ok), [false, false])
  await assert.rejects(bad.capture.snapshot(), { status: 409, message: /neither pane has a probe/ })

  // snapshots that throw, or give no collections
  const broken = await readyCapture({ snapshot: role => { if (role === 'base') throw new Error('relation "x" does not exist'); return 'nonsense' } })
  const w = broken.capture.view({})
  assert.match(w.errors.base, /the seeded snapshot failed: relation "x" does not exist/)
  assert.equal(w.errors.pr, null)
  assert.deepEqual(w.problems.pr, ['the snapshot has no collections object'])
  assert.deepEqual(broken.events.map(e => [e.pane, e.ok]), [['base', false], ['pr', true]])
})

test('a hanging open or snapshot times out, and a probe that comes too late is closed', async () => {
  let release
  const late = new Promise(resolve => { release = resolve })
  const closed = []
  const { capture } = await readyCapture({
    capture: { limits: { timeoutMs: 20 } },
    open: role => (role === 'base' ? late : { snapshot: () => new Promise(() => {}), close: () => closed.push('pr') }),
  })
  const v = capture.view({})
  assert.match(v.errors.base, /the inspector's open failed: timed out after 20 ms/)
  assert.match(v.errors.pr, /the seeded snapshot failed: timed out after 20 ms/)
  release({ snapshot: () => ({ collections: {} }), close: () => closed.push('base') })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(closed, ['base'], 'the late probe is closed, and never used')
  await capture.close()
  assert.deepEqual(closed, ['base', 'pr'])
})

test('an aborted boot calls the inspector no more', async () => {
  const fake = fakeInspector()
  const capture = createDataCapture({ inspector: fake.inspector, rules })
  const ac = new AbortController()
  await capture.seeded({ paneRef: ref('base'), db: seed(), databases: [], signal: ac.signal })
  ac.abort()
  await capture.seeded({ paneRef: ref('pr'), db: seed(), databases: [], signal: ac.signal })
  await capture.ready({ signal: ac.signal })
  assert.deepEqual(fake.calls.map(c => c.slice(0, 2)), [['open', 'base'], ['snapshot', 'base']])
  // an abort while a snapshot runs ends the wait
  const hung = createDataCapture({ inspector: { open: () => ({ snapshot: () => new Promise(() => {}) }) }, rules })
  const ac2 = new AbortController()
  const pending = hung.seeded({ paneRef: ref('base'), db: null, databases: [], signal: ac2.signal })
  ac2.abort()
  await pending
  assert.match(hung.view({}).errors.base, /aborted/)
})

test('close closes each probe once, drops the snapshots, and a snapshot racing it answers 409', async () => {
  const { capture, calls, signal } = await readyCapture()
  await capture.ready({ signal })
  await capture.close()
  await capture.close()
  assert.deepEqual(calls.filter(c => c[0] === 'close').map(c => c[1]), ['base', 'pr'])
  assert.deepEqual(capture.view({}), { available: true, closed: true })
  await assert.rejects(capture.snapshot(), { status: 409, message: /the session ended/ })
  await capture.seeded({ paneRef: ref('base'), db: seed(), databases: [], signal })
  assert.equal(calls.filter(c => c[0] === 'open').length, 2, 'a closed capture opens nothing')

  // a snapshot in flight when the session ends is dropped
  const waiting = []
  const slow = createDataCapture({
    inspector: { open: () => ({ snapshot: () => new Promise(resolve => waiting.push(resolve)), close: () => {} }) },
    rules,
    limits: { timeoutMs: 10_000 },
  })
  const answer = async () => {
    while (waiting.length === 0) await new Promise(resolve => setImmediate(resolve))
    waiting.shift()({ collections: {} })
  }
  const seededDone = slow.seeded({ paneRef: ref('base'), db: null, databases: [], signal })
  await answer()
  await seededDone
  const racing = slow.snapshot()
  while (waiting.length === 0) await new Promise(resolve => setImmediate(resolve))
  await slow.close()
  await answer()
  await assert.rejects(racing, { status: 409, message: /the session ended/ })
})

test('concurrent snapshots share one run; a re-baseline while one runs answers 409', async () => {
  let runs = 0
  const { capture, signal } = await readyCapture({ snapshot: () => { runs++; return { collections: {} } } })
  await capture.ready({ signal })
  runs = 0
  const [a, b] = [capture.snapshot(), capture.snapshot()]
  const c = capture.snapshot({ rebaseline: true })
  await Promise.all([a, b])
  await assert.rejects(c, { status: 409, message: /a snapshot is already being taken/ })
  assert.equal(runs, 2, 'one per pane')
  await capture.snapshot({ rebaseline: true })
  assert.equal(runs, 4, 'once the first is done, another may start')
})

test('a pane whose ready snapshot failed gets a baseline from a re-baseline', async () => {
  let fail = true
  const { capture, signal } = await readyCapture({ snapshot: role => { if (role === 'pr' && fail) throw new Error('busy'); return { collections: carts([]) } } })
  await capture.ready({ signal })
  assert.match(capture.view({}).errors.pr, /the ready snapshot failed: busy/)
  fail = false
  await capture.snapshot({ rebaseline: true })
  const v = capture.view({})
  assert.equal(v.errors.pr, null)
  assert.equal(v.rebaselined, true)
  await capture.snapshot()
  assert.deepEqual(Object.keys(capture.view({}).session.pr.collections), ['saved_carts'])
})
