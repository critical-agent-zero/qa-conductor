R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-capture.test.mjs'
s = open(R + P).read()

a = """test('the lists go by rank across the PR diff, the divergence and the base diff, so padding in one can\\'t starve another\\'s flagged entry', async () => {
  const key = Array.from({ length: 32 }, (_, i) => `k${i}_${'x'.repeat(150)}`)
  const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const base = { users: users(20) }
  const padding = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`a${String(i).padStart(3, '0')}`, { key, rows: [] }]))
  let pr = base
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { viewBytes: 1_000_000 } })
  pr = { ...base, ...padding }
  await capture.ready({ signal })
  pr = { ...padding, users: users(5) }
  await capture.snapshot()
  const s = capture.view({}).session
  for (const list of ['pr', 'divergence', 'base']) assert.ok(Object.hasOwn(s[list].collections, 'users'), `${list} lists users`)
  assert.equal(s.pr.cut, true, 'the padding is what got cut')
})"""
b = """test('the lists go by rank across the PR diff, the divergence and the base diff, so padding in one can\\'t starve another\\'s flagged entry', async () => {
  // round 5's shape: the PR deletes 15 of 20 users while 45 of its own wide
  // tables (50 rows of 200 characters) are emptied: all red, and their rows
  // fill the span's budget many times over
  const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const wide = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, text: 'w'.repeat(200) }))
  const own = rows => Object.fromEntries(Array.from({ length: 45 }, (_, t) => [`a${String(t).padStart(2, '0')}`, { key: ['id'], rows }]))
  const base = { users: users(20) }
  let pr = base
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { viewBytes: 200_000 } })
  pr = { ...base, ...own(wide) }
  await capture.ready({ signal })
  pr = { ...own([]), users: users(5) }
  await capture.snapshot()
  const s = capture.view({}).session
  for (const list of ['pr', 'divergence', 'base']) assert.ok(Object.hasOwn(s[list].collections, 'users'), `${list} lists users`)
  assert.equal(s.pr.cut, true, 'the PR\\'s own tables are what got cut')
  assert.equal(Object.keys(s.pr.collections).length < 46, true)
  // a list that listed everything says no cut, though another was cut
  assert.equal(s.base.cut, undefined)
})"""
assert s.count(a) == 1
s = s.replace(a, b)

