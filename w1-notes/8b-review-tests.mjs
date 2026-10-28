
// --- What a self-review found ---------------------------------------------------

const none = validateRules({})
const kindsOf = (flags, kind) => flags.filter(f => f.kind === kind)

// The base excuses only what it did too: the same rows, the same fields. A
// count of the same kind isn't enough.
test('a flag is amber only when the base made the same change: the same rows, the same fields', () => {
  const s = ids => snap({ orders: { key: ['id'], fields: ['id'], rows: ids.map(id => ({ id })) } })
  const seed = s([1, 2, 3, 4, 5, 6])
  const deletes = (baseIds, prIds) => kindsOf(flagChanges(diffSnapshots(seed, s(baseIds)), diffSnapshots(seed, s(prIds)), none, { trusted: true }), 'delete')
  assert.deepEqual(deletes([1, 2, 3, 4, 5], [1, 2, 3, 4, 6]).map(f => [f.severity, f.pr, f.base]), [['red', 1, 1]], 'base deleted 6, the PR 5')
  assert.deepEqual(deletes([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]).map(f => f.severity), ['amber'])
  assert.deepEqual(deletes([2, 3, 4, 5, 6], [3, 4, 5, 6]).map(f => [f.severity, f.pr, f.base]), [['red', 2, 1]], 'the PR deleted more')
  // without a key, as multisets
  const bag = rows => snap({ log: { key: null, rows } })
  const b0 = bag([{ a: 1 }, { a: 2 }])
  const bagDeletes = (b, p) => kindsOf(flagChanges(diffSnapshots(b0, bag(b)), diffSnapshots(b0, bag(p)), none, { trusted: true }), 'delete').map(f => f.severity)
  assert.deepEqual(bagDeletes([{ a: 2 }], [{ a: 2 }]), ['amber'])
  assert.deepEqual(bagDeletes([{ a: 2 }], [{ a: 1 }]), ['red'])
  // truncated: by count
  const big = count => snap({ big: { key: ['id'], rows: [{ id: 1 }], count, truncated: true } })
  const truncated = (b, p) => kindsOf(flagChanges(diffSnapshots(big(100), big(b)), diffSnapshots(big(100), big(p)), none, { trusted: true }), 'delete').map(f => f.severity)
  assert.deepEqual(truncated(90, 95), ['amber'])
  assert.deepEqual(truncated(95, 90), ['red'])
  // a dropped column, per field
  const cols = fields => snap({ users: { key: ['id'], fields, rows: [{ id: 1 }] } })
  const c0 = cols(['id', 'email', 'legacy'])
  const dropped = flagChanges(diffSnapshots(c0, cols(['id', 'email'])), diffSnapshots(c0, cols(['id'])), none, { trusted: true })
  assert.deepEqual(dropped.map(f => [f.kind, f.field, f.severity]), [['column-dropped', 'email', 'red'], ['column-dropped', 'legacy', 'amber']])
  // a mass change of other rows
  const many = topics => snap({ notes: { key: ['id'], rows: topics.map((topic, i) => ({ id: i + 1, topic })) } })
  const n0 = many(Array(60).fill('t'))
  const first = many([...Array(30).fill('u'), ...Array(30).fill('t')])
  const last = many([...Array(30).fill('t'), ...Array(30).fill('u')])
  const mass = b => kindsOf(flagChanges(diffSnapshots(n0, b), diffSnapshots(n0, first), none, { trusted: true }), 'mass-change').map(f => f.severity)
  assert.deepEqual(mass(first), ['amber'])
  assert.deepEqual(mass(last), ['red'])
})

test('only trusted: true trusts the base', () => {
  const s = rows => snap({ c: { key: ['id'], rows } })
  const seed = s([{ id: 1 }])
  const gone = diffSnapshots(seed, s([]))
  for (const trusted of ['advisory', 'trusted', 1, {}, undefined]) {
    assert.deepEqual(flagChanges(gone, gone, none, { trusted }).map(f => f.severity), ['red', 'red'], String(trusted))
  }
  assert.deepEqual(flagChanges(gone, gone, none, { trusted: true }).map(f => f.severity), ['amber', 'amber'])
})

