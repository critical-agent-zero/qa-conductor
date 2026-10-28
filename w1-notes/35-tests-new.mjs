
// --- Round 3 of #35's review --------------------------------------------------------

// The review's high: a match could start at every backslash of a run, and
// each read the rest of the run, so 256 KB of backslashes before an '=' took
// 48 s. A match no longer starts inside a run.
test('the key scan is linear in runs of backslashes: 256 KB of them before an = or a quote, and in JSON, take well under a second', () => {
  const cells = {
    eq: '\\'.repeat(256 * 1024 - 1) + '=',
    quote: `${('\\'.repeat(4_096) + '"').repeat(60)}=`,
    pairs: `${'\\a'.repeat(128 * 1024)}=`,
    inJson: JSON.stringify({ msg: `${'\\'.repeat(64 * 1024)}=x` }),
  }
  const started = performance.now()
  const out = snap({ c: { key: ['id'], rows: [{ id: 1, ...cells }] } })
  const took = performance.now() - started
  assert.ok(took < 1_000, `${Math.round(took)} ms`)
  assert.deepEqual(['eq', 'quote', 'pairs', 'inJson'].map(f => out.collections.c.rows[0][f].t), ['long', 'long', 'long', 'json'])
  // a key right after a single backslash still counts, and so does one in
  // escaped or HTML-escaped quotes, or with a space before its ':'
  const keys = {
    newline: 'log line\\npassword=hunter2',
    path: 'C:\\Users\\x\\api_key=abc123',
    escaped: 'x=\\"password\\": 1',
    html: '{&quot;password&quot;: &quot;hunter9&quot;}',
    apos: '&#39;token&#39;: &#39;abc&#39;',
    spaced: 'password : hunter10',
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...keys }] } }).collections.c.rows
  for (const field of Object.keys(keys)) assert.match(row[field], /^\[text with a secret-looking key, \d+ characters, [0-9a-f]{8}\]$/, field)
})

// The review's first medium: 11,000 padding collections pushed users past
// the counts kept in the PR pane's first snapshot, and the click dropped the
// padding and wiped users, which then read as added, with no flag. A
// snapshot now says how many it left out, and a collection missing from one
// that left some out is unknown, so unverified, never added or dropped.
test('a collection a PR snapshot left out reads as unknown, so unverified and red, never added or dropped', () => {
  const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, role: 'member' })) })
  const pad = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`aaa${String(i).padStart(2, '0')}`, people(3)]))
  const limits = { maxCollections: 2 }
  const seed = snap({ users: people(2) }, {}, limits)
  const base = diffSnapshots(seed, seed)
  const s1 = snap({ ...pad, users: people(2) }, {}, limits)
  assert.equal(Object.hasOwn(s1.collections, 'users'), false)
  assert.equal(s1.omitted, 3)
  assert.equal(seed.omitted, 0)
  // the click drops the padding and wipes users, or updates every row
  for (const [what, sn] of [['wiped', snap({ users: people(0) }, {}, limits)], ['updated', snap({ users: { key: ['id'], rows: [1, 2, 3].map(id => ({ id, role: 'admin' })) } }, {}, limits)]]) {
    const pr = diffSnapshots(s1, sn)
    const u = pr.collections.users
    assert.deepEqual([u.status, u.omitted, u.truncated, u.countBefore, u.inserted], ['unknown', 'before', true, null, []], what)
    for (const trusted of [true, false]) {
      const flags = flagChanges(base, pr, none, { trusted })
      assert.deepEqual(flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity, f.shared]), [['unverified', 'red', false]], `${what}, trusted ${trusted}`)
      assert.equal(flags[0].collection, 'users', 'the base pane has it: listed first')
    }
    assert.equal(divergence(base, pr).collections.users.status, 'unknown', what)
  }
  // the other way: users in S1, left out of Sn by padding the click adds
  const kept = snap({ users: people(2) }, {}, limits)
  const out = diffSnapshots(kept, snap({ ...pad, users: people(2) }, {}, limits)).collections.users
  assert.deepEqual([out.status, out.omitted, out.countBefore, out.countAfter], ['unknown', 'after', 2, null])
  // a snapshot that couldn't be read at all left out how many it held
  const unreadable = sanitizeSnapshot({ collections: null }, { masker: masker(), rules: none })
  assert.equal(unreadable.omitted, null)
  assert.deepEqual(diffSnapshots(kept, unreadable).collections.users.status, 'unknown')
  // a collection given but unreadable counts as left out too
  assert.equal(snap({ a: { rows: 'x' }, b: { key: ['id'], rows: [{ id: 1 }] } }).omitted, 1)
})

