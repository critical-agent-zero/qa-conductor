// The data checks' pure engine (lib/data-diff.mjs): what a pane's snapshot
// keeps (and masks), what changed between two snapshots of a pane, how the
// PR pane's changes differ from the base pane's, and which of them are
// destructive. No I/O: the conductor takes the snapshots through the
// Provisioner-side inspector and keeps them in memory.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIMITS, SECRET_NAME, createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, trustOf, validateRules,
} from '../lib/data-diff.mjs'

const KEY = Buffer.alloc(32, 7)
const masker = (rules = {}) => createMasker({ key: KEY, rules: validateRules(rules) })
const snap = (collections, rules = {}, limits) => sanitizeSnapshot({ collections }, { masker: masker(rules), rules: validateRules(rules), limits })

test('the limits and the secret-like names', () => {
  assert.deepEqual(LIMITS, { maxRows: 10_000, maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000 })
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
  assert.equal(ok.volatile[0].mode, 'ignore')
  for (const [bad, re] of [
    [{ exclude: 'x' }, /exclude must be an array of collection names/],
    [{ exclude: [7] }, /exclude must be an array of collection names/],
    [{ volatile: [{ collection: 'x' }] }, /volatile\[0\]\.fields must be an array of field names/],
    [{ volatile: [{ collection: 'x', fields: ['a'], mode: 'drop' }] }, /volatile\[0\]\.mode must be ignore or presence/],
    [{ classify: [{ collection: 'x', fields: ['a'], as: 'public' }] }, /classify\[0\]\.as must be secret or pii/],
    [{ softDelete: [{ collection: 'x' }] }, /softDelete\[0\]\.field must be a field name/],
    [{ destructive: [{ collection: 'x', maxChanged: -1 }] }, /destructive\[0\]\.maxChanged must be a non-negative integer/],
    [{ keyOf: () => 'x' }, /unknown data rule: keyOf/],
    ['rules', /rules must be an object/],
  ]) assert.throws(() => validateRules(bad), re, JSON.stringify(bad))
})

test('sanitizeSnapshot masks secret-like and classified fields, fingerprints pii, cuts long values, and drops excluded collections', () => {
  const rules = { exclude: ['schema_*'], classify: [{ collection: 'users', fields: ['email'], as: 'pii' }, { collection: 'users', fields: ['note'], as: 'secret' }] }
  const out = snap({
    users: {
      key: ['id'], fields: ['id', 'email', 'password_hash', 'note', 'bio', 'prefs', 'score'],
      rows: [{ id: 1, email: 'jane@example.org', password_hash: '$2b$10$abc', note: 'SECRET note', bio: 'x'.repeat(300), prefs: { a: 1 }, score: Infinity }],
      count: 1,
    },
    schema_migrations: { key: null, rows: [{ v: 1 }] },
  }, rules)
  assert.deepEqual(Object.keys(out.collections), ['users'])
  const [row] = out.collections.users.rows
  assert.equal(row.id, 1)
  assert.deepEqual(Object.keys(row.email).sort(), ['fp', 'len', 't', 'type'])
  assert.deepEqual([row.email.t, row.email.type, row.email.len], ['pii', 'string', 16])
  assert.match(row.email.fp, /^[0-9a-f]{8}$/)
  assert.deepEqual(Object.keys(row.password_hash), ['t', 'd'])
  assert.equal(row.password_hash.t, 'secret')
  assert.equal(row.note.t, 'secret')
  assert.deepEqual([row.bio.t, row.bio.s.length, row.bio.len], ['long', 200, 300])
  assert.deepEqual(row.prefs, { t: 'json', s: '{"a":1}' })
  assert.equal(row.score, null)
  assert.doesNotMatch(JSON.stringify(out), /jane|example|\$2b|SECRET note/)
  // the same value fingerprints the same, under the same key only
  const again = snap({ users: { key: ['id'], rows: [{ id: 2, email: 'jane@example.org' }] } }, rules)
  assert.equal(again.collections.users.rows[0].email.fp, row.email.fp)
  const other = sanitizeSnapshot({ collections: { users: { key: ['id'], rows: [{ id: 2, email: 'jane@example.org' }] } } }, { masker: createMasker({ key: Buffer.alloc(32, 8), rules: validateRules(rules) }), rules: validateRules(rules) })
  assert.notEqual(other.collections.users.rows[0].email.fp, row.email.fp)
})

