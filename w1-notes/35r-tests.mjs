
// --- What the review of #35 found -------------------------------------------------

// A PR can't hide what it did by making its snapshot too big to keep: a
// collection cut short in the PR pane only is a red flag of its own, and
// divergence won't set its count beside the base's rows.
test('a PR that forces its snapshot over maxRows is flagged unverified, red, and divergence says unknown', () => {
  const users = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}` }))
  const limits = { maxRows: 20 }
  const seed = snap({ users: { key: ['id'], rows: users(10) } }, {}, limits)
  const junk = Array.from({ length: 21 }, (_, i) => ({ id: 1_000 + i, email: 'junk' }))
  const pr = diffSnapshots(seed, snap({ users: { key: ['id'], rows: junk } }, {}, limits))
  const base = diffSnapshots(seed, seed)
  for (const trusted of [true, false]) {
    const flags = flagChanges(base, pr, none, { trusted })
    assert.deepEqual(flags.filter(f => f.kind === 'unverified').map(f => [f.collection, f.severity, f.shared]), [['users', 'red', false]], String(trusted))
  }
  assert.equal(divergence(base, pr).collections.users.status, 'unknown')
})

// The byte budget is shared fairly: a collection a PR adds, that sorts first
// and is huge, can't starve the ones it means to hide changes in.
test('a padding collection can\'t use up the byte budget: the real collection is kept whole, and its mass update flagged', () => {
  const users = (n, role) => Array.from({ length: n }, (_, i) => ({ id: i + 1, role }))
  const limits = { maxBytes: 4_000 }
  const seed = snap({ users: { key: ['id'], rows: users(40, 'member') } }, {}, limits)
  const padding = { aaa_padding: { key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i, pad: 'p'.repeat(200) })) } }
  const after = snap({ ...padding, users: { key: ['id'], rows: users(40, 'admin') } }, {}, limits)
  assert.deepEqual([after.collections.users.truncated, after.collections.users.rows.length], [false, 40])
  assert.equal(after.collections.aaa_padding.truncated, true, 'the padding is what gets cut')
  const flags = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, after), none, { trusted: false })
  assert.deepEqual(flags.map(f => [f.collection, f.kind, f.severity]), [['aaa_padding', 'unverified', 'red'], ['users', 'mass-change', 'red']])
  // more collections than the limit: those past it are left out, said so
  const many = sanitizeSnapshot({ collections: Object.fromEntries(['a', 'b', 'c'].map(n => [n, { key: null, rows: [] }])) }, { masker: masker(), rules: none, limits: { maxCollections: 2 } })
  assert.deepEqual([Object.keys(many.collections), many.problems], [['a', 'b'], ['1 collections past the first 2 were left out']])
})

// A count stands for rows only when both sides have only counts: the base's
// known rows never excuse a PR's cut-short count.
test('a trusted session never excuses a PR delete by count when only the PR side is cut short', () => {
  const orders = ids => ({ orders: { key: ['id'], rows: ids.map(id => ({ id })) } })
  const limits = { maxRows: 12 }
  const seed = snap(orders([1, 2, 3, 4, 5]), {}, limits)
  const base = diffSnapshots(seed, snap(orders([1, 2, 3, 5]), {}, limits)) // deletes 4
  const pr = diffSnapshots(seed, snap(orders([1, 2, 4, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18]), {}, limits)) // deletes 3, and cuts itself short
  assert.equal(pr.collections.orders.truncated, true)
  const flags = flagChanges(base, pr, none, { trusted: true })
  assert.deepEqual(flags.map(f => [f.kind, f.severity, f.shared]), [['unverified', 'red', false]], 'the count rose: no delete by count, but unverified')
  const fell = diffSnapshots(seed, snap(orders([1, 2, 4]), {}, { maxRows: 2 }))
  const both = flagChanges(base, fell, none, { trusted: true })
  assert.deepEqual(both.filter(f => f.kind === 'delete').map(f => [f.severity, f.shared]), [['red', false]], 'a cut-short fall in count against known rows')
  assert.equal(divergence(base, pr).collections.orders.status, 'unknown')
})

// shared says whether the base made the same change, whatever the trust:
// the wrong row, or more rows, is not the same change.
test('flags say whether the base made the same change: the wrong row or more rows is not shared', () => {
  const s = ids => snap({ c: { key: ['id'], rows: ids.map(id => ({ id })) } })
  const seed = s([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  const without = (...gone) => s(seed.collections.c.rows.map(r => r.id).filter(id => !gone.includes(id)))
  const baseDeletes1 = diffSnapshots(seed, without(1))
  for (const trusted of [true, false]) {
    const wrongRow = flagChanges(baseDeletes1, diffSnapshots(seed, without(2)), none, { trusted }).find(f => f.kind === 'delete')
    assert.deepEqual([wrongRow.severity, wrongRow.shared, wrongRow.base], ['red', false, 1], `wrong row, trusted ${trusted}`)
    const overDelete = flagChanges(baseDeletes1, diffSnapshots(seed, without(1, 2, 3, 4)), none, { trusted }).find(f => f.kind === 'delete')
    assert.deepEqual([overDelete.severity, overDelete.shared], ['red', false], `over-delete, trusted ${trusted}`)
    const same = flagChanges(baseDeletes1, diffSnapshots(seed, without(1)), none, { trusted }).find(f => f.kind === 'delete')
    assert.deepEqual([same.severity, same.shared], [trusted ? 'amber' : 'red', true], `the same row, trusted ${trusted}`)
  }
})

test('a mass change of other fields on the same rows is not the base\'s', () => {
  const rows = field => Array.from({ length: 30 }, (_, i) => ({ id: i + 1, topic: 't', role: 'member', ...(field ? { [field]: 'x' } : {}) }))
  const s = field => snap({ c: { key: ['id'], rows: rows(field) } })
  const seed = s(null)
  const flags = flagChanges(diffSnapshots(seed, s('topic')), diffSnapshots(seed, s('role')), none, { trusted: true })
  assert.deepEqual(flags.map(f => [f.kind, f.severity, f.shared]), [['mass-change', 'red', false]])
  const same = flagChanges(diffSnapshots(seed, s('role')), diffSnapshots(seed, s('role')), none, { trusted: true })
  assert.deepEqual(same.map(f => [f.kind, f.severity]), [['mass-change', 'amber']])
})

test('a key the PR\'s rows no longer bear out is flagged, even where deletes are allowed', () => {
  const rules = validateRules({ destructive: [{ collection: 'c', allowDeletes: true }] })
  const s = rows => snap({ c: { key: ['id'], rows } })
  const seed = s([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
  const pr = diffSnapshots(seed, s([{ id: 1, name: '' }, { id: 1, name: 'b' }]))
  assert.equal(pr.collections.c.keyLost, true)
  assert.deepEqual(flagChanges(diffSnapshots(seed, seed), pr, rules, { trusted: true }).map(f => [f.kind, f.severity]), [['key-lost', 'red']])
})

test('masking reaches JSON in nested strings and NDJSON, secret-looking keys in text, and more secret-looking names', () => {
  const out = snap({
    logs: {
      key: ['id'],
      rows: [{
        id: 1,
        request: { path: '/login', body: '{"password":"hunter2","user":"a"}' },
        events: ['{"api_key":"sk-live-AAA"}'],
        line: '{"token":"tok-123"}\n{"x":1}',
        raw: 'user=a password: hunter3 ok',
        deep: { a: '{"b":"{\\"c\\":\\"{\\\\\\"secret\\\\\\":\\\\\\"s4\\\\\\"}\\"}"}' },
        headers: { 'X-Api-Key': 'sk-live-BBB', 'Content-Type': 'json' },
        nums: { pin: 1234 },
        sets: new Set(['a', 'b']),
        maps: new Map([['k', 'v']]),
      }],
    },
  })
  const text = JSON.stringify(out)
  assert.doesNotMatch(text, /hunter2|hunter3|sk-live|tok-123|1234|s4/)
  const [row] = out.collections.logs.rows
  assert.match(row.request.s, /"body":"\{\\"password\\":\\"\[secret [0-9a-f]{8}\]\\",\\"user\\":\\"a\\"\}"/)
  assert.match(row.line, /^\{"token":"\[secret [0-9a-f]{8}\]"\}\n\{"x":1\}$/)
  assert.match(row.raw, /^\[text with a secret-looking key, 27 characters, [0-9a-f]{8}\]$/)
  assert.match(row.headers.s, /"Content-Type":"json"/)
  assert.deepEqual([row.sets.s, row.maps.s], ['["a","b"]', '[["k","v"]]'])
  for (const name of ['X-Api-Key', 'api-key', 'x-access-key', 'database_uri', 'mongo_uri', 'connection_string', 'encryption_key', 'master_key', 'mnemonic', 'seed_phrase', 'recovery_codes', 'pinCode', 'pin_code']) {
    assert.match(name, SECRET_NAME, name)
  }
  // too long to read as JSON: kept as text, masked whole when a secret-looking key shows
  const big = `{"password":"${'x'.repeat(300 * 1024)}"}`
  const huge = snap({ c: { key: ['id'], rows: [{ id: 1, blob: big, fine: `{"a":"${'y'.repeat(300 * 1024)}"}` }] } }).collections.c.rows[0]
  assert.match(huge.blob, /^\[text with a secret-looking key, \d+ characters, [0-9a-f]{8}\]$/)
  assert.deepEqual([huge.fine.t, huge.fine.len], ['long', 300 * 1024 + 8])
})

test('a nested secret\'s digest is its collection\'s and field\'s; the same pii fingerprints alike in two tables; a soft delete set again is no delete', () => {
  const s = snap({
    a: { key: ['id'], rows: [{ id: 1, x: { token: 'same' }, y: { token: 'same' }, email: 'jo@example.org' }] },
    b: { key: ['id'], rows: [{ id: 1, x: { token: 'same' }, email: 'jo@example.org' }] },
  }, { classify: [{ collection: '*', fields: ['email'], as: 'pii' }] })
  const digest = cell => /\[secret ([0-9a-f]{8})\]/.exec(cell.s)[1]
  const [ra] = s.collections.a.rows
  const [rb] = s.collections.b.rows
  assert.equal(new Set([digest(ra.x), digest(ra.y), digest(rb.x)]).size, 3)
  assert.equal(ra.email.fp, rb.email.fp)
  const rules = { softDelete: [{ collection: 'o', field: 'deleted_at' }] }
  const o = at => snap({ o: { key: ['id'], rows: [{ id: 1, deleted_at: at }] } }, rules)
  assert.deepEqual(flagChanges(diffSnapshots(o(5), o(5)), diffSnapshots(o(5), o(7)), validateRules(rules), { trusted: true }), [])
})

test('the masker\'s memory of collections is bounded, and names with NUL in them don\'t collide', () => {
  const m = masker({ classify: [{ collection: 'a\u0000b', fields: ['c'], as: 'pii' }] })
  assert.equal(m.cell('a\u0000b', 'c', 'v').t, 'pii')
  assert.equal(m.cell('a', 'b\u0000c', 'v'), 'v')
  for (let i = 0; i < 1_500; i++) m.cell(`c${i}`, 'f', 'v')
  assert.ok(m.cached() <= 1_000, String(m.cached()))
  // a snapshot whose collections can't be listed is a problem, not a throw
  const hostile = new Proxy({}, { ownKeys() { throw new Error('nope') } })
  assert.deepEqual(sanitizeSnapshot({ collections: hostile }, { masker: masker(), rules: none }).problems, ['the snapshot could not be read: nope'])
})
