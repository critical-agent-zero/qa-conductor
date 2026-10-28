
// --- Round 4 of #36's review --------------------------------------------------------

// The review's high: the engine runs on the conductor's event loop. Its work
// is bounded now: the cells a snapshot keeps (#35's maxCells), the session
// span's diffs once for each state, whatever the trust, and the boot span
// once for each settle.
test('the work is bounded: the session diffs are made once for each state, the boot span once for each settle, whatever the trust', async () => {
  let diffs = 0
  const counting = (a, b) => { diffs++; return diffSnapshots(a, b) }
  const { capture, signal, stores } = await readyCapture({ capture: { diff: counting } })
  await capture.ready({ signal })
  stores.pr.saved_carts.rows.pop()
  await capture.snapshot()
  const after = diffs
  for (const verdict of ['isolated', 'shared-host', 'isolated', 'reachable']) capture.viewJson({ isolation: { verdict } })
  assert.equal(diffs - after, 2, 'the session span\\'s two diffs, once')
  // the boot span is the same object across states, for each trust
  const before = capture.view({ isolation: { verdict: 'isolated' } }).boot
  await capture.snapshot()
  assert.equal(capture.view({ isolation: { verdict: 'isolated' } }).boot, before)
  assert.notEqual(capture.view({ isolation: { verdict: 'reachable' } }).boot, before, 'another trust, another span')
})

// The review's first medium: 600 renamed columns on earlier-named seeded
// tables pushed the users delete out of the 500 flags listed.
test('a delete is listed before many column and mass-change flags, and its collection before theirs, within and past the caps', async () => {
  const cols = prefix => Array.from({ length: 30 }, (_, i) => `${prefix}${i}`)
  const tables = prefix => Object.fromEntries(Array.from({ length: 20 }, (_, t) => [`a${String(t).padStart(3, '0')}`, { key: ['id'], fields: ['id', ...cols(prefix)], rows: [{ id: 1 }] }]))
  const users = n => ({ key: ['id'], fields: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const base = { ...tables('old_'), users: users(20) }
  let pr = base
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { viewBytes: 200_000 } })
  pr = { ...tables('new_'), users: users(5) } // the PR's migration
  await capture.ready({ signal })
  const boot = capture.view({}).boot
  assert.equal(boot.flagsCount.red, 602)
  assert.deepEqual([boot.flags[0].collection, boot.flags[0].kind], ['users', 'delete'])
  assert.equal(Object.keys(boot.pr.collections)[0], 'users', 'its rows listed first')
  // and in the answer too big to build: among the first red flags
  const fallback = capture.view({}, { lists: false }).boot
  assert.deepEqual([fallback.flags[1].collection, fallback.flags[1].kind], ['users', 'delete'])
  assert.deepEqual([fallback.flags.length, fallback.flags.every(f => f.severity === 'red')], [21, true], 'only red flags, at most 20 after the unlisted one')
})

// The review's second medium: 1,000 tables the PR made at boot and drops in
// the session ranked with users by name, and pushed its rows out.
test('a seeded collection\\'s flagged rows are listed before the PR\\'s own flagged tables, in the diff and the divergence', async () => {
  const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const base = { users: users(20) }
  const padding = Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`a${String(i).padStart(5, '0')}`, users(2)]))
  let pr = base
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { limits: { maxCollections: 2_000 } } })
  pr = { ...base, ...padding } // the PR's migration
  await capture.ready({ signal })
  pr = { users: users(5) } // the session drops them, and deletes users
  await capture.snapshot()
  const s = capture.view({ isolation: { verdict: 'isolated' } }).session
  assert.equal(s.flagsCount.red, 1_002)
  assert.equal(Object.keys(s.pr.collections)[0], 'users')
  assert.equal(s.pr.collections.users.counts.deleted, 15)
  assert.equal(Object.keys(s.divergence.collections)[0], 'users')
  assert.equal(s.divergence.collections.users.status, 'pr-only')
})

// A low: the PR diff's padding no longer starves the divergence's and the
// base diff's flagged entries: the lists go by rank across all three.
test('the lists go by rank across the PR diff, the divergence and the base diff, so padding in one can\\'t starve another\\'s flagged entry', async () => {
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
})

// A low: the budget is in bytes, not characters: text outside ASCII takes
// up to three bytes a character.
test('the budget counts bytes: an answer of non-ASCII text stays within it', async () => {
  const text = '数据'.repeat(100)
  let state = { t: { key: ['id'], rows: [] } }
  const { capture, signal } = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }), capture: { viewBytes: 200_000 } })
  state = { t: { key: ['id'], rows: Array.from({ length: 2_000 }, (_, id) => ({ id, text })) } }
  await capture.ready({ signal })
  const json = capture.viewJson({})
  assert.ok(Buffer.byteLength(json) < 200_000 + 20_000, `${Buffer.byteLength(json)} bytes`)
})

