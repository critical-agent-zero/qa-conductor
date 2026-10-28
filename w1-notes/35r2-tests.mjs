
// --- Round 2 of #35's review --------------------------------------------------------

// The review's case: a PR's migration adds 1,000 one-row collections that
// sort first. The collections past maxCollections are now chosen by rows,
// most first, and kept as counts, never left out unsaid.
test('padding collections can\'t push a collection out of the PR\'s snapshots: the biggest are kept, the rest as counts, and a wipe still shows', () => {
  const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `p${i}` })) })
  const pad = rowsEach => Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`aaa${String(i).padStart(4, '0')}`, people(rowsEach)]))
  const seed = snap({ users: people(50) })
  const base = diffSnapshots(seed, seed)
  // one-row padding: users, the biggest, is kept whole
  const s1 = snap({ ...pad(1), users: people(50) })
  assert.deepEqual([s1.collections.users.truncated, s1.collections.users.rows.length], [false, 50])
  const sn = snap({ ...pad(1), users: people(0) })
  const wiped = flagChanges(diffSnapshots(seed, seed), diffSnapshots(s1, sn), none, { trusted: true }).filter(f => f.collection === 'users')
  assert.deepEqual(wiped.map(f => [f.kind, f.severity]), [['delete', 'red'], ['emptied', 'red'], ['mass-change', 'red']])
  assert.match(s1.problems[0], /^1 collections past the first 1000 by rows are kept as counts only: aaa\d{4}$/)

  // padding bigger than users: users is kept as its count, and a wipe is
  // still red, with nothing excused
  const t1 = snap({ ...pad(2), users: people(1) })
  assert.deepEqual(t1.collections.users, { key: null, fields: null, rows: [], count: 1, truncated: true })
  const tn = snap({ ...pad(2), users: people(0) })
  const pr = diffSnapshots(t1, tn)
  for (const trusted of [true, false]) {
    const flags = flagChanges(base, pr, none, { trusted }).filter(f => f.collection === 'users')
    assert.deepEqual(flags.map(f => [f.kind, f.severity]), [['delete', 'red'], ['emptied', 'red'], ['unverified', 'red']], String(trusted))
  }
  // even unchanged, a collection the PR pane keeps as a count alone is unverified
  assert.deepEqual(flagChanges(base, diffSnapshots(t1, t1), none, { trusted: true }).map(f => [f.collection, f.kind, f.severity]), [['users', 'unverified', 'red']])
})

