// The data checks' pure engine (lib/data-diff.mjs, #8): what a pane's
// snapshot keeps, and masks; what changed between two snapshots of one pane;
// where the PR pane's changes depart from the base pane's; and which of them
// are destructive. No I/O.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIMITS, SECRET_NAME, createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, trustOf, validateRules,
} from '../lib/data-diff.mjs'

const KEY = Buffer.alloc(32, 7)
const masker = (rules = {}, key = KEY) => createMasker({ key, rules: validateRules(rules) })
const snap = (collections, rules = {}, limits) => sanitizeSnapshot({ collections }, { masker: masker(rules), rules: validateRules(rules), limits })

test('the limits, and the names that look secret', () => {
  assert.deepEqual(LIMITS, { maxRows: 10_000, maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000 })
  assert.ok(Object.isFrozen(LIMITS))
  for (const name of ['password', 'pass_hash', 'apiKey', 'api_key', 'client_secret', 'reset_token', 'otp', 'salt', 'private_key', 'session_id', 'card_number', 'ssn', 'iban']) {
    assert.match(name, SECRET_NAME, name)
  }
  for (const name of ['email', 'name', 'id', 'quantity', 'topic']) assert.doesNotMatch(name, SECRET_NAME, name)
})

test('validateRules: data only, every list optional, names exact or with * globs; anything else throws', () => {
  assert.deepEqual(validateRules(undefined), { exclude: [], volatile: [], classify: [], softDelete: [], destructive: [] })
  const ok = validateRules({
    exclude: ['schema_migrations', 'auth.*'],
    volatile: [{ collection: '*', fields: ['updated_at'] }, { collection: 'sessions', fields: ['expires'], mode: 'presence' }],
    classify: [{ collection: 'users', fields: ['email'], as: 'pii' }],
    softDelete: [{ collection: 'orders', field: 'deleted_at' }],
    destructive: [{ collection: 'carts', maxChanged: 5, allowDeletes: true }],
  })
  assert.deepEqual(ok.volatile.map(v => v.mode), ['ignore', 'presence'])
  assert.deepEqual(ok.destructive, [{ collection: 'carts', maxChanged: 5, allowDeletes: true }])
  for (const [bad, re] of [
    [{ exclude: 'x' }, /exclude must be an array of collection names/],
    [{ exclude: [7] }, /exclude must be an array of collection names/],
    [{ exclude: [''] }, /exclude must be an array of collection names/],
    [{ volatile: {} }, /volatile must be an array/],
    [{ volatile: [null] }, /volatile\[0\]\.collection must be a collection name/],
    [{ volatile: [{ collection: 'x' }] }, /volatile\[0\]\.fields must be an array of field names/],
    [{ volatile: [{ collection: 'x', fields: ['a'], mode: 'drop' }] }, /volatile\[0\]\.mode must be ignore or presence/],
    [{ classify: [{ collection: 'x', fields: ['a'], as: 'public' }] }, /classify\[0\]\.as must be secret or pii/],
    [{ softDelete: [{ collection: 'x' }] }, /softDelete\[0\]\.field must be a field name/],
    [{ destructive: [{ collection: 'x', maxChanged: -1 }] }, /destructive\[0\]\.maxChanged must be a non-negative integer/],
    [{ destructive: [{ collection: 'x', allowDeletes: 'yes' }] }, /destructive\[0\]\.allowDeletes must be a boolean/],
    [{ keyOf: () => 'x' }, /unknown data rule: keyOf/],
    ['rules', /rules must be an object/],
    [[], /rules must be an object/],
  ]) assert.throws(() => validateRules(bad), re, JSON.stringify(bad))
  // a glob stands for any run of characters, and nothing else in it is special
  const s = snap({ 'auth.users': { key: null, rows: [] }, 'authXusers': { key: null, rows: [] }, 'a.b': { key: null, rows: [] } }, { exclude: ['auth.*'] })
  assert.deepEqual(Object.keys(s.collections), ['a.b', 'authXusers'])
})