// The nit: the reason says what happened to the PR pane first.
test('the unreadable flag\\'s reason is the PR pane\\'s: baseline when both panes\\' baselines came from this snapshot, failed when only the base was read', async () => {
  let failReady = true
  let failBase = false
  let call = 0
  const { capture, signal } = await readyCapture({
    snapshot: (role, _, st) => {
      call++
      if (failReady && call > 2) throw new Error('lock timeout')
      if (failBase && role === 'base') throw new Error('busy')
      return { collections: structuredClone(st[role]) }
    },
  })
  await capture.ready({ signal })
  failReady = false
  await capture.snapshot() // both baselines from this snapshot
  assert.deepEqual(capture.view({}).session.flags.map(f => [f.kind, f.reason]), [['unreadable', 'baseline']])
})

// Mutants round 4 let live.
test('the flags are listed before the lists; the divergence ranks counts-only changes and says when it was cut; an empty added collection ranks before unchanged ones', async () => {
  // a span whose lists would fill the budget still lists its flags (M28)
  const names = Array.from({ length: 300 }, (_, i) => `c${String(i).padStart(3, '0')}`)
  let fl = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1, text: 'w'.repeat(150) }, { id: 2, text: 'w'.repeat(150) }] }]))
  const flagged = await readyCapture({ snapshot: () => ({ collections: structuredClone(fl) }), capture: { viewBytes: 60_000 } })
  fl = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1, text: 'w'.repeat(150) }] }]))
  await flagged.capture.ready({ signal: flagged.signal })
  const fb = flagged.capture.view({}).boot
  assert.ok(fb.flags.length >= 100, String(fb.flags.length))
  // the divergence: a collection whose counts alone moved (cut short) ranks
  // before unchanged padding (M22, M23), and says cut when it stops (M4)
  const padding = Object.fromEntries(Array.from({ length: 1_050 }, (_, i) => [`a${String(i).padStart(4, '0')}`, { key: ['id'], rows: [{ id: 1 }] }]))
  let state = { ...padding, zz: { key: ['id'], rows: [1, 2, 3].map(id => ({ id })), count: 9, truncated: true } }
  const div = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }), capture: { limits: { maxCollections: 2_000 } } })
  await div.capture.ready({ signal: div.signal })
  state = { ...padding, zz: { key: ['id'], rows: [1, 2, 3].map(id => ({ id })), count: 7, truncated: true } }
  await div.capture.snapshot()
  const d = div.capture.view({ isolation: { verdict: 'isolated' } }).session
  assert.equal(Object.keys(d.divergence.collections)[0], 'zz')
  const small = await readyCapture({ snapshot: () => ({ collections: structuredClone(state) }), capture: { limits: { maxCollections: 2_000 }, viewBytes: 20_000 } })
  await small.capture.ready({ signal: small.signal })
  state = { ...padding, zz: { key: ['id'], rows: [1, 2, 3].map(id => ({ id })), count: 9, truncated: true } }
  await small.capture.snapshot()
  assert.equal(small.capture.view({}).session.divergence.cut, true)
  // an empty added collection ranks before unchanged ones past 1,000 (M18),
  // and a collection whose key alone was lost, or whose fields alone
  // changed, ranks as changed (M24, M25)
  let st = { ...padding, zz_keyed: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }, zz_fields: { key: ['id'], fields: ['id', 'a'], rows: [{ id: 1 }] } }
  const ranks = await readyCapture({ snapshot: () => ({ collections: structuredClone(st) }), capture: { limits: { maxCollections: 2_000 } } })
  await ranks.capture.ready({ signal: ranks.signal })
  st = { ...padding, zz_added: { key: ['id'], rows: [] }, zz_keyed: { key: ['id'], rows: [{ id: 1 }, { id: 1 }] }, zz_fields: { key: ['id'], fields: ['id', 'b'], rows: [{ id: 1 }] } }
  await ranks.capture.snapshot()
  const r = ranks.capture.view({ isolation: { verdict: 'isolated' } }).session.pr.collections
  for (const name of ['zz_added', 'zz_keyed', 'zz_fields']) assert.ok(Object.hasOwn(r, name), name)
})

test('the PR-only summary keeps its count past 20 folded flags; one pane\\'s failed ready read still sets baselineAt', async () => {
  // 25 named unverified flags and the PR-only summary (M30)
  const names = Array.from({ length: 25 }, (_, i) => `c${String(i).padStart(2, '0')}`)
  const base = Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }] }]))
  let pr = base
  const { capture, signal } = await readyCapture({ snapshot: role => ({ collections: structuredClone(role === 'base' ? base : pr) }), capture: { limits: { maxRows: 1 } } })
  await capture.ready({ signal })
  pr = { ...Object.fromEntries(names.map(n => [n, { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }])), own1: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }, own2: { key: ['id'], rows: [{ id: 1 }, { id: 2 }] } }
  await capture.snapshot()
  const flags = capture.view({}).session.flags
  const summary = flags.find(f => f.collection === null && !f.folded)
  assert.deepEqual([summary.collections, summary.names], [2, ['own1', 'own2']])
  assert.equal(flags.find(f => f.folded).collections, 5)
  // M44
  let failPr = false
  const one = await readyCapture({ snapshot: (role, _, st) => { if (role === 'pr' && failPr) throw new Error('busy'); return { collections: structuredClone(st[role]) } } })
  failPr = true
  await one.capture.ready({ signal: one.signal })
  assert.equal(typeof one.capture.view({}).baselineAt, 'number')
})