s += r"""
// --- Round 5 of #36's review --------------------------------------------------------

const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@example.org` })) })
const ownTables = (n, rows) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${String(i).padStart(4, '0')}`, { key: ['id'], rows: Array.from({ length: rows }, (_, j) => ({ id: j + 1 })) }]))

// The review's second medium: a span with no base diff (the base pane's
// read failed, or its baseline came late) took every collection for the
// PR's own, so the PR's 1,000 dropped tables hid users's delete.
test('without a base diff, a seeded collection is still told from the PR\'s own: its flags, lists and fallback come first', async () => {
  for (const shape of ['base read failed', 'base baseline late']) {
    const base = { users: people(20) }
    let pr = { users: people(20) }
    let failBase = shape === 'base baseline late'
    const { capture, signal } = await readyCapture({
      snapshot: role => {
        if (role === 'base' && failBase) throw new Error('lock timeout')
        return { collections: structuredClone(role === 'base' ? base : pr) }
      },
      capture: { limits: { maxCollections: 2_000 } },
    })
    pr = { users: people(20), ...ownTables(1_000, 2) }
    await capture.ready({ signal })
    failBase = shape === 'base read failed'
    pr = { users: people(5) }
    await capture.snapshot()
    const s = capture.view({}).session
    assert.equal(s.base, null, shape)
    assert.equal(s.flagsCount.red, 1_002, shape)
    assert.deepEqual([s.flags[0].collection, s.flags[0].kind], ['users', 'delete'], shape)
    assert.equal(Object.keys(s.pr.collections)[0], 'users', shape)
    const fallback = capture.view({}, { lists: false }).session
    assert.deepEqual([fallback.flags[1].collection, fallback.flags[1].kind], ['users', 'delete'], shape)
  }
})

// The review's third medium: an amber-only seeded collection (a cleared
// field) was pushed out of every list by the PR's own red tables.
test('an amber-only seeded collection is listed before the PR\'s own red tables, in the flags and every list', async () => {
  const base = { users: people(20) }
  let pr = { users: people(20) }
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { limits: { maxCollections: 2_000 } } })
  pr = { users: people(20), ...ownTables(1_000, 2) }
  await capture.ready({ signal })
  const cleared = people(20)
  for (const r of cleared.rows.slice(0, 4)) r.email = null
  pr = { users: cleared }
  await capture.snapshot()
  const s = capture.view({}).session
  assert.deepEqual(s.flagsCount, { red: 1_000, amber: 1 })
  assert.deepEqual([s.flags[0].collection, s.flags[0].kind, s.flags[0].severity], ['users', 'cleared', 'amber'])
  assert.equal(Object.keys(s.pr.collections)[0], 'users')
  assert.equal(Object.keys(s.divergence.collections)[0], 'users')
})

// A low: key-lost flags on many seeded tables sorted with the deletes.
test('what loses rows is listed before a lost key, among the seeded collections', async () => {
  const keyed = key => Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`t${String(i).padStart(3, '0')}`, { key: [key], rows: [{ id: 1, uuid: 'a' }, { id: 2, uuid: 'a' }] }]))
  const base = { ...keyed('id'), users: people(20) }
  let pr = base
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }) })
  pr = { ...keyed('uuid'), users: people(5) } // the PR's migration
  await capture.ready({ signal })
  const boot = capture.view({}).boot
  assert.ok(boot.flags.some(f => f.kind === 'key-lost'))
  assert.deepEqual([boot.flags[0].collection, boot.flags[0].kind], ['users', 'delete'])
  assert.equal(Object.keys(boot.pr.collections)[0], 'users')
})

// The review's surviving mutants.
test('mutants: the fallback lists red flags only; a lost key alone ranks as changed rows; equal ranks by name; an amber flag before a status alone; a divergence cut short says so and keeps its order', async () => {
  // M11: a span with 2 red flags and amber ones lists only the red in its fallback
  const shared = { orders: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }, carts: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] } }
  let state = shared
  const amber = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? (state === shared ? shared : { orders: { key: ['id'], rows: [{ id: 1 }] }, carts: { key: ['id'], rows: [{ id: 1 }] } }) : state) }) })
  await amber.capture.ready({ signal: amber.signal })
  state = { orders: { key: ['id'], rows: [{ id: 1 }] }, carts: { key: ['id'], rows: [{ id: 1 }] }, own: { key: ['id'], rows: [] } }
  await amber.capture.snapshot()
  const fb = amber.capture.view({ isolation: { verdict: 'isolated' } }, { lists: false }).session
  assert.ok(fb.flagsCount.amber > 0, JSON.stringify(fb.flagsCount))
  assert.ok(fb.flags.every(f => f.severity === 'red'))
  // M24: a collection whose key alone was lost, in the base pane only (so
  // no flag), ranks as changed rows, before 1,050 collections with an amber
  // flag alone
  const pad = Object.fromEntries(Array.from({ length: 1_050 }, (_, i) => [`a${String(i).padStart(4, '0')}`, { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }]))
  let b = { ...pad, zz: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] } }
  const p = { ...pad, zz: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] } }
  const lost = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? b : p) }), capture: { limits: { maxCollections: 2_000, maxRows: 1 } } })
  await lost.capture.ready({ signal: lost.signal })
  b = { ...pad, zz: { key: ['id'], rows: [{ id: 1, v: 1 }] } }
  await lost.capture.snapshot()
  // N12, N15: equal ranks by name, and an amber flag before a status alone
  const names = Object.keys(lost.capture.view({ isolation: { verdict: 'isolated' } }).session.pr.collections)
  assert.deepEqual(names.slice(0, 3), ['a0000', 'a0001', 'a0002'])
  // N4, N7: a divergence whose entries fill the budget stops, says cut,
  // charges its entries, and lists a prefix of its order
  const key = Array.from({ length: 32 }, (_, i) => `k${i}_${'x'.repeat(100)}`)
  const many = rows => Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`d${String(i).padStart(3, '0')}`, { key, rows }]))
  const row = Object.fromEntries(key.map(k => [k, 1]))
  let pst = many([])
  const div = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? {} : pst) }), capture: { viewBytes: 300_000 } })
  await div.capture.ready({ signal: div.signal })
  pst = many([row])
  await div.capture.snapshot()
  const json = div.capture.viewJson({})
  const d = JSON.parse(json).session
  assert.equal(d.divergence.cut, true)
  const listed = Object.keys(d.divergence.collections)
  assert.deepEqual(listed, Object.keys(many([])).slice(0, listed.length), 'a prefix: nothing skipped')
  assert.ok(Buffer.byteLength(json) < 300_000 + 20_000, `${Buffer.byteLength(json)} bytes`)
})

// The nit: the reason when only the PR's read failed is `failed`, whatever
// happened to the base pane's (case C: its read worked, as its late
// baseline; case D: both ready reads had failed).
test('the unreadable flag\'s reason is failed when only the PR\'s read failed, though the base\'s became its late baseline', async () => {
  for (const both of [false, true]) {
    let fail = { base: true, pr: both }
    const { capture, signal } = await readyCapture({ snapshot: (role, _, st) => { if (fail[role]) throw new Error('busy'); return { collections: structuredClone(st[role]) } } })
    await capture.ready({ signal })
    fail = { base: false, pr: true }
    await capture.snapshot()
    const s = capture.view({}).session
    assert.deepEqual(s.flags.map(f => [f.kind, f.reason]), [['unreadable', 'failed']], String(both))
  }
})
"""
open(R + P, 'w').write(s)
print('ok')