// The review's second medium: each count-only stub of a collection only the
// PR pane has raised its own red flag, in name order, so 10,000 of them
// buried users' flags in a list cut at 500. They are now one flag, and the
// base pane's collections come first.
test('the unverified flags of collections only the PR pane has are folded into one, after the base pane\'s collections', () => {
  const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, role: 'member' })) })
  const pad = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`aaa${String(i).padStart(2, '0')}`, { key: ['id'], rows: [] }]))
  const limits = { maxCollections: 2 }
  const seed = snap({ users: people(50) }, {}, limits)
  const s1 = snap({ ...pad, users: people(50) }, {}, limits)
  const sn = snap({ ...pad, users: people(1) }, {}, limits)
  for (const trusted of [true, false]) {
    const flags = flagChanges(diffSnapshots(seed, seed), diffSnapshots(s1, sn), none, { trusted })
    assert.deepEqual(flags.map(f => [f.collection, f.kind, f.severity]), [['users', 'delete', 'red'], ['users', 'mass-change', 'red'], [null, 'unverified', 'red']], String(trusted))
    assert.deepEqual([flags[2].collections, flags[2].pr, flags[2].names], [20, 20, ['aaa01', 'aaa02', 'aaa03', 'aaa04', 'aaa05']])
  }
  // the order: red first; the base pane's collections before the PR's own;
  // destructive kinds before unverified and cleared; then by name
  const rules = validateRules({})
  const at = (users, orders, extra) => snap({ users: { key: ['id'], rows: users }, orders: { key: ['id'], rows: orders }, ...extra }, {}, { maxRows: 3 })
  const u = [{ id: 1, note: 'x' }, { id: 2, note: 'y' }]
  const o = [{ id: 1 }, { id: 2 }]
  const before = at(u, o, { aaa_tmp: { key: ['id'], rows: [{ id: 1 }] }, aaa_big: { key: ['id'], rows: [] } })
  const after = at([{ id: 1, note: '' }], [...o, { id: 3 }, { id: 4 }], { aaa_big: { key: ['id'], rows: [1, 2, 3, 4].map(id => ({ id })) } })
  const ordered = flagChanges(diffSnapshots(at(u, o), at(u, o)), diffSnapshots(before, after), rules, { trusted: true })
  assert.deepEqual(ordered.map(f => [f.collection, f.kind, f.severity]), [
    ['users', 'delete', 'red'],
    ['orders', 'unverified', 'red'],
    ['aaa_tmp', 'dropped', 'red'],
    [null, 'unverified', 'red'],
    ['users', 'cleared', 'amber'],
  ])
})