// Owner decision B: values are shown, but a secret-looking or `secret`
// field keeps only a digest (so the harness can say it changed), and a
// `pii` one a fingerprint, its type and its length.
test('sanitizeSnapshot masks secret-looking and classified fields, fingerprints pii, and cuts long values', () => {
  const rules = { exclude: ['schema_*'], classify: [{ collection: 'users', fields: ['email'], as: 'pii' }, { collection: 'users', fields: ['note'], as: 'secret' }] }
  const out = snap({
    users: {
      key: ['id'], fields: ['id', 'email', 'password_hash', 'note', 'bio', 'prefs', 'score', 'big', 'blob', 'gone'],
      rows: [{
        id: 1, email: 'jane@example.org', password_hash: '$2b$10$abc', note: 'SECRET note', bio: 'x'.repeat(300),
        prefs: { theme: 'dark', api_key: 'sk-live-123' }, score: Infinity, big: 12n, blob: Buffer.from('raw bytes'), gone: null,
      }],
      count: 1,
    },
    schema_migrations: { key: null, rows: [{ v: 1 }] },
  }, rules)
  assert.deepEqual(out.problems, [])
  assert.deepEqual(Object.keys(out.collections), ['users'])
  const [row] = out.collections.users.rows
  assert.equal(row.id, 1)
  assert.deepEqual(Object.keys(row.email).sort(), ['fp', 'len', 't', 'type'])
  assert.deepEqual([row.email.t, row.email.type, row.email.len], ['pii', 'string', 16])
  assert.match(row.email.fp, /^[0-9a-f]{8}$/)
  assert.deepEqual(Object.keys(row.password_hash).sort(), ['d', 't'])
  assert.equal(row.password_hash.t, 'secret')
  assert.match(row.password_hash.d, /^[0-9a-f]{16}$/)
  assert.equal(row.note.t, 'secret')
  assert.deepEqual([row.bio.t, row.bio.s, row.bio.len], ['long', 'x'.repeat(200), 300])
  assert.match(row.bio.d, /^[0-9a-f]{16}$/)
  // a secret-looking key inside a JSON value is masked too
  assert.equal(row.prefs.t, 'json')
  assert.match(row.prefs.s, /^\{"theme":"dark","api_key":"\[secret [0-9a-f]{8}\]"\}$/)
  assert.equal(row.score, null)
  assert.equal(row.big, '12')
  assert.deepEqual([row.blob.t, row.blob.len], ['blob', 9])
  assert.match(row.blob.d, /^[0-9a-f]{16}$/)
  assert.equal(row.gone, null, 'a value that is not set says so, whatever its field')
  assert.doesNotMatch(JSON.stringify(out), /jane|example|\$2b|SECRET note|sk-live|raw bytes/)
  // the same value fingerprints alike under the same key, and differently under another
  const again = snap({ users: { key: ['id'], rows: [{ id: 2, email: 'jane@example.org' }] } }, rules)
  assert.equal(again.collections.users.rows[0].email.fp, row.email.fp)
  const other = sanitizeSnapshot({ collections: { users: { key: ['id'], rows: [{ id: 2, email: 'jane@example.org' }] } } }, { masker: masker(rules, Buffer.alloc(32, 8)), rules: validateRules(rules) })
  assert.notEqual(other.collections.users.rows[0].email.fp, row.email.fp)
  // a secret that is unset is null; one that is set never shows
  const unset = snap({ t: { key: ['id'], rows: [{ id: 1, token: null }, { id: 2, token: '' }] } })
  assert.deepEqual(unset.collections.t.rows.map(r => r.token?.t ?? r.token), [null, 'secret'])
})

test('sanitizeSnapshot never throws, and copes with values that are not plain JSON', () => {
  const circular = { a: 1 }
  circular.self = circular
  const out = snap({ odd: { key: ['id'], rows: [{ id: 1, c: circular, f: () => 1, d: new Date(0), u: undefined }] } })
  const [row] = out.collections.odd.rows
  assert.equal(row.c.t, 'json')
  assert.equal(row.f, null)
  assert.equal(row.d, '1970-01-01T00:00:00.000Z')
  assert.equal(row.u, null)
})