test('masking: JSON kept as text, more secret-looking names, secret over pii, and values nested in JSON', () => {
  const out = snap({
    s: {
      key: ['id'],
      rows: [{
        id: 1,
        settings: '{"api_key":"sk-live-AAA","theme":"dark"}',
        broken: '{"api_key": no',
        nested: { n: 12n, bytes: new Uint8Array([1, 2, 3]), buf: Buffer.from('xyz'), when: new Date('nope') },
        password: 'hunter2',
        list: ['a@example.org'],
      }],
    },
  }, { classify: [{ collection: 's', fields: ['password', 'list'], as: 'pii' }] })
  const [row] = out.collections.s.rows
  assert.equal(row.settings.t, 'json')
  assert.match(row.settings.s, /^\{"api_key":"\[secret [0-9a-f]{8}\]","theme":"dark"\}$/)
  assert.equal(row.broken, '{"api_key": no', 'not JSON: kept as it is')
  assert.match(row.nested.s, /"n":"12"/)
  assert.match(row.nested.s, /"bytes":"\[3 bytes\]"/)
  assert.match(row.nested.s, /"buf":"\[3 bytes\]"/)
  assert.match(row.nested.s, /"when":null/)
  assert.equal(row.password.t, 'secret', 'a secret-looking name stays secret whatever classify says')
  assert.deepEqual([row.list.t, row.list.type], ['pii', 'array'])
  assert.doesNotMatch(JSON.stringify(out), /sk-live|hunter2|example\.org/)
  for (const name of ['authorization', 'cookie', 'credentials', 'pwd', 'cvv', 'jwt', 'bearer', 'access_key', 'aws_access_key_id', 'signing_key', 'client_key', 'dsn', 'database_url', 'signature', 'pin', 'pin_code']) {
    assert.match(name, SECRET_NAME, name)
  }
  for (const name of ['author_id', 'shipping', 'mapping', 'opinion']) assert.doesNotMatch(name, SECRET_NAME, name)
  // a secret's digest is its field's: the same value in two fields doesn't match
  const two = snap({ k: { key: ['id'], rows: [{ id: 1, token: 'same', api_key: 'same' }] } })
  assert.notEqual(two.collections.k.rows[0].token.d, two.collections.k.rows[0].api_key.d)
  // bytes digest by their contents, wherever they sit in memory
  const pooled = Buffer.from('abc')
  const fresh = new Uint8Array([97, 98, 99])
  const b = snap({ k: { key: ['id'], rows: [{ id: 1, x: pooled }, { id: 2, x: fresh }] } })
  assert.equal(b.collections.k.rows[0].x.d, b.collections.k.rows[1].x.d)
})

test('clearing a secret or pii value is seen; a soft delete is seen however it is stored, and never masked', () => {
  const rules = { classify: [{ collection: 'u', fields: ['email'], as: 'pii' }], softDelete: [{ collection: 'u', field: 'is_deleted' }, { collection: 'u', field: 'discarded' }, { collection: 'u', field: 'deleted_at' }] }
  const s = rows => snap({ u: { key: ['id'], rows } }, rules)
  const seed = s([{ id: 1, password_hash: 'h', email: 'a@example.org', is_deleted: 0, discarded: false, deleted_at: null }])
  const now = s([{ id: 1, password_hash: '', email: '', is_deleted: 1, discarded: true, deleted_at: null }])
  const flags = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, now), validateRules(rules), { trusted: true })
  assert.deepEqual(flags.map(f => [f.kind, f.field ?? null, f.pr]), [['delete', null, 1], ['cleared', 'email', 1], ['cleared', 'password_hash', 1]])
  assert.equal(now.collections.u.rows[0].discarded, true, 'a soft-delete field shows as it is')
  // undeleting is no clearing
  const undone = s([{ id: 1, password_hash: 'h', email: 'a@example.org', is_deleted: 0, discarded: false, deleted_at: null }])
  const was = s([{ id: 1, password_hash: 'h', email: 'a@example.org', is_deleted: 0, discarded: false, deleted_at: 5 }])
  assert.deepEqual(flagChanges(diffSnapshots(was, was), diffSnapshots(was, undone), validateRules(rules), { trusted: true }), [])
})

