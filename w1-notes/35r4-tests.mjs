
// --- For #36's round 4 --------------------------------------------------------------

// The work is bounded: masking, diffing and flagging take time in proportion
// to the cells kept, on the conductor's event loop. Past maxCells (shared
// fairly, like the bytes), a collection is cut short, so its count alone is
// compared, and it is flagged unverified: it fails closed.
test('maxCells bounds the cells a snapshot keeps, shared fairly; a collection past its share is cut short, and unverified', () => {
  const rows = (n, fields = 2) => Array.from({ length: n }, (_, i) => Object.fromEntries(Array.from({ length: fields }, (_, f) => [`f${f}`, i])))
  const limits = { maxCells: 100 }
  const out = snap({ small: { key: null, rows: rows(10) }, big: { key: null, rows: rows(200) } }, {}, limits)
  assert.deepEqual([out.collections.small.truncated, out.collections.small.rows.length], [false, 10], 'the small one first, whole')
  assert.equal(out.collections.big.truncated, true)
  assert.ok(out.collections.big.rows.length * 2 <= 80, String(out.collections.big.rows.length))
  assert.equal(out.collections.big.count, 200)
  const seed = snap({ small: { key: null, rows: rows(10) }, big: { key: null, rows: rows(30) } }, {}, limits)
  const flags = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, out), none, { trusted: true })
  assert.deepEqual(flags.filter(f => f.collection === 'big').map(f => [f.kind, f.severity]), [['unverified', 'red']])
  // the default bound: 1M rows of 2 fields keep at most 500,000 cells, read
  // in well under the time all of them took
  const huge = { t: { key: null, rows: rows(1_000_000) } }
  const started = performance.now()
  const kept = snap(huge)
  const took = performance.now() - started
  assert.ok(kept.collections.t.rows.length * 2 <= 500_000, String(kept.collections.t.rows.length))
  assert.equal(kept.collections.t.truncated, true)
  assert.ok(took < 3_000, `${Math.round(took)} ms`)
})

// #36's review: flagChanges merged each cleared field's items with a spread
// copy, quadratic in the rows: 10,000 rows with 20 fields cleared took 2.8 s,
// and 100 fields 22 s.
test('flagging many cleared fields is linear: 10,000 rows with 20 fields cleared flag in well under a second', () => {
  const fields = Array.from({ length: 20 }, (_, i) => `f${i}`)
  const at = value => snap({ t: { key: ['id'], rows: Array.from({ length: 10_000 }, (_, id) => ({ id, ...Object.fromEntries(fields.map(f => [f, value])) })) } })
  const before = at('x')
  const after = at('')
  const pr = diffSnapshots(before, after)
  const started = performance.now()
  const flags = flagChanges(diffSnapshots(before, before), pr, none, { trusted: true })
  const took = performance.now() - started
  assert.ok(took < 1_000, `${Math.round(took)} ms`)
  assert.equal(flags.filter(f => f.kind === 'cleared').length, 20)
  assert.ok(flags.filter(f => f.kind === 'cleared').every(f => f.pr === 10_000))
})

// #36's review: a refactor that renames 30 columns in each of 20 earlier-named
// seeded tables put 600 column-dropped flags ahead of the users delete.
test('what loses data is listed before column and mass-change flags, across collections', () => {
  const tables = fields => Object.fromEntries(Array.from({ length: 20 }, (_, t) => [`a${String(t).padStart(3, '0')}`, { key: ['id'], fields: ['id', ...fields], rows: [{ id: 1 }] }]))
  const cols = prefix => Array.from({ length: 30 }, (_, i) => `${prefix}${i}`)
  const users = n => ({ users: { key: ['id'], fields: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) } })
  const seed = snap({ ...tables(cols('old_')), ...users(20) })
  const pr = diffSnapshots(seed, snap({ ...tables(cols('new_')), ...users(5) }))
  const flags = flagChanges(diffSnapshots(seed, seed), pr, none, { trusted: true })
  assert.equal(flags.filter(f => f.kind === 'column-dropped').length, 600)
  assert.deepEqual([flags[0].collection, flags[0].kind], ['users', 'delete'])
  const firstColumn = flags.findIndex(f => f.kind === 'column-dropped')
  const lastLoss = flags.findLastIndex(f => ['delete', 'emptied', 'dropped', 'key-lost'].includes(f.kind))
  assert.ok(lastLoss < firstColumn, `${lastLoss} < ${firstColumn}`)
})