test('sanitizeSnapshot keeps at most maxRows a collection and maxBytes in all, with the true count, and says what it refused', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: i }))
  const out = snap({ big: { key: ['id'], rows }, told: { key: ['id'], rows: rows.slice(0, 3), count: 900, truncated: true } }, {}, { maxRows: 10 })
  assert.deepEqual([out.collections.big.rows.length, out.collections.big.count, out.collections.big.truncated], [10, 12, true])
  assert.deepEqual([out.collections.told.count, out.collections.told.truncated], [900, true])
  // the byte budget is for the whole snapshot, in collection-name order
  const bytes = snap({ a: { key: ['id'], rows: [{ id: 1, s: 'x'.repeat(50) }] }, b: { key: ['id'], rows: [{ id: 1, s: 'y'.repeat(50) }] } }, {}, { maxBytes: 80 })
  assert.deepEqual([bytes.collections.a.truncated, bytes.collections.a.rows.length, bytes.collections.b.truncated, bytes.collections.b.rows.length, bytes.collections.b.count], [false, 1, true, 0, 1])
  // anything that isn't a snapshot is an empty one, with a problem
  for (const bad of [null, 'x', { collections: [] }, { collections: null }]) {
    const s = sanitizeSnapshot(bad, { masker: masker(), rules: validateRules({}) })
    assert.deepEqual([s.collections, s.problems.length], [{}, 1], JSON.stringify(bad))
  }
  const partly = snap({ a: { rows: 'x' }, b: { key: ['id'], rows: [{ id: 1 }, 'row', null, { id: 2 }] } })
  assert.deepEqual(Object.keys(partly.collections), ['b'])
  assert.deepEqual(partly.problems, ['a: rows must be an array', 'b: 2 rows are not objects'])
  assert.equal(partly.collections.b.rows.length, 2)
  // a key its rows don't all have, or that two rows share, can't be trusted: none
  assert.equal(snap({ c: { key: ['id'], rows: [{ id: 1 }, { other: 2 }] } }).collections.c.key, null)
  assert.equal(snap({ c: { key: ['id'], rows: [{ id: 1 }, { id: 1 }] } }).collections.c.key, null)
  assert.deepEqual(snap({ c: { key: ['a', 'b'], rows: [{ a: 1, b: 1 }, { a: 1, b: 2 }] } }).collections.c.key, ['a', 'b'])
})

const users = (rows, extra = {}) => ({ key: ['id'], fields: ['id', 'name', 'topic', 'updated_at'], rows, ...extra })

test('diffSnapshots: inserted, updated field by field, and deleted rows, by key; volatile fields never count', () => {
  const rules = { volatile: [{ collection: '*', fields: ['updated_at'] }] }
  const before = snap({ users: users([{ id: 1, name: 'a', topic: 'billing', updated_at: 1 }, { id: 2, name: 'b', topic: 'x', updated_at: 1 }]) }, rules)
  const after = snap({ users: users([{ id: 1, name: 'a', topic: '', updated_at: 2 }, { id: 3, name: 'c', topic: 'y', updated_at: 2 }]) }, rules)
  const u = diffSnapshots(before, after).collections.users
  assert.deepEqual([u.status, u.countBefore, u.countAfter, u.truncated], ['changed', 2, 2, false])
  assert.deepEqual(u.inserted, [{ key: '[3]', row: { id: 3, name: 'c', topic: 'y' } }])
  assert.deepEqual(u.deleted, [{ key: '[2]', row: { id: 2, name: 'b', topic: 'x' } }])
  assert.deepEqual(u.updated, [{ key: '[1]', fields: [{ field: 'topic', before: 'billing', after: '' }] }])
  // nothing changed but the volatile field: the same
  const same = diffSnapshots(before, snap({ users: users([{ id: 1, name: 'a', topic: 'billing', updated_at: 9 }, { id: 2, name: 'b', topic: 'x', updated_at: 9 }]) }, rules))
  assert.equal(same.collections.users.status, 'same')
  // a secret that changed shows only that it did
  const s = rows => snap({ accounts: { key: ['id'], rows } })
  const pw = diffSnapshots(s([{ id: 1, password: 'old' }]), s([{ id: 1, password: 'new' }])).collections.accounts.updated[0].fields[0]
  assert.deepEqual([pw.field, pw.before.t, pw.after.t, pw.before.d === pw.after.d], ['password', 'secret', 'secret', false])
})