test('sanitizeSnapshot keeps at most maxRows a collection, counts what it was given, and says what it refused', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: i }))
  const out = snap({ big: { key: ['id'], rows }, told: { key: ['id'], rows: rows.slice(0, 3), count: 900, truncated: true } }, {}, { maxRows: 10 })
  assert.deepEqual([out.collections.big.rows.length, out.collections.big.count, out.collections.big.truncated], [10, 12, true])
  assert.deepEqual([out.collections.told.count, out.collections.told.truncated], [900, true])
  // anything that isn't a snapshot is an empty one, with a problem
  for (const bad of [null, 'x', { collections: [] }, { collections: { a: { rows: 'x' } } }]) {
    const s = sanitizeSnapshot(bad, { masker: masker(), rules: validateRules({}) })
    assert.ok(s.problems.length > 0, JSON.stringify(bad))
  }
  // a key that names a field its rows don't all have can't be trusted: no key
  const nokey = snap({ c: { key: ['id'], rows: [{ id: 1 }, { other: 2 }] } })
  assert.equal(nokey.collections.c.key, null)
})

const users = (rows, extra = {}) => ({ key: ['id'], fields: ['id', 'name', 'topic', 'updated_at'], rows, ...extra })

test('diffSnapshots: inserted, updated field by field, and deleted rows, by key; volatile fields never count', () => {
  const rules = { volatile: [{ collection: '*', fields: ['updated_at'] }] }
  const before = snap({ users: users([{ id: 1, name: 'a', topic: 'billing', updated_at: 1 }, { id: 2, name: 'b', topic: 'x', updated_at: 1 }]) }, rules)
  const after = snap({ users: users([{ id: 1, name: 'a', topic: '', updated_at: 2 }, { id: 3, name: 'c', topic: 'y', updated_at: 2 }]) }, rules)
  const d = diffSnapshots(before, after)
  const u = d.collections.users
  assert.deepEqual([u.status, u.countBefore, u.countAfter], ['changed', 2, 2])
  assert.deepEqual(u.inserted.map(r => r.key), ['[3]'])
  assert.deepEqual(u.deleted.map(r => r.key), ['[2]'])
  assert.deepEqual(u.updated, [{ key: '[1]', fields: [{ field: 'topic', before: 'billing', after: '' }] }])
  // nothing changed but the volatile field: same
  const same = diffSnapshots(before, snap({ users: users([{ id: 1, name: 'a', topic: 'billing', updated_at: 9 }, { id: 2, name: 'b', topic: 'x', updated_at: 9 }]) }, rules))
  assert.equal(same.collections.users.status, 'same')
})

test('diffSnapshots: presence-only volatile fields count only when set or cleared; unkeyed collections diff as multisets', () => {
  const rules = { volatile: [{ collection: 'sessions', fields: ['token_expires'], mode: 'presence' }] }
  const s = rows => snap({ sessions: { key: ['id'], rows } }, rules)
  const changedOnly = diffSnapshots(s([{ id: 1, token_expires: 10 }]), s([{ id: 1, token_expires: 20 }]))
  assert.equal(changedOnly.collections.sessions.status, 'same')
  const cleared = diffSnapshots(s([{ id: 1, token_expires: 10 }]), s([{ id: 1, token_expires: null }]))
  assert.deepEqual(cleared.collections.sessions.updated, [{ key: '[1]', fields: [{ field: 'token_expires', before: true, after: false }] }])

  const bag = rows => snap({ log: { key: null, rows } })
  const m = diffSnapshots(bag([{ a: 1 }, { a: 1 }, { a: 2 }]), bag([{ a: 1 }, { a: 3 }]))
  assert.deepEqual([m.collections.log.inserted.length, m.collections.log.deleted.length, m.collections.log.updated.length], [1, 2, 0])
})

