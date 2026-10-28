
// --- Round 2 of #36's review --------------------------------------------------------

// The review's case: the base pane's ready read fails, the reviewer acts in
// both panes, then takes a snapshot. The base pane's late S1 makes its boot
// span longer than the PR pane's: the two windows differ, so the span says
// so, and nothing in the base's longer window can excuse a PR change.
test('a pane whose S1 came late makes its spans unaligned: incomplete, and nothing excused, even trusted', async () => {
  let failBaseReady = true
  let call = 0
  let clock = 1_000
  const { capture, signal, stores } = await readyCapture({
    snapshot: (role, _, st) => {
      call++
      if (role === 'base' && failBaseReady && call > 2) throw new Error('lock timeout')
      return { collections: structuredClone(st[role]) }
    },
    capture: { now: () => (clock += 1_000) },
  })
  stores.pr.saved_carts.rows = [] // the PR's migration
  await capture.ready({ signal })
  // the reviewer empties the base pane's carts too, before the first snapshot
  stores.base.saved_carts.rows = []
  failBaseReady = false
  await capture.snapshot()
  const v = capture.view({ isolation: { verdict: 'isolated' } })
  assert.deepEqual([v.boot.complete, v.boot.aligned], [false, false])
  assert.deepEqual(v.boot.flags.map(f => [f.kind, f.severity, f.shared]), [['delete', 'red', true], ['emptied', 'red', true]], 'the same change, but over another window: red')
  assert.equal(typeof v.baselines.base, 'number')
  assert.ok(v.baselines.base > v.baselines.pr, 'the base pane\'s baseline is later')
  // its session span is unaligned too, until a re-baseline
  stores.pr.saved_carts.rows = [{ id: 7, owner: 'x' }]
  stores.base.saved_carts.rows = [{ id: 7, owner: 'x' }]
  await capture.snapshot()
  const s = capture.view({ isolation: { verdict: 'isolated' } }).session
  assert.deepEqual([s.complete, s.aligned], [false, false])
  await capture.snapshot({ rebaseline: true })
  stores.pr.saved_carts.rows = []
  stores.base.saved_carts.rows = []
  await capture.snapshot()
  const after = capture.view({ isolation: { verdict: 'isolated' } })
  assert.deepEqual([after.session.complete, after.session.aligned], [true, true])
  assert.deepEqual(after.session.flags.map(f => [f.kind, f.severity]), [['delete', 'amber'], ['emptied', 'amber']])
  assert.deepEqual([after.boot.complete, after.boot.aligned], [false, false], 'a re-baseline never moves the boot span')
})

// #37's review: the PR can make its own read fail (a lock on its database).
// A span with no PR pane then says its changes are unreadable, red, rather
// than listing no flags.
test('a span whose PR pane couldn\'t be read has a red unreadable flag, never no flags', async () => {
  let failPr = false
  const { capture, signal } = await readyCapture({
    snapshot: (role, _, st) => { if (role === 'pr' && failPr) throw new Error('lock timeout'); return { collections: structuredClone(st[role]) } },
  })
  await capture.ready({ signal })
  failPr = true
  await capture.snapshot()
  const v = capture.view({ isolation: { verdict: 'isolated' } })
  assert.deepEqual(v.session.flags, [{ collection: null, kind: 'unreadable', severity: 'red', shared: false, pr: 1, base: 0 }])
  assert.equal(v.session.flagsCount.red, 1)
  // and a boot span whose PR pane has no S0: a hanging open
  const hung = await readyCapture({ capture: { limits: { timeoutMs: 20 } }, open: role => (role === 'pr' ? new Promise(() => {}) : { snapshot: () => ({ collections: {} }) }) })
  await hung.capture.ready({ signal: hung.signal })
  const boot = hung.capture.view({}).boot
  assert.deepEqual([boot.complete, boot.pr, boot.flags.map(f => [f.collection, f.kind, f.severity])], [false, null, [[null, 'unreadable', 'red']]])
})

// The review's case: 100 tables of 1,600 columns added, then dropped. Every
// list an answer gives is cut, within a byte budget per span, with whole
// counts; the flags are listed in part, red first, with their counts.
test('the answer is bounded: field lists, flags and collections are listed in part within each span\'s share, with whole counts', async () => {
  const cols = Array.from({ length: 1_600 }, (_, i) => `column_with_a_rather_long_name_${String(i).padStart(4, '0')}`)
  const tables = (fields, n = 100) => Object.fromEntries(Array.from({ length: n }, (_, t) => [`t${String(t).padStart(3, '0')}`, { key: ['id'], fields: ['id', ...fields], rows: [{ id: 1 }] }]))
  let state = tables([])
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }) })
  state = tables(cols)
  await capture.ready({ signal })
  state = tables([])
  await capture.snapshot()
  const started = performance.now()
  const json = capture.viewJson({})
  const took = performance.now() - started
  assert.ok(json.length < 8 * 1024 * 1024, `${json.length} bytes`)
  assert.ok(took < 5_000, `${Math.round(took)} ms`)
  const v = JSON.parse(json)
  const t0 = v.boot.pr.collections.t000
  assert.deepEqual([t0.fieldsAdded.length <= 50, t0.counts.fieldsAdded], [true, 1_600])
  assert.equal(v.session.pr.collections.t000.counts.fieldsDropped, 1_600)
  assert.ok(v.session.flags.length <= 500, String(v.session.flags.length))
  assert.deepEqual(v.session.flagsCount, { red: 160_000, amber: 0 })
  // a span's share of the budget is its own: the session lists still show
  assert.ok(v.session.pr.collections.t000.fieldsDropped.length > 0)
})