test('diffSnapshots: presence-only fields count only when set or cleared; unkeyed collections diff as multisets', () => {
  const rules = { volatile: [{ collection: 'sessions', fields: ['token_expires'], mode: 'presence' }] }
  const s = rows => snap({ sessions: { key: ['id'], rows } }, rules)
  assert.equal(diffSnapshots(s([{ id: 1, token_expires: 10 }]), s([{ id: 1, token_expires: 20 }])).collections.sessions.status, 'same')
  const cleared = diffSnapshots(s([{ id: 1, token_expires: 10 }]), s([{ id: 1, token_expires: null }]))
  assert.deepEqual(cleared.collections.sessions.updated, [{ key: '[1]', fields: [{ field: 'token_expires', before: true, after: false }] }])

  const bag = rows => snap({ log: { key: null, rows } })
  const m = diffSnapshots(bag([{ a: 1 }, { a: 1 }, { a: 2 }]), bag([{ a: 1 }, { a: 3 }])).collections.log
  assert.deepEqual([m.inserted.map(r => r.row), m.deleted.map(r => r.row), m.updated], [[{ a: 3 }], [{ a: 1 }, { a: 2 }], []])
  assert.deepEqual([m.inserted[0].key, m.deleted[0].key], [null, null])
})

test('diffSnapshots: a truncated collection reports only its count; added and dropped collections, and added and dropped fields', () => {
  const big = (count, extra) => snap({ big: { key: ['id'], rows: [{ id: 1 }], count, truncated: true, ...extra } })
  const t = diffSnapshots(big(500), big(480)).collections.big
  assert.deepEqual([t.status, t.truncated, t.inserted, t.deleted, t.updated, t.countBefore, t.countAfter], ['changed', true, [], [], [], 500, 480])
  assert.equal(diffSnapshots(big(500), big(500)).collections.big.status, 'same', 'no claim either way past the count')
  const before = snap({ a: { key: ['id'], fields: ['id', 'x'], rows: [{ id: 1, x: 1 }] }, gone: { key: ['id'], rows: [{ id: 1 }] } })
  const after = snap({ a: { key: ['id'], fields: ['id', 'y'], rows: [{ id: 1, y: 0 }] }, fresh: { key: ['id'], rows: [{ id: 7 }] } })
  const d = diffSnapshots(before, after).collections
  assert.deepEqual([d.gone.status, d.gone.countBefore, d.gone.countAfter], ['dropped', 1, 0])
  assert.deepEqual([d.fresh.status, d.fresh.inserted], ['added', [{ key: '[7]', row: { id: 7 } }]])
  // a field that comes or goes with the schema is named once, not as an update to every row
  assert.deepEqual([d.a.status, d.a.fieldsDropped, d.a.fieldsAdded, d.a.updated], ['changed', ['x'], ['y'], []])
  // a key that changed: the rows diff as a multiset
  const rekeyed = diffSnapshots(snap({ k: { key: ['id'], rows: [{ id: 1, n: 'a' }] } }), snap({ k: { key: ['n'], rows: [{ id: 1, n: 'a' }] } })).collections.k
  assert.equal(rekeyed.status, 'same')
})