test('diffSnapshots: a truncated collection reports only its count; added and dropped collections and dropped fields are named', () => {
  const big = (count, extra) => snap({ big: { key: ['id'], rows: [{ id: 1 }], count, truncated: true, ...extra } })
  const t = diffSnapshots(big(500), big(480)).collections.big
  assert.deepEqual([t.status, t.truncated, t.inserted, t.deleted, t.countBefore, t.countAfter], ['changed', true, [], [], 500, 480])
  const before = snap({ a: { key: ['id'], fields: ['id', 'x'], rows: [{ id: 1, x: 1 }] }, gone: { key: ['id'], rows: [{ id: 1 }] } })
  const after = snap({ a: { key: ['id'], fields: ['id'], rows: [{ id: 1 }] }, fresh: { key: ['id'], rows: [] } })
  const d = diffSnapshots(before, after).collections
  assert.equal(d.gone.status, 'dropped')
  assert.equal(d.fresh.status, 'added')
  assert.deepEqual(d.a.fieldsDropped, ['x'])
})

// Base and PR start from one seed and get the same mirrored actions: where
// their changes differ is where the PR's data behaviour departs from base's.
test('divergence: by key, each change is in both, the PR only, the base only, or differs; inserts without a key by count', () => {
  const s = rows => snap({ carts: { key: ['id'], rows } })
  const seed = s([{ id: 1, n: 1 }, { id: 2, n: 1 }, { id: 3, n: 1 }, { id: 4, n: 1 }])
  const base = diffSnapshots(seed, s([{ id: 2, n: 2 }, { id: 3, n: 5 }, { id: 4, n: 1 }]))
  const pr = diffSnapshots(seed, s([{ id: 2, n: 2 }, { id: 3, n: 6 }]))
  const v = divergence(base, pr).collections.carts
  assert.equal(v.status, 'differs')
  assert.deepEqual(v.changes.map(c => [c.kind, c.key, c.status]), [
    ['delete', '[1]', 'both'],
    ['update', '[2]', 'both'],
    ['update', '[3]', 'differs'],
    ['delete', '[4]', 'pr-only'],
  ])
  const only = divergence(diffSnapshots(seed, seed), pr).collections.carts
  assert.equal(only.status, 'pr-only')
  const same = divergence(base, base).collections.carts
  assert.equal(same.status, 'both')
  assert.equal(divergence(diffSnapshots(seed, seed), diffSnapshots(seed, seed)).collections.carts.status, 'same')

  const bag = rows => snap({ log: { key: null, rows } })
  const b0 = bag([])
  const lv = divergence(diffSnapshots(b0, bag([{ a: 1 }])), diffSnapshots(b0, bag([{ a: 1 }, { a: 2 }]))).collections.log
  assert.equal(lv.status, 'differs')
  assert.deepEqual(lv.counts, { base: { inserted: 1, deleted: 0 }, pr: { inserted: 2, deleted: 0 } })
})

