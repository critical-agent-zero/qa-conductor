
// --- Round 3 of #36's review --------------------------------------------------------

// The review's first medium: each listed collection's name and key weren't
// charged to the budget, so wide keys made the answer hundreds of MB, or
// too big to build at all. Now each entry is charged, the listing stops
// when the budget runs out and says so, and #35 caps keys and names.
test('wide keys can\'t make the answer big: each collection\'s entry counts against the budget, and listing stops, said so', async () => {
  const keyOf = t => Array.from({ length: 32 }, (_, i) => `${String(t).padStart(3, '0')}_${'k'.repeat(190)}_${i}`)
  const tables = n => Object.fromEntries(Array.from({ length: n }, (_, t) => [`t${String(t).padStart(3, '0')}_${'n'.repeat(190)}`, { key: keyOf(t), rows: [] }]))
  let state = {}
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }) })
  state = tables(1_000) // the PR's migration: 1,000 empty tables with 32-field keys of 200-character names
  await capture.ready({ signal })
  await capture.snapshot()
  const json = capture.viewJson({})
  assert.ok(json.length < 4.5 * 1024 * 1024, `${json.length} characters`)
  const v = JSON.parse(json)
  assert.equal(v.boot.pr.collectionsCount, 1_000)
  assert.ok(Object.keys(v.boot.pr.collections).length < 1_000)
  assert.equal(v.boot.pr.cut, true, 'the listing stopped, said so')
  // a key of more than 32 fields, or a name over 200 characters, never
  // reaches the answer at all (#35)
  state = { wide: { key: Array.from({ length: 2_000 }, (_, i) => `c${i}`), rows: [] }, ['x'.repeat(2_000)]: { key: ['id'], rows: [] } }
  await capture.snapshot()
  const w = capture.view({})
  assert.deepEqual(w.problems.pr, ['1 collection with a name over 200 characters was left out', 'wide: a key of 2000 fields is more than 32, so its rows are compared without one'])
  assert.equal(w.session.pr.collections.wide.key, null)
})

// An answer still too big to build is built again without its lists: the
// badge still counts, and the first red flags still show.
test('an answer too big to build falls back to one without lists: its counts, its first red flags and a red unlisted flag', async (t) => {
  const { capture, signal, stores } = await readyCapture()
  stores.pr.saved_carts.rows = [] // the PR's migration
  await capture.ready({ signal })
  const real = JSON.stringify
  const stringify = t.mock.method(JSON, 'stringify', (value, ...rest) => {
    if (value && value.available && value.boot && !value.boot.unlisted) throw new RangeError('Invalid string length')
    return real(value, ...rest)
  })
  const v = JSON.parse(capture.viewJson({}))
  stringify.mock.restore()
  assert.deepEqual([v.boot.unlisted, v.boot.base, v.boot.pr, v.boot.divergence], [true, null, null, null])
  assert.deepEqual(v.boot.flags.map(f => [f.collection, f.kind, f.severity]), [[null, 'unlisted', 'red'], ['saved_carts', 'delete', 'red'], ['saved_carts', 'emptied', 'red']])
  assert.deepEqual(v.boot.flagsCount, { red: 3, amber: 0 })
  assert.deepEqual(v.errors, NO_ERRORS)
})

// The review's second medium: the PR's migration deletes 15 of 20 users and
// adds 10,999 empty tables that sort first. The user's flags, and users
// itself, must be in the answer.
test('10,999 padding tables can\'t push a real delete out of the answer: its flags lead, and users is listed in the diff and divergence', async () => {
  const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `u${i}` })) })
  let state = { users: users(20) }
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }) })
  const padding = Object.fromEntries(Array.from({ length: 10_999 }, (_, i) => [`a${String(i).padStart(5, '0')}`, { key: ['id'], rows: [] }]))
  state = { ...padding, users: { key: ['id'], rows: users(20).rows.slice(15) } }
  await capture.ready({ signal })
  const boot = capture.view({}).boot
  assert.deepEqual(boot.flags.slice(0, 2).map(f => [f.collection, f.kind, f.severity]), [['users', 'delete', 'red'], ['users', 'mass-change', 'red']])
  assert.equal(boot.pr.collections.users.counts.deleted, 15)
  assert.equal(boot.divergence.collections.users.status, 'pr-only')
  assert.ok(boot.flagsCount.red < 10, JSON.stringify(boot.flagsCount))
})

// Past 20 red unverified flags of named collections, the rest are one.
test('red unverified flags past 20 are folded into one, in their place, with how many and the first five names', async () => {
  const names = Array.from({ length: 30 }, (_, i) => `c${String(i).padStart(2, '0')}`)
  let pr = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }] }]))
  const base = pr
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { limits: { maxRows: 1 } } })
  await capture.ready({ signal })
  // the PR alone writes a second row to each: cut short in its pane only
  pr = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }]))
  await capture.snapshot()
  const s = capture.view({}).session
  assert.equal(s.flagsCount.red, 30)
  assert.deepEqual(s.flags.slice(0, 20).map(f => f.collection), names.slice(0, 20))
  assert.deepEqual(s.flags[20], { collection: null, kind: 'unverified', severity: 'red', shared: false, pr: 10, base: 0, collections: 10, names: names.slice(20, 25), folded: true })
  assert.equal(s.flags.length, 21)
})