// Past the counts kept too, a collection is left out, said so. Then the
// PR pane's diff lacks a collection the base pane's has: unverified, and
// divergence can't say `same`.
test('a collection the PR pane\'s diff lacks while the base pane\'s has it is unverified, and divergence says unknown', () => {
  const many = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${String(i).padStart(2, '0')}`, { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }]))
  const limits = { maxCollections: 2 }
  const seed = snap({ users: { key: ['id'], rows: [{ id: 1 }] } }, {}, limits)
  const padded = snap({ ...many(25), users: { key: ['id'], rows: [{ id: 1 }] } }, {}, limits)
  assert.equal(Object.hasOwn(padded.collections, 'users'), false)
  assert.deepEqual(padded.problems, [
    '20 collections past the first 2 by rows are kept as counts only: c02, c03, c04, c05, c06 and 15 more',
    '4 collections past those were left out: c22, c23, c24 and users',
  ])
  const base = diffSnapshots(seed, seed)
  const pr = diffSnapshots(padded, padded)
  for (const trusted of [true, false]) {
    const flags = flagChanges(base, pr, none, { trusted }).filter(f => f.collection === 'users')
    assert.deepEqual(flags.map(f => [f.kind, f.severity, f.shared]), [['unverified', 'red', false]], String(trusted))
  }
  assert.equal(divergence(base, pr).collections.users.status, 'unknown')
  // the other way about, a collection the PR added: the PR's own
  const added = diffSnapshots(seed, snap({ users: { key: ['id'], rows: [{ id: 1 }] }, extra: { key: ['id'], rows: [{ id: 1 }] } }, {}, limits))
  assert.equal(divergence(base, added).collections.extra.status, 'pr-only')
})

// A regression the round-1 fix made: a Set or Map is set when it has
// entries, so one in a secret-looking, classify-secret or pii field is
// masked like any other value.
test('a Set or Map with entries is set: in a secret or pii field it is masked, and an empty one is kept as it is', () => {
  const rules = { classify: [{ collection: 'c', fields: ['vault'], as: 'secret' }, { collection: 'c', fields: ['emails'], as: 'pii' }] }
  const [row] = snap({
    c: {
      key: ['id'],
      rows: [{
        id: 1, recovery_codes: new Set(['RC-1111', 'RC-2222']), vault: new Map([['k', 'vault-secret']]), emails: new Set(['jane@example.org']), empty: new Set(), tokens: new Map(),
      }],
    },
  }, rules).collections.c.rows
  assert.doesNotMatch(JSON.stringify(row), /RC-1111|vault-secret|jane@example/)
  assert.deepEqual([row.recovery_codes.t, row.vault.t, row.emails.t, row.emails.type], ['secret', 'secret', 'pii', 'object'])
  assert.deepEqual([row.empty, row.tokens], [{ t: 'json', s: '[]' }, { t: 'json', s: '[]' }])
  // the entries decide the digest: another code is another digest
  const again = snap({ c: { key: ['id'], rows: [{ id: 1, recovery_codes: new Set(['RC-1111', 'RC-3333']) }] } }, rules).collections.c.rows[0]
  assert.notEqual(again.recovery_codes.d, row.recovery_codes.d)
})

// The text scan is linear: a secret-looking key is looked for at word
// starts only, in text that has a ':' or '=', and in its first 256 KB, which
// is far past the 200 characters a cell shows.
test('scanning text for secret-looking keys is linear: 20 MB of text is read in well under a second', () => {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(400_000) // ~22 MB, no ':' or '='
  const bare = 'x'.repeat(20 * 1024 * 1024) // one word, no ':' or '='
  const keyish = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1 '.repeat(300_000) + 'k=v' // long words, then an '='
  const ndjson = Array.from({ length: 1_000 }, (_, i) => `{"n":${i},"msg":"${'m'.repeat(200)}"}`).join('\n')
  const started = performance.now()
  const out = snap({ c: { key: ['id'], rows: [{ id: 1, a: words, b: bare, c: keyish }, ...Array.from({ length: 50 }, (_, i) => ({ id: i + 2, log: ndjson }))] } })
  const took = performance.now() - started
  assert.ok(took < 3_000, `${Math.round(took)} ms`)
  assert.equal(out.collections.c.rows[0].a.t, 'long')
})

// Keys written with escaped quotes, double-encoded JSON, form parameters
// and XML are found too.
test('text masking finds keys in escaped quotes, double-encoded JSON, brackets and XML', () => {
  const cases = {
    escaped: 'level=info body="{\\"password\\":\\"hunter2\\"}"',
    double: JSON.stringify(JSON.stringify({ password: 'hunter3', user: 'a' })),
    form: 'user[name]=a&user[password]=hunter4',
    xml: '<login><user>a</user><password>hunter5</password></login>',
    single: "{'api_key': 'sk-live-CCC'}",
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...cases }] } }).collections.c.rows
  assert.doesNotMatch(JSON.stringify(row), /hunter|sk-live/)
  // double-encoded JSON is read as the JSON it holds
  assert.match(row.double.s, /^\{"password":"\[secret [0-9a-f]{8}\]","user":"a"\}$/)
  for (const field of ['escaped', 'form', 'xml', 'single']) assert.match(row[field], /^\[text with a secret-looking key, \d+ characters, [0-9a-f]{8}\]$/, field)
  // `key=` text needs a secret-looking key, at a word's start
  const [plainRow] = snap({ c: { key: ['id'], rows: [{ id: 1, a: 'token=abc', b: 'mytoken=abc', c: 'topic=abc', d: 'no keys here' }] } }).collections.c.rows
  assert.match(plainRow.a, /^\[text with a secret-looking key/)
  assert.match(plainRow.b, /^\[text with a secret-looking key/)
  assert.deepEqual([plainRow.c, plainRow.d], ['topic=abc', 'no keys here'])
})

// The masker's memory is bounded in all, not per collection.
test('the masker remembers at most 50,000 fields in all', () => {
  const m = masker()
  for (let c = 0; c < 1_000; c++) for (let f = 0; f < 100; f++) m.cell(`c${c}`, `field_${f}_${c}`, 'v')
  assert.ok(m.cachedFields() <= 50_000, String(m.cachedFields()))
  assert.ok(m.cached() <= 1_000)
  // what it can't remember it still works out
  assert.equal(m.cell('c999', 'password_new', 'x').t, 'secret')
})

test('more secrets: names, URL credentials, Bearer values, name and value pairs, and raw header lists', () => {
  for (const name of ['ssh_key', 'sshKey', 'redis_url', 'REDIS_URL', 'backup_codes', 'backup_code', 'amqp_url', 'postgres_url', 'signing-key', 'client-key', 'pin', 'user-pin']) {
    assert.match(name, SECRET_NAME, name)
  }
  for (const name of ['spinner', 'pinned', 'url', 'site_url', 'backup']) assert.doesNotMatch(name, SECRET_NAME, name)
  const [row] = snap({
    c: {
      key: ['id'],
      rows: [{
        id: 1,
        dsn_like: 'postgres://app:pw-hunter6@db.internal:5432/app',
        note: 'curl -H "Authorization: x" then Bearer eyJhbGciOiJIUzI1NiJ9abcdef',
        har: { headers: [{ name: 'Authorization', value: 'Bearer sk-live-DDD' }, { name: 'Accept', value: 'text/html' }] },
        kv: [{ key: 'api_key', value: 'sk-live-EEE' }],
        raw: { rawHeaders: ['Host', 'example.org', 'Cookie', 'sid=s3cr3t'] },
      }],
    },
  }).collections.c.rows
  const text = JSON.stringify(row)
  assert.doesNotMatch(text, /pw-hunter6|eyJhbGciOiJIUzI1NiJ9abcdef|sk-live|s3cr3t/)
  assert.match(row.dsn_like, /^postgres:\/\/app:\[secret [0-9a-f]{8}\]@db\.internal:5432\/app$/)
  assert.match(row.har.s, /"text\/html"/, 'a pair whose name isn\'t secret-looking is kept')
  assert.match(row.raw.s, /"Host","example\.org","Cookie","\[secret [0-9a-f]{8}\]"/)
})

// The same fields changed to other values are another change: the base
// setting role to editor doesn't excuse the PR setting it to admin.
test('a mass change of the same field to other values is not the base\'s', () => {
  const s = role => snap({ c: { key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, role })) } })
  const seed = s('member')
  const other = flagChanges(diffSnapshots(seed, s('editor')), diffSnapshots(seed, s('admin')), none, { trusted: true })
  assert.deepEqual(other.map(f => [f.kind, f.severity, f.shared]), [['mass-change', 'red', false]])
  const same = flagChanges(diffSnapshots(seed, s('admin')), diffSnapshots(seed, s('admin')), none, { trusted: true })
  assert.deepEqual(same.map(f => [f.kind, f.severity, f.shared]), [['mass-change', 'amber', true]])
})

// Cut short in both panes with no change in count: nothing can be seen,
// which the flags say, amber.
test('a collection cut short in both panes with its count unchanged is listed as unverified, amber; with its count changed alike, red unless trusted', () => {
  const big = count => snap({ big: { key: ['id'], rows: [{ id: 1 }], count, truncated: true } })
  for (const trusted of [true, false]) {
    assert.deepEqual(flagChanges(diffSnapshots(big(500), big(500)), diffSnapshots(big(500), big(500)), none, { trusted }).map(f => [f.kind, f.severity, f.shared]), [['unverified', 'amber', true]], String(trusted))
  }
  const fell = flagChanges(diffSnapshots(big(500), big(490)), diffSnapshots(big(500), big(490)), none, { trusted: false })
  assert.deepEqual(fell.map(f => [f.kind, f.severity, f.shared]), [['delete', 'red', true], ['unverified', 'red', true]], 'untrusted: nothing excused')
})

// Mutants the round-1 tests let live.
test('the byte budget is shared out as it is used, so the total stays within maxBytes', () => {
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, v: 'x'.repeat(50) }))
  const collections = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`t${i}`, { key: ['id'], rows: rows(100 + i) }]))
  const out = snap(collections, {}, { maxBytes: 20_000 })
  const total = Object.values(out.collections).reduce((n, c) => n + c.rows.reduce((m, r) => m + Buffer.byteLength(JSON.stringify(r)), 0), 0)
  assert.ok(total <= 20_000, String(total))
})

test('nested secrets under different keys in one field get different digests; the same pii fingerprints alike under different field names', () => {
  const s = snap({
    users: { key: ['id'], rows: [{ id: 1, x: { token: 'same', secret: 'same' }, email: 'jo@example.org' }] },
    orders: { key: ['id'], rows: [{ id: 1, customer_email: 'jo@example.org' }] },
  }, { classify: [{ collection: 'users', fields: ['email'], as: 'pii' }, { collection: 'orders', fields: ['customer_email'], as: 'pii' }] })
  const digests = [...s.collections.users.rows[0].x.s.matchAll(/\[secret ([0-9a-f]{8})\]/g)].map(m => m[1])
  assert.equal(new Set(digests).size, 2)
  assert.equal(s.collections.users.rows[0].email.fp, s.collections.orders.rows[0].customer_email.fp)
})