// Base and PR start from one seed and get the same mirrored actions: where
// their changes differ is where the PR's data behaviour departs from base's.
test('divergence: by key, each change is in both, the PR only, the base only, or differs; without a key, by count', () => {
  const s = rows => snap({ carts: { key: ['id'], rows } })
  const seed = s([{ id: 1, n: 1 }, { id: 2, n: 1 }, { id: 3, n: 1 }, { id: 4, n: 1 }])
  const base = diffSnapshots(seed, s([{ id: 2, n: 2 }, { id: 3, n: 5 }, { id: 4, n: 1 }, { id: 9, n: 1 }]))
  const pr = diffSnapshots(seed, s([{ id: 2, n: 2 }, { id: 3, n: 6 }, { id: 9, n: 2 }]))
  const v = divergence(base, pr).collections.carts
  assert.equal(v.status, 'differs')
  assert.deepEqual(v.changes.map(c => [c.kind, c.key, c.status]), [
    ['delete', '[1]', 'both'],
    ['update', '[2]', 'both'],
    ['update', '[3]', 'differs'],
    ['delete', '[4]', 'pr-only'],
    ['insert', '[9]', 'differs'],
  ])
  assert.deepEqual(v.changes[2].base, [{ field: 'n', before: 1, after: 5 }])
  assert.deepEqual(v.changes[3].base, null)
  const nothing = diffSnapshots(seed, seed)
  assert.equal(divergence(nothing, pr).collections.carts.status, 'pr-only')
  assert.equal(divergence(base, nothing).collections.carts.status, 'base-only')
  assert.equal(divergence(base, base).collections.carts.status, 'both')
  assert.equal(divergence(nothing, nothing).collections.carts.status, 'same')
  const mixed = divergence(diffSnapshots(seed, s([{ id: 2, n: 1 }, { id: 3, n: 1 }, { id: 4, n: 1 }])), diffSnapshots(seed, s([{ id: 1, n: 1 }, { id: 3, n: 1 }, { id: 4, n: 1 }])))
  assert.equal(mixed.collections.carts.status, 'differs', 'each did something the other didn\'t')

  const bag = rows => snap({ log: { key: null, rows } })
  const b0 = bag([])
  const lv = divergence(diffSnapshots(b0, bag([{ a: 1 }])), diffSnapshots(b0, bag([{ a: 1 }, { a: 2 }]))).collections.log
  assert.deepEqual([lv.status, lv.changes], ['differs', []])
  assert.deepEqual(lv.counts, { base: { inserted: 1, updated: 0, deleted: 0 }, pr: { inserted: 2, updated: 0, deleted: 0 } })
  assert.equal(divergence(diffSnapshots(b0, b0), diffSnapshots(b0, bag([{ a: 1 }]))).collections.log.status, 'pr-only')
  assert.equal(divergence(diffSnapshots(b0, bag([{ a: 1 }])), diffSnapshots(b0, bag([{ a: 1 }]))).collections.log.status, 'both')
  // a collection only one pane dropped, or added
  const two = snap({ x: { key: ['id'], rows: [{ id: 1 }] }, y: { key: ['id'], rows: [] } })
  const prDropped = divergence(diffSnapshots(two, two), diffSnapshots(two, snap({ y: { key: ['id'], rows: [] } }))).collections
  assert.deepEqual([prDropped.x.status, prDropped.y.status], ['pr-only', 'same'])
  const bothAdded = divergence(diffSnapshots(two, snap({ ...two.collections, z: { key: ['id'], rows: [] } })), diffSnapshots(two, snap({ ...two.collections, z: { key: ['id'], rows: [] } })))
  assert.equal(bothAdded.collections.z.status, 'both')
})