// One answer's byte budget is per span: the boot span's rows can't empty the
// session span's lists, and a list the budget cut says so.
test('each span has its own share of the byte budget, and a list cut by it says so', async () => {
  let state = { audit: { key: ['id'], rows: [] }, saved: { key: ['id'], rows: [{ id: 1 }, { id: 2 }, { id: 3 }] } }
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }), capture: { viewBytes: 8_000 } })
  // the PR's migration writes wide rows: the boot span
  state = { ...state, audit: { key: ['id'], rows: Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'w'.repeat(190) })) } }
  await capture.ready({ signal })
  // the reviewer deletes the saved carts: the session span
  state = { ...state, saved: { key: ['id'], rows: [] } }
  await capture.snapshot()
  const v = capture.view({})
  const audit = v.boot.pr.collections.audit
  assert.ok(audit.inserted.length < 50, String(audit.inserted.length))
  assert.deepEqual([audit.counts.inserted, audit.cut], [50, true])
  for (const pane of ['base', 'pr']) assert.deepEqual(v.session[pane].collections.saved.deleted.map(r => r.key), ['[1]', '[2]', '[3]'], pane)
  assert.equal(v.session.pr.collections.saved.cut, undefined, 'not cut')
  assert.deepEqual(v.session.divergence.collections.saved.changes.map(c => c.key), ['[1]', '[2]', '[3]'])
})

// An answer that fails to build is cached too, so every read doesn't build it again.
test('an answer that fails to build is cached as a failure for its state', async (t) => {
  const { capture, signal } = await readyCapture()
  await capture.ready({ signal })
  const stringify = t.mock.method(JSON, 'stringify', () => { throw new RangeError('Invalid string length') })
  assert.throws(() => capture.viewJson({}), RangeError)
  assert.throws(() => capture.viewJson({}), RangeError)
  assert.equal(stringify.mock.callCount(), 1)
  stringify.mock.restore()
})

// errors.boot keeps every reason, and says a boot span is coming only when
// it can: there is an S0.
test('errors.boot keeps the seeded read\'s reason after the ready read fails too, and promises no boot span without an S0', async () => {
  const { capture, signal } = await readyCapture({ snapshot: role => { if (role === 'pr') throw new Error(`relation "saved_carts" does not exist (${role})`); return { collections: {} } } })
  await capture.ready({ signal })
  const why = capture.view({}).errors.boot.pr
  assert.match(why, /^the seeded snapshot failed: relation "saved_carts" does not exist \(pr\); the ready snapshot failed: .+; it has no seeded snapshot, so no boot span$/)
  assert.doesNotMatch(why, /its baseline will be/)
})

// Behaviour the round-1 answer claimed and no test held.
test('a late pane gets its boot span from a re-baseline too, and a re-baseline never moves an earlier boot span', async () => {
  let failPr = true
  let call = 0
  const { capture, signal, stores } = await readyCapture({
    snapshot: (role, _, st) => { call++; if (role === 'pr' && failPr && call > 2) throw new Error('busy'); return { collections: structuredClone(st[role]) } },
  })
  stores.pr.saved_carts.rows.pop()
  await capture.ready({ signal })
  failPr = false
  await capture.snapshot({ rebaseline: true })
  const v = capture.view({})
  assert.equal(v.boot.pr.collections.saved_carts.counts.deleted, 1, 'the late pane\'s boot span, from the re-baseline')
  stores.base.saved_carts.rows.pop()
  await capture.snapshot({ rebaseline: true })
  assert.equal(capture.view({}).boot.base.collections.saved_carts.status, 'same', 'the base pane\'s boot span stays S0 to its ready read')
})

test('the ready event says when a pane\'s ready read failed; an aborted ready changes nothing; open() gets the timed signal', async () => {
  const { capture, events, signal } = await readyCapture({ snapshot: (role, _, st) => { if (role === 'pr' && events.length >= 2) throw new Error('busy'); return { collections: structuredClone(st[role]) } } })
  await capture.ready({ signal })
  assert.deepEqual(events.slice(2), [{ pane: 'base', phase: 'ready', ok: true }, { pane: 'pr', phase: 'ready', ok: false }])

  // aborted while its reads run: nothing of it is kept
  let hold = false
  const aborted = await readyCapture({ snapshot: (role, _, st) => (hold ? new Promise(() => {}) : { collections: structuredClone(st[role]) }) })
  hold = true
  const ac = new AbortController()
  const running = aborted.capture.ready({ signal: ac.signal })
  await new Promise(resolve => setImmediate(resolve))
  ac.abort()
  await running
  const after = aborted.capture.view({})
  assert.deepEqual([after.baselineAt, after.boot, after.errors], [null, null, NO_ERRORS])

  let given = null
  const timed = createDataCapture({ inspector: { open: ({ signal: s }) => { given = s; return new Promise(() => {}) } }, rules, limits: { timeoutMs: 20 } })
  await timed.seeded({ paneRef: ref('base'), db: null, databases: [], signal: new AbortController().signal })
  assert.equal(given.aborted, true)
  assert.match(String(given.reason?.message), /timed out after 20 ms/)
})