test('a schema change without a key is no change to every row; the key a diff names is the one it used', () => {
  const bag = (fields, rows) => snap({ log: { key: null, fields, rows } })
  const before = bag(['a'], Array.from({ length: 30 }, (_, i) => ({ a: i })))
  const after = bag(['a', 'b'], Array.from({ length: 30 }, (_, i) => ({ a: i, b: 0 })))
  const d = diffSnapshots(before, after).collections.log
  assert.deepEqual([d.status, d.inserted.length, d.deleted.length, d.fieldsAdded], ['changed', 0, 0, ['b']])
  assert.deepEqual(flagChanges(diffSnapshots(before, before), diffSnapshots(before, after), none, { trusted: true }), [])
  // a seed whose key can't be trusted (two rows share it) diffs as a multiset, and says so
  const dup = rows => snap({ c: { key: ['id'], rows } })
  const seed = dup([{ id: 1, n: 1 }, { id: 1, n: 2 }, { id: 2, n: 1 }, { id: 3, n: 1 }])
  const base = diffSnapshots(seed, dup([{ id: 1, n: 1 }, { id: 2, n: 1 }, { id: 3, n: 1 }]))
  const pr = diffSnapshots(seed, dup([{ id: 1, n: 1 }]))
  assert.equal(pr.collections.c.key, null)
  const v = divergence(base, pr).collections.c
  assert.deepEqual([v.status, v.counts.base.deleted, v.counts.pr.deleted], ['differs', 1, 3])
})

test('a truncated collection never claims nothing changed', () => {
  const big = (count, extra = {}) => snap({ big: { key: ['id'], rows: [{ id: 1 }], count, truncated: true, ...extra } })
  const t = diffSnapshots(big(500), big(500)).collections.big
  assert.deepEqual([t.status, t.truncated], ['unknown', true])
  const v = divergence(diffSnapshots(big(500), big(500)), diffSnapshots(big(500), big(500))).collections.big
  assert.deepEqual([v.status, v.truncated], ['unknown', true])
  const counted = divergence(diffSnapshots(big(100), big(90)), diffSnapshots(big(100), big(80))).collections.big
  assert.deepEqual([counted.status, counted.counts.base.deleted, counted.counts.pr.deleted], ['differs', 10, 20])
  // a schema change still shows
  const fields = f => big(500, { fields: f })
  const cols = divergence(diffSnapshots(fields(['id', 'x']), fields(['id', 'x'])), diffSnapshots(fields(['id', 'x']), fields(['id']))).collections.big
  assert.equal(cols.status, 'pr-only')
  // more rows counted than given is truncated; truncated with no count is a problem
  const short = snap({ a: { key: ['id'], rows: [{ id: 1 }], count: 5 }, b: { key: ['id'], rows: [{ id: 1 }], truncated: true } })
  assert.deepEqual([short.collections.a.truncated, short.collections.b.truncated], [true, true])
  assert.deepEqual(short.problems, ['b: truncated without a count'])
})

test('divergence: a collection one pane dropped while the other changed it differs; both added unlike rows differ; a field dropped in the PR only', () => {
  const s = collections => snap(collections)
  const seed = s({ x: { key: ['id'], fields: ['id', 'y'], rows: [{ id: 1, y: 1 }, { id: 2, y: 1 }] } })
  const v1 = divergence(diffSnapshots(seed, s({})), diffSnapshots(seed, s({ x: { key: ['id'], fields: ['id', 'y'], rows: [{ id: 1, y: 1 }] } }))).collections.x
  assert.equal(v1.status, 'differs')
  const added = rows => s({ ...seed.collections, z: { key: ['id'], rows } })
  assert.equal(divergence(diffSnapshots(seed, added([{ id: 1, n: 1 }])), diffSnapshots(seed, added([{ id: 1, n: 2 }]))).collections.z.status, 'differs')
  const v2 = divergence(diffSnapshots(seed, seed), diffSnapshots(seed, s({ x: { key: ['id'], fields: ['id'], rows: [{ id: 1 }, { id: 2 }] } }))).collections.x
  assert.deepEqual([v2.status, v2.changes.map(c => [c.kind, c.field, c.status])], ['pr-only', [['field-dropped', 'y', 'pr-only']]])
})