// A low: JSON text encoded twice read the same as plain JSON text, so a
// migration that re-encoded a whole column showed nothing.
test('JSON text encoded twice says so: re-encoding a column is 30 updates and a mass change, and inside JSON it keeps its string form', () => {
  const plainJson = JSON.stringify({ theme: 'dark', n: 1 })
  const s = value => snap({ prefs: { key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, value })) } })
  const seed = s(plainJson)
  const twice = s(JSON.stringify(plainJson))
  assert.deepEqual(twice.collections.prefs.rows[0].value, { t: 'json', s: plainJson, enc: 2 })
  const pr = diffSnapshots(seed, twice)
  assert.equal(pr.collections.prefs.updated.length, 30)
  assert.deepEqual(flagChanges(diffSnapshots(seed, seed), pr, none, { trusted: true }).map(f => [f.kind, f.severity]), [['mass-change', 'red']])
  // nested in JSON: the outer string form is kept, its secrets masked within
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, a: { v: plainJson }, b: { v: JSON.stringify(plainJson) }, c: { v: JSON.stringify(JSON.stringify({ password: 'hunter11' })) } }] } }).collections.c.rows
  assert.notEqual(row.a.s, row.b.s)
  assert.doesNotMatch(JSON.stringify(row), /hunter11/)
  assert.match(row.c.s, /\[secret [0-9a-f]{8}\]/)
})

// A low: value masking missed common forms, and masked prose after "Basic".
test('more values masked: URLs with an empty user, an @ in the password or a token alone, any-case schemes, Name/Value pairs, XML with a namespace or attributes', () => {
  const values = {
    redis: 'redis://:redis-pw-9@cache:6379/0',
    at: 'postgres://app:p@ss-word-9@db/app',
    token: 'https://ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA@github.com/o/r.git',
    lower: 'sent bearer abcdefghij123456 then',
    upper: 'sent BEARER abcdefghij123457 then',
    basic: 'header Basic dXNlcjpwYXNzd29yZDE= ok',
    tok: 'with Token tk_live_00000000ab here',
    aws: [{ Name: 'db-password', Value: 'aws-secret-1' }, { Key: 'api_token', Value: 'aws-secret-2' }],
    kv: { k: 'password', v: 'kv-secret-3' },
    field: { field: 'client_secret', val: 'kv-secret-4' },
    wsse: '<wsse:Password Type="PasswordText">soap-secret-5</wsse:Password>',
    attr: '<password type="text">soap-secret-6</password>',
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...values }] } }).collections.c.rows
  assert.doesNotMatch(JSON.stringify(row), /redis-pw|ss-word|ghp_A|abcdefghij|dXNlcjpw|tk_live|aws-secret|kv-secret|soap-secret/)
  assert.match(row.redis, /^redis:\/\/:\[secret [0-9a-f]{8}\]@cache:6379\/0$/)
  assert.match(row.at, /^postgres:\/\/app:\[secret [0-9a-f]{8}\]@db\/app$/)
  assert.match(row.token, /^https:\/\/\[secret [0-9a-f]{8}\]@github\.com\/o\/r\.git$/)
  assert.match(row.lower, /^sent bearer \[secret [0-9a-f]{8}\] then$/)
  assert.match(row.basic, /^header Basic \[secret [0-9a-f]{8}\] ok$/)
  // prose after a scheme's name, and a short user alone, are left be
  const [prose] = snap({ c: { key: ['id'], rows: [{ id: 1, a: 'Basic introduction to the topic', b: 'Token expired again', c: 'ssh://git@github.com/o/r.git' }] } }).collections.c.rows
  assert.deepEqual([prose.a, prose.b, prose.c], ['Basic introduction to the topic', 'Token expired again', 'ssh://git@github.com/o/r.git'])
})

// A low: field names were cached however long, so 16 KB names grew the
// cache by 16 MB a snapshot.
test('the masker never caches a name over 128 characters', () => {
  const m = masker()
  for (let i = 0; i < 1_000; i++) assert.equal(m.cell('c', `${'f'.repeat(16 * 1024)}${i}`, 'v'), 'v')
  assert.equal(m.cachedFields(), 0)
  m.cell('c', 'f'.repeat(128), 'v')
  assert.equal(m.cachedFields(), 1)
  const before = m.cached()
  assert.equal(m.cell('c'.repeat(129), 'password', 'x').t, 'secret', 'worked out all the same')
  assert.equal(m.cached(), before)
})