// A flagged collection is listed before one that only changed.
test('a diff lists its flagged collections first, before ones that only changed', async () => {
  const names = Array.from({ length: 1_050 }, (_, i) => `a${String(i).padStart(4, '0')}`)
  let state = { ...Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [] }])), zz: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] } }
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }) })
  await capture.ready({ signal })
  // both panes insert a row in each a…; the PR deletes one of zz's
  state = { ...Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }] }])), zz: { key: ['id'], rows: [{ id: 1 }] } }
  await capture.snapshot()
  const s = capture.view({}).session
  assert.equal(s.pr.collections.zz.counts.deleted, 1)
  assert.equal(Object.keys(s.pr.collections)[0], 'zz')
  assert.equal(s.divergence.collections.zz.status, 'pr-only')
})

// The review's first low: both panes' ready reads fail, so both take their
// baseline from one Snapshot now. Their boot spans then run past ready, into
// the session, and the base's action there must not excuse the PR's migration.
test('when both ready reads fail, the boot span is unaligned, so nothing in it is excused, and baselineAt stays unset', async () => {
  let failReady = true
  let call = 0
  const { capture, signal, stores } = await readyCapture({
    snapshot: (role, _, st) => { call++; if (failReady && call > 2) throw new Error('lock timeout'); return { collections: structuredClone(st[role]) } },
  })
  stores.pr.saved_carts.rows = [] // the PR's migration
  await capture.ready({ signal })
  assert.equal(capture.view({}).baselineAt, null, 'no pane has a baseline from ready')
  stores.base.saved_carts.rows = [] // the reviewer's mirrored action
  failReady = false
  await capture.snapshot()
  const v = capture.view({ isolation: { verdict: 'isolated' } })
  assert.deepEqual([v.boot.aligned, v.boot.complete], [false, false])
  assert.deepEqual(v.boot.flags.map(f => [f.kind, f.severity]), [['delete', 'red'], ['emptied', 'red']])
  assert.equal(v.baselineAt, null)
  assert.equal(v.baselines.base, v.baselines.pr)
})

// The review's second low: neither pane could be read for a span after a
// snapshot. It is a span with a red flag, not null.
test('a span neither pane could be read for, after a snapshot, is unreadable and red, not null', async () => {
  let hang = false
  const { capture, signal } = await readyCapture({
    capture: { limits: { timeoutMs: 20 } },
    snapshot: (role, _, st) => (hang ? new Promise(() => {}) : { collections: structuredClone(st[role]) }),
  })
  await capture.ready({ signal })
  hang = true
  await capture.snapshot()
  const s = capture.view({}).session
  assert.deepEqual([s.complete, s.base, s.pr, s.divergence, s.flags.map(f => [f.kind, f.severity, f.reason]), s.flagsCount], [false, null, null, null, [['unreadable', 'red', 'neither']], { red: 1, amber: 0 }])
})

// Mutants round 3 let live: the divergence's own cut and count, and every
// list counted against its span's half of the budget.
test('a divergence lists 50 changes with the whole changesCount, and every list, divergence and flags too, stays within its span\'s half', async () => {
  const many = n => carts(Array.from({ length: n }, (_, i) => ({ id: i + 1, owner: 'o' })))
  const { capture, signal, stores } = await readyCapture()
  stores.base = many(120)
  stores.pr = many(120)
  await capture.ready({ signal })
  stores.base = many(0)
  stores.pr = many(0)
  await capture.snapshot()
  const d = capture.view({}).session.divergence.collections.saved_carts
  assert.deepEqual([d.changes.length, d.changesCount, d.cut], [50, 120, undefined])

  // a span's lists, its divergence's among them, within half of viewBytes
  const size = span => JSON.stringify({ flags: span.flags, base: span.base, pr: span.pr, divergence: span.divergence }).length
  let state = { wide: { key: ['id'], rows: [] } }
  const wide = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }), capture: { viewBytes: 40_000 } })
  state = { wide: { key: ['id'], rows: Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'w'.repeat(190) })) } }
  await wide.capture.ready({ signal: wide.signal })
  const boot = wide.capture.view({}).boot
  assert.ok(size(boot) <= 20_000 + 500, String(size(boot)))
  assert.equal(boot.pr.collections.wide.counts.inserted, 50)
  const dw = boot.divergence.collections.wide
  assert.deepEqual([dw.changesCount, dw.cut, dw.changes.length < 50], [50, true, true])

  // flags count against it too
  const names = Array.from({ length: 300 }, (_, i) => `c${String(i).padStart(3, '0')}`)
  let fl = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }]))
  const flagged = await readyCapture({ snapshot: () => ({ collections: structuredClone(fl) }), capture: { viewBytes: 40_000 } })
  fl = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }] }]))
  await flagged.capture.ready({ signal: flagged.signal })
  const fb = flagged.capture.view({}).boot
  assert.equal(fb.flagsCount.red, 300)
  assert.ok(fb.flags.length < 300, String(fb.flags.length))
  assert.ok(size(fb) <= 20_000 + 500, String(size(fb)))
  assert.equal(fb.pr.cut, true)
})

// A pane's problems are listed in part, with their count.
test('an answer lists at most 50 problems a pane, with the whole count; an error\'s text is cut at 500 characters', async () => {
  const bad = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`b${String(i).padStart(2, '0')}`, { rows: 'x' }]))
  const { capture, signal } = await readyCapture({ snapshot: role => { if (role === 'base') throw new Error('e'.repeat(2_000)); return { collections: bad } } })
  await capture.ready({ signal })
  const v = capture.view({})
  assert.deepEqual([v.problems.pr.length, v.problemsCount.pr, v.problemsCount.base], [50, 80, 0])
  assert.ok(v.errors.boot.base.length < 700, String(v.errors.boot.base.length))
})