test('names that Object.prototype has are ordinary names', () => {
  const odd = { constructor: { key: ['id'], rows: [{ id: 1 }] }, toString: { key: null, rows: [] } }
  Object.defineProperty(odd, '__proto__', { value: { key: ['id'], rows: [{ id: 1, __proto__: 'x' }] }, enumerable: true })
  const before = snap({})
  const after = sanitizeSnapshot({ collections: odd }, { masker: masker(), rules: none })
  assert.deepEqual(Object.keys(after.collections).sort(), ['__proto__', 'constructor', 'toString'])
  assert.equal(Object.hasOwn(after.collections.__proto__.rows[0], '__proto__'), true)
  const d = diffSnapshots(before, after).collections
  assert.deepEqual([d.constructor.status, d.toString.status], ['added', 'added'])
  assert.deepEqual(diffSnapshots(after, before).collections.constructor.status, 'dropped')
  const fields = diffSnapshots(snap({ c: { key: ['id'], rows: [{ id: 1 }] } }), snap({ c: { key: ['id'], rows: [{ id: 1, constructor: 1 }] } })).collections.c.updated
  assert.deepEqual(fields, [{ key: '[1]', fields: [{ field: 'constructor', before: null, after: 1 }] }])
})

test('rules: an exact destructive rule wins over a glob, and an entry with a field no rule has is refused', () => {
  const rules = validateRules({ destructive: [{ collection: '*', allowDeletes: true }, { collection: 'orders', maxChanged: 0 }] })
  const s = ids => snap({ orders: { key: ['id'], rows: ids.map(id => ({ id })) } })
  const flags = flagChanges(diffSnapshots(s([1, 2]), s([1, 2])), diffSnapshots(s([1, 2]), s([1])), rules, { trusted: true })
  assert.deepEqual(flags.map(f => f.kind), ['delete', 'mass-change'], 'orders\' own rule: deletes not allowed, and any change is mass')
  for (const [bad, re] of [
    [{ destructive: [{ collection: 'x', allowDelete: true }] }, /destructive\[0\] has a field no rule has: allowDelete/],
    [{ volatile: [{ collection: 'x', fields: ['a'], mood: 'ignore' }] }, /volatile\[0\] has a field no rule has: mood/],
  ]) assert.throws(() => validateRules(bad), re)
})

test('the thresholds\' edges, and volatile fields leave the key and the declared fields too', () => {
  const rows = (n, changed) => Array.from({ length: n }, (_, i) => ({ id: i + 1, topic: i < changed ? 'u' : 't' }))
  const s = (n, changed) => snap({ c: { key: ['id'], rows: rows(n, changed) } })
  const mass = (n, changed, rules = none) => kindsOf(flagChanges(diffSnapshots(s(n, 0), s(n, 0)), diffSnapshots(s(n, 0), s(n, changed)), rules, { trusted: true }), 'mass-change').length
  assert.equal(mass(5, 2), 1, '2 of 5 is over 20% of a collection of 5')
  assert.equal(mass(30, 30, validateRules({ destructive: [{ collection: 'c', maxChanged: 30 }] })), 0, 'up to maxChanged is no mass change')
  assert.equal(mass(30, 31 > 30 ? 30 : 0, validateRules({ destructive: [{ collection: 'c', maxChanged: 29 }] })), 1)
  const v = snap({ c: { key: ['id', 'updated_at'], fields: ['id', 'updated_at', 'n'], rows: [{ id: 1, updated_at: 1, n: 1 }] } }, { volatile: [{ collection: 'c', fields: ['updated_at'] }] })
  assert.deepEqual([v.collections.c.key, v.collections.c.fields], [['id'], ['id', 'n']])
  // two cleared fields, in field order
  const two = r => snap({ m: { key: ['id'], rows: [{ id: 1, ...r }] } })
  const cleared = flagChanges(diffSnapshots(two({ b: 'x', a: 'y' }), two({ b: 'x', a: 'y' })), diffSnapshots(two({ b: 'x', a: 'y' }), two({ b: '', a: '' })), none, { trusted: true })
  assert.deepEqual(cleared.map(f => f.field), ['a', 'b'])
  // a presence field that holds a date is set
  const p = snap({ d: { key: ['id'], rows: [{ id: 1, at: new Date(0) }] } }, { volatile: [{ collection: 'd', fields: ['at'], mode: 'presence' }] })
  assert.equal(p.collections.d.rows[0].at, true)
})

test('sanitizeSnapshot survives limits of null and rows that throw when read', () => {
  const hostile = { id: 1 }
  Object.defineProperty(hostile, 'boom', { enumerable: true, get() { throw new Error('getter') } })
  const out = sanitizeSnapshot({ collections: { ok: { key: ['id'], rows: [{ id: 1 }] }, bad: { key: ['id'], rows: [hostile] } } }, { masker: masker(), rules: none, limits: null })
  assert.deepEqual(Object.keys(out.collections), ['ok'])
  assert.deepEqual(out.problems, ['bad: could not be read: getter'])
})