// #36's review: a collection's name, key and declared fields were never
// charged to any budget. They are capped, and charged to its bytes.
test('long names are left out; a key of more than 32 fields, more than 2,000 declared fields, or a key and fields over the share of bytes are cut, said so', () => {
  const long = 'n'.repeat(201)
  const out = snap({ [long]: { key: ['id'], rows: [{ id: 1 }] }, ['m'.repeat(200)]: { key: ['id'], rows: [{ id: 1 }] } })
  assert.deepEqual([Object.keys(out.collections), out.omitted, out.problems], [['m'.repeat(200)], 1, ['1 collection with a name over 200 characters was left out']])
  const wide = n => Array.from({ length: n }, (_, i) => `f${i}`)
  const row = Object.fromEntries(wide(33).map(f => [f, 1]))
  const k = snap({ k32: { key: wide(32), rows: [row] }, k33: { key: wide(33), rows: [row] } })
  assert.deepEqual([k.collections.k32.key.length, k.collections.k33.key], [32, null])
  assert.deepEqual(k.problems, ['k33: a key of 33 fields is more than 32, so its rows are compared without one'])
  const f = snap({ ok: { key: ['f0'], fields: wide(2_000), rows: [row] }, over: { key: ['f0'], fields: wide(2_001), rows: [row], count: 1 } })
  assert.equal(f.collections.ok.fields.length, 2_000)
  assert.deepEqual(f.collections.over, { key: null, fields: null, rows: [], count: 1, truncated: true })
  assert.deepEqual(f.problems, ['over: 2001 declared fields are more than 2000, so it is kept as its count'])
  const tight = snap({ t: { key: ['id'], fields: wide(100), rows: [{ id: 1 }] } }, {}, { maxBytes: 200 })
  assert.deepEqual([tight.collections.t.truncated, tight.collections.t.fields, tight.problems], [true, null, ['t: its key and declared fields don\'t fit its share of the bytes, so it is kept as its count']])
})

// Mutants round 3 let live.
test('a count-only collection keeps the inspector\'s count; a cut-short collection the PR dropped is no unverified; counts that start apart aren\'t shared', () => {
  const many = sanitizeSnapshot({ collections: { a: { key: null, rows: Array(5).fill({ v: 1 }) }, b: { key: null, rows: [{ v: 1 }, { v: 2 }], count: 1_000_000 } } }, { masker: masker(), rules: none, limits: { maxCollections: 1 } })
  assert.deepEqual(many.collections.b, { key: null, fields: null, rows: [], count: 1_000_000, truncated: true })
  const big = count => snap({ big: { key: ['id'], rows: [{ id: 1 }], count, truncated: true } })
  const gone = flagChanges(diffSnapshots(big(500), big(500)), diffSnapshots(big(500), snap({})), none, { trusted: true })
  assert.deepEqual(gone.map(f => [f.kind, f.severity]), [['dropped', 'red']])
  const apart = flagChanges(diffSnapshots(big(100), big(90)), diffSnapshots(big(200), big(90)), none, { trusted: true }).find(f => f.kind === 'unverified')
  assert.deepEqual([apart.severity, apart.shared], ['red', false])
})

test('comparing two wide declared field lists is linear in diffSnapshots too: 50 tables of 2,000 columns, one apart, in well under a second', () => {
  const cols = tag => ['id', ...Array.from({ length: 1_999 }, (_, i) => `column_with_a_rather_long_name_${String(i).padStart(4, '0')}${i === 1_998 ? tag : ''}`)]
  const at = tag => snap(Object.fromEntries(Array.from({ length: 50 }, (_, t) => [`t${t}`, { key: ['id'], fields: cols(tag), rows: [{ id: 1 }] }])))
  const a = at('a')
  const b = at('b')
  const started = performance.now()
  const d = diffSnapshots(a, b)
  const took = performance.now() - started
  assert.ok(took < 500, `${Math.round(took)} ms`)
  assert.deepEqual([d.collections.t0.fieldsDropped.length, d.collections.t0.fieldsAdded.length], [1, 1])
})