test('flagChanges: deletes, emptied and dropped collections, dropped fields, mass changes and cleared fields; red when only the PR did it', () => {
  const rules = validateRules({ softDelete: [{ collection: 'orders', field: 'deleted_at' }] })
  const s = collections => snap(collections, { softDelete: [{ collection: 'orders', field: 'deleted_at' }] })
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, topic: 't', deleted_at: null }))
  const seed = s({
    saved_carts: { key: ['id'], rows: rows(3) },
    cart_items: { key: ['id'], rows: rows(2) },
    orders: { key: ['id'], rows: rows(2) },
    messages: { key: ['id'], fields: ['id', 'topic', 'deleted_at'], rows: rows(1) },
    big: { key: ['id'], rows: rows(30) },
    doomed: { key: ['id'], rows: rows(1) },
  })
  const base = diffSnapshots(seed, s({
    saved_carts: { key: ['id'], rows: rows(3) },
    cart_items: { key: ['id'], rows: [] },
    orders: { key: ['id'], rows: rows(2) },
    messages: { key: ['id'], fields: ['id', 'topic', 'deleted_at'], rows: rows(1) },
    big: { key: ['id'], rows: rows(30) },
    doomed: { key: ['id'], rows: rows(1) },
  }))
  const pr = diffSnapshots(seed, s({
    saved_carts: { key: ['id'], rows: [] },
    cart_items: { key: ['id'], rows: [] },
    orders: { key: ['id'], rows: [{ id: 1, topic: 't', deleted_at: 5 }, { id: 2, topic: 't', deleted_at: null }] },
    messages: { key: ['id'], fields: ['id', 'deleted_at'], rows: [{ id: 1, deleted_at: null }] },
    big: { key: ['id'], rows: rows(30).map(r => ({ ...r, topic: 'u' })) },
  }))
  const flags = flagChanges(base, pr, rules, { trusted: true })
  const got = flags.map(f => [f.collection, f.kind, f.severity, f.pr, f.base])
  assert.deepEqual(got, [
    ['big', 'mass-change', 'red', 30, 0],
    ['cart_items', 'delete', 'amber', 2, 2],
    ['cart_items', 'emptied', 'amber', 1, 1],
    ['doomed', 'dropped', 'red', 1, 0],
    ['messages', 'column-dropped', 'red', 1, 0],
    ['orders', 'delete', 'red', 1, 0],
    ['saved_carts', 'delete', 'red', 3, 0],
    ['saved_carts', 'emptied', 'red', 1, 0],
  ])
  // a cleared field is amber at most
  const cleared = flagChanges(diffSnapshots(seed, seed), diffSnapshots(seed, s({ ...seedRows(), messages: { key: ['id'], fields: ['id', 'topic', 'deleted_at'], rows: [{ id: 1, topic: '', deleted_at: null }] } })), rules, { trusted: true })
  assert.deepEqual(cleared.map(f => [f.collection, f.kind, f.severity, f.field]), [['messages', 'cleared', 'amber', 'topic']])
  // advisory (the PR pane may reach the base): the base's deletes excuse nothing
  const advisory = flagChanges(base, pr, rules, { trusted: false })
  assert.deepEqual(advisory.filter(f => f.collection === 'cart_items').map(f => f.severity), ['red', 'red'])
  // per-collection rules: deletes allowed, a higher threshold
  const allowed = flagChanges(base, pr, validateRules({ destructive: [{ collection: 'saved_carts', allowDeletes: true }, { collection: 'big', maxChanged: 50 }] }), { trusted: true })
  assert.equal(allowed.some(f => f.collection === 'saved_carts' && f.kind === 'delete'), false)
  assert.equal(allowed.some(f => f.collection === 'big'), false, '30 of 30 is over 20%, but the rule says up to 50 rows')

  function seedRows() {
    return {
      saved_carts: { key: ['id'], rows: rows(3) }, cart_items: { key: ['id'], rows: rows(2) }, orders: { key: ['id'], rows: rows(2) },
      big: { key: ['id'], rows: rows(30) }, doomed: { key: ['id'], rows: rows(1) },
    }
  }
})

test('trustOf: only an isolated session\'s base pane can excuse a PR change', () => {
  assert.equal(trustOf({ verdict: 'isolated', reasons: [] }), 'trusted')
  for (const v of [{ verdict: 'unknown' }, { verdict: 'reachable' }, { verdict: 'shared-host' }, null, undefined]) assert.equal(trustOf(v), 'advisory', JSON.stringify(v))
})