test('flagChanges: deletes, emptied and dropped collections, dropped fields, mass changes and cleared fields; red when only the PR did it', () => {
  const ruleSet = { softDelete: [{ collection: 'orders', field: 'deleted_at' }] }
  const rules = validateRules(ruleSet)
  const s = collections => snap(collections, ruleSet)
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, topic: 't', deleted_at: null }))
  const seedCollections = {
    saved_carts: { key: ['id'], rows: rows(3) },
    cart_items: { key: ['id'], rows: rows(2) },
    orders: { key: ['id'], rows: rows(2) },
    messages: { key: ['id'], fields: ['id', 'topic', 'deleted_at'], rows: rows(1) },
    big: { key: ['id'], rows: rows(30) },
    doomed: { key: ['id'], rows: rows(1) },
  }
  const seed = s(seedCollections)
  const base = diffSnapshots(seed, s({ ...seedCollections, cart_items: { key: ['id'], rows: [] } }))
  const pr = diffSnapshots(seed, s({
    saved_carts: { key: ['id'], rows: [] },
    cart_items: { key: ['id'], rows: [] },
    orders: { key: ['id'], rows: [{ id: 1, topic: 't', deleted_at: 5 }, { id: 2, topic: 't', deleted_at: null }] },
    messages: { key: ['id'], fields: ['id', 'deleted_at'], rows: [{ id: 1, deleted_at: null }] },
    big: { key: ['id'], rows: rows(30).map(r => ({ ...r, topic: 'u' })) },
  }))
  const flags = flagChanges(base, pr, rules, { trusted: true })
  assert.deepEqual(flags.map(f => [f.collection, f.kind, f.severity, f.pr, f.base]), [
    ['big', 'mass-change', 'red', 30, 0],
    ['cart_items', 'delete', 'amber', 2, 2],
    ['cart_items', 'emptied', 'amber', 1, 1],
    ['doomed', 'dropped', 'red', 1, 0],
    ['messages', 'column-dropped', 'red', 1, 0],
    ['orders', 'delete', 'red', 1, 0],
    ['saved_carts', 'delete', 'red', 3, 0],
    ['saved_carts', 'emptied', 'red', 1, 0],
  ])
  assert.ok(flags.every(f => !('field' in f)))
  // a cleared field is amber at most, and names the field
  const cleared = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, s({ ...seedCollections, messages: { key: ['id'], fields: ['id', 'topic', 'deleted_at'], rows: [{ id: 1, topic: '', deleted_at: null }] } })), rules, { trusted: false })
  assert.deepEqual(cleared.map(f => [f.collection, f.kind, f.severity, f.field, f.pr]), [['messages', 'cleared', 'amber', 'topic', 1]])
  for (const empty of [null, [], {}]) {
    const c = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, s({ ...seedCollections, messages: { key: ['id'], fields: ['id', 'topic', 'deleted_at'], rows: [{ id: 1, topic: empty, deleted_at: null }] } })), rules, { trusted: true })
    assert.deepEqual(c.map(f => f.kind), ['cleared'], JSON.stringify(empty))
  }
  // advisory (the PR pane may reach the base): the base's changes excuse nothing
  const advisory = flagChanges(base, pr, rules, { trusted: false })
  assert.deepEqual(advisory.filter(f => f.collection === 'cart_items').map(f => [f.severity, f.base]), [['red', 2], ['red', 1]])
  // per-collection rules: deletes allowed, a threshold of its own
  const allowed = flagChanges(base, pr, validateRules({ destructive: [{ collection: 'saved_carts', allowDeletes: true }, { collection: 'big', maxChanged: 50 }] }), { trusted: true })
  assert.equal(allowed.some(f => f.collection === 'saved_carts' && f.kind === 'delete'), false)
  assert.equal(allowed.some(f => f.collection === 'saved_carts' && f.kind === 'emptied'), true, 'emptying is still flagged')
  assert.equal(allowed.some(f => f.collection === 'big'), false, '30 of 30 is over 20%, but the rule says up to 50 rows')
})

test('flagChanges: the mass-change thresholds, and a truncated collection\'s fall in count', () => {
  const rows = (n, topic = 't') => Array.from({ length: n }, (_, i) => ({ id: i + 1, topic }))
  const s = (n, changed, total = n) => snap({ c: { key: ['id'], rows: [...rows(changed, 'u'), ...rows(n).slice(changed)].slice(0, total) } })
  const massOf = (n, changed) => flagChanges(diffSnapshots(s(n, 0), s(n, 0)), diffSnapshots(s(n, 0), s(n, changed)), validateRules({}), { trusted: true }).filter(f => f.kind === 'mass-change')
  assert.equal(massOf(100, 20).length, 0, '20 rows of 100: not over either threshold')
  assert.equal(massOf(200, 21).length, 1, 'over 20 rows')
  assert.equal(massOf(10, 2).length, 0, '20% of 10 rows: not over')
  assert.equal(massOf(10, 3).length, 1, 'over 20% of 10 rows')
  assert.equal(massOf(4, 4).length, 0, 'a collection of fewer than 5 rows: only the 20-row threshold')
  const big = (count) => snap({ big: { key: ['id'], rows: [{ id: 1 }], count, truncated: true } })
  const fall = flagChanges(diffSnapshots(big(500), big(500)), diffSnapshots(big(500), big(470)), validateRules({}), { trusted: true })
  assert.deepEqual(fall.map(f => [f.kind, f.pr]), [['delete', 30], ['mass-change', 30]])
})

test('trustOf: only an isolated session\'s base pane can excuse a PR change', () => {
  assert.equal(trustOf({ verdict: 'isolated', reasons: [] }), 'trusted')
  for (const v of [{ verdict: 'unknown' }, { verdict: 'reachable' }, { verdict: 'shared-host' }, { verdict: 'ISOLATED' }, null, undefined, 'isolated']) {
    assert.equal(trustOf(v), 'advisory', JSON.stringify(v))
  }
})
