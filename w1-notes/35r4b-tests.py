R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-diff.test.mjs'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit(P, [
    ("""  assert.deepEqual(LIMITS, { maxRows: 10_000, maxBytes: 32 * 1024 * 1024, maxCells: 500_000, maxCollections: 1_000, timeoutMs: 30_000 })
  assert.ok(Object.isFrozen(LIMITS))
  for (const name of ['password', 'pass_hash', 'apiKey', 'api_key', 'client_secret', 'reset_token', 'otp', 'salt', 'private_key', 'session_id', 'card_number', 'ssn', 'iban']) {
    assert.match(name, SECRET_NAME, name)
  }
  for (const name of ['email', 'name', 'id', 'quantity', 'topic']) assert.doesNotMatch(name, SECRET_NAME, name)""",
     """  assert.deepEqual(LIMITS, { maxRows: 10_000, maxBytes: 32 * 1024 * 1024, maxCollections: 1_000, timeoutMs: 30_000 })
  assert.ok(Object.isFrozen(LIMITS))
  for (const name of ['password', 'pass_hash', 'apiKey', 'api_key', 'client_secret', 'reset_token', 'otp', 'salt', 'private_key', 'session_id', 'card_number', 'ssn', 'iban', 'pw', 'user_pw', 'wifi-psk', 'auth', '_auth']) {
    assert.match(name, SECRET_NAME, name)
  }
  for (const name of ['email', 'name', 'id', 'quantity', 'topic', 'author', 'auth_provider', 'pwr', 'key']) assert.doesNotMatch(name, SECRET_NAME, name)"""),
    ("""  assert.deepEqual(flags.filter(f => 'field' in f).map(f => [f.kind, f.field]), [['column-dropped', 'topic']])""",
     """  // a collection's dropped columns are one flag, with their number and the first five
  assert.deepEqual(flags.filter(f => f.kind === 'column-dropped').map(f => [f.count, f.fields, 'field' in f]), [[1, ['topic'], false]])"""),
    ("""  // a dropped column, per field
  const cols = fields => snap({ users: { key: ['id'], fields, rows: [{ id: 1 }] } })
  const c0 = cols(['id', 'email', 'legacy'])
  const dropped = flagChanges(diffSnapshots(c0, cols(['id', 'email'])), diffSnapshots(c0, cols(['id'])), none, { trusted: true })
  assert.deepEqual(dropped.map(f => [f.kind, f.field, f.severity]), [['column-dropped', 'email', 'red'], ['column-dropped', 'legacy', 'amber']])""",
     """  // dropped columns, one flag a collection: shared only when the base
  // dropped every one of them
  const cols = fields => snap({ users: { key: ['id'], fields, rows: [{ id: 1 }] } })
  const c0 = cols(['id', 'email', 'legacy'])
  const dropped = flagChanges(diffSnapshots(c0, cols(['id', 'email'])), diffSnapshots(c0, cols(['id'])), none, { trusted: true })
  assert.deepEqual(dropped.map(f => [f.kind, f.fields, f.count, f.severity, f.base]), [['column-dropped', ['email', 'legacy'], 2, 'red', 1]])
  const alike = flagChanges(diffSnapshots(c0, cols(['id'])), diffSnapshots(c0, cols(['id'])), none, { trusted: true })
  assert.deepEqual(alike.map(f => [f.kind, f.severity]), [['column-dropped', 'amber']])"""),
    ("""  assert.equal(flags.filter(f => f.kind === 'column-dropped').length, 50 * 1_600)""",
     """  assert.deepEqual(flags.filter(f => f.kind === 'column-dropped').map(f => f.count), Array(50).fill(1_600))"""),
    ("""  assert.deepEqual([Object.keys(out.collections), out.omitted, out.problems], [['m'.repeat(200)], 1, ['1 collection with a name over 200 characters was left out']])""",
     """  // left out, said so, and not counted in `omitted`: no name the diff sees
  // can be one of them
  assert.deepEqual([Object.keys(out.collections), out.omitted, out.problems], [['m'.repeat(200)], 0, ['1 collection with a name over 200 characters was left out']])"""),
])

# W28=B: no maxCells
s = open(R + P).read()
start = s.index("""// --- For #36's round 4 --------------------------------------------------------------

// The work is bounded: masking, diffing and flagging take time in proportion""")
end = s.index("""// #36's review: flagChanges merged each cleared field's items with a spread""")
s = s[:start] + """// --- For #36's round 4 --------------------------------------------------------------

""" + s[end:]
a = """  assert.equal(flags.filter(f => f.kind === 'column-dropped').length, 600)
  assert.deepEqual([flags[0].collection, flags[0].kind], ['users', 'delete'])"""
b = """  assert.deepEqual(flags.filter(f => f.kind === 'column-dropped').map(f => f.count), Array(20).fill(30))
  assert.deepEqual([flags[0].collection, flags[0].kind], ['users', 'delete'])"""
assert s.count(a) == 1
s = s.replace(a, b)

s += r"""
// --- Round 4 of #35's review --------------------------------------------------------

// The review's high: a tag's attributes read across the next '<', so text
// dense with `<a ` backtracked about 256 characters at every '<' (110 ms a
// 256 KB cell). They stop at the next '<' now.
test('the tag scan is linear in text dense with tags: 256 KB of `<a ` and of `<a:a ` take well under a second', () => {
  const cells = { a: '<a '.repeat(87_000), ns: '<a:a '.repeat(52_000), attrs: '<a b="1" '.repeat(29_000) }
  const started = performance.now()
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...cells }] } }).collections.c.rows
  const took = performance.now() - started
  assert.ok(took < 1_000, `${Math.round(took)} ms`)
  assert.deepEqual(Object.keys(cells).map(f => row[f].t), ['long', 'long', 'long'])
  // tags with a namespace or attributes are still read
  const [tags] = snap({ c: { key: ['id'], rows: [{ id: 1, a: '<wsse:Password Type="PasswordText">x</wsse:Password>', b: '<token kind="a">y</token>' }] } }).collections.c.rows
  for (const f of ['a', 'b']) assert.match(tags[f], /^\[text with a secret-looking key/, f)
})

// The review's third medium: column-dropped was one flag per field, so 1,600
// columns a PR added to a seeded `accounts` and dropped at the click put
// users's delete past 1,598 flags. They are one flag now.
test('1,600 columns dropped from one collection are one flag: a users delete beside them is among the first flags', () => {
  const cols = Array.from({ length: 1_600 }, (_, i) => `c${String(i).padStart(4, '0')}`)
  const people = n => ({ key: ['id'], fields: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const seed = snap({ accounts: { key: ['id'], fields: ['id'], rows: [{ id: 1 }] }, users: people(30) })
  const s1 = snap({ accounts: { key: ['id'], fields: ['id', ...cols], rows: [{ id: 1 }] }, users: people(30) })
  const sn = snap({ accounts: { key: ['id'], fields: ['id'], rows: [{ id: 1 }] }, users: people(0) })
  const flags = flagChanges(diffSnapshots(s1, s1), diffSnapshots(s1, sn), none, { trusted: true })
  const at = flags.findIndex(f => f.collection === 'users' && f.kind === 'delete')
  assert.ok(at >= 0 && at < 10, String(at))
  const column = flags.find(f => f.kind === 'column-dropped')
  assert.deepEqual([column.collection, column.count, column.pr, column.fields], ['accounts', 1_600, 1_600, ['c0000', 'c0001', 'c0002', 'c0003', 'c0004']])
  assert.equal(flags.length, 4, JSON.stringify(flags.map(f => [f.collection, f.kind])))
  assert.ok(seed)
})

// The review's fourth medium: the pair rule's bound of 6 keys showed a HAR
// cookie's value in clear. `name` or `key` with `value` (lower case or
// capitalized) is a pair whatever the object holds; the looser spellings
// only in a small object. Every value key is masked.
test('name and value pairs: a HAR cookie of 8 keys and an SSM Parameter of 7 are masked; loose spellings only up to 6 keys; every value key', () => {
  const values = {
    cookie: { name: 'session_id', value: 'cookie-secret-1', path: '/', domain: 'example.com', expires: '2027-01-01', httpOnly: true, secure: true, sameSite: 'Lax' },
    ssm: { Parameter: { Name: '/prod/db/password', Type: 'SecureString', Value: 'ssm-secret-2', Version: 3, LastModifiedDate: '2026-10-01', ARN: 'arn:aws:ssm:x', DataType: 'text' } },
    seven: { name: 'DB_PASSWORD', value: 'seven-secret-3', a: 1, b: 2, c: 3, d: 4, e: 5 },
    two: { name: 'password', value: 'two-secret-4', v: 'two-secret-5' },
    loose6: { k: 'api_token', v: 'loose-secret-6', a: 1, b: 2, c: 3, d: 4 },
    nulled: { name: 'password', value: null },
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...values }] } }).collections.c.rows
  assert.doesNotMatch(JSON.stringify(row), /cookie-secret|ssm-secret|seven-secret|two-secret|loose-secret/)
  // a null value is kept as it is: clearing one shows
  assert.equal(JSON.parse(row.nulled.s).value, null)
  // a loose spelling in an object of 7 keys is no pair: its value shows
  const [loose] = snap({ c: { key: ['id'], rows: [{ id: 1, o: { k: 'api_token', v: 'shown-7', a: 1, b: 2, c: 3, d: 4, e: 5 } }] } }).collections.c.rows
  assert.match(loose.o.s, /shown-7/)
  // nor is a name that isn't a string
  const [named] = snap({ c: { key: ['id'], rows: [{ id: 1, o: { name: 7, value: 'shown-8' } }] } }).collections.c.rows
  assert.match(named.o.s, /shown-8/)
})

// The review's fifth medium: a collection left out for its name's length
// made every snapshot "maybe left out", so a certain drop read as unverified.
test('a collection with a name over 200 characters makes no other maybe left out: dropping users beside it is still a drop', () => {
  const people = { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }
  const long = 'x'.repeat(201)
  const s1 = snap({ users: people, orders: people })
  const sn = snap({ [long]: { key: ['id'], rows: [] }, orders: people })
  const pr = diffSnapshots(s1, sn)
  assert.equal(pr.collections.users.status, 'dropped')
  assert.deepEqual(flagChanges(diffSnapshots(s1, s1), pr, none, { trusted: true }).map(f => [f.collection, f.kind, f.severity]), [['users', 'dropped', 'red']])
  assert.equal(divergence(diffSnapshots(s1, s1), pr).collections.users.status, 'pr-only')
})

// The review's lows: the mutants this round's code let live.
test('mutants: entity quotes, triple-encoded JSON, long double-encoded cells, objects as their JSON text, throwing keys, a base-side omitted collection, cleared after shared, a key-only budget, the userinfo threshold', () => {
  const masked = /^\[text with a secret-looking key, \d+ characters, [0-9a-f]{8}\]$/
  const keys = {
    apos: "&apos;token&apos;: 'abc'",
    hex: '&#x27;password&#x27;: 1',
    upper: '{&QUOT;password&QUOT;: 1}',
    hexUpper: '&#X22;password&#X22;: 1',
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...keys }] } }).collections.c.rows
  for (const f of Object.keys(keys)) assert.match(row[f], masked, f)
  // JSON text encoded three times: its secret never shows (QUOTE's run of
  // backslashes)
  const thrice = JSON.stringify(JSON.stringify(JSON.stringify({ password: 'hunter-thrice-1' })))
  const [t] = snap({ c: { key: ['id'], rows: [{ id: 1, v: thrice, w: `see ${thrice}` }] } }).collections.c.rows
  assert.doesNotMatch(JSON.stringify(t), /hunter-thrice/)
  // a long cell encoded twice says so too
  const long = JSON.stringify({ text: 'y'.repeat(300) })
  const [enc] = snap({ c: { key: ['id'], rows: [{ id: 1, once: long, twice: JSON.stringify(long) }] } }).collections.c.rows
  assert.equal(enc.once.t, 'long')
  assert.equal(enc.twice.enc, 2)
  // an object and its JSON text are the same cell
  const [same] = snap({ c: { key: ['id'], rows: [{ id: 1, a: { theme: 'dark' }, b: '{"theme":"dark"}' }] } }).collections.c.rows
  assert.deepEqual(same.a, same.b)
  // a collections object whose keys throw: unreadable, so omitted is null
  const trap = new Proxy({}, { ownKeys() { throw new Error('no keys') } })
  assert.equal(sanitizeSnapshot({ collections: trap }, { masker: masker(), rules: none }).omitted, null)
  // a collection the base pane's snapshot may have left out: divergence
  // says unknown from the base side too
  const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) })
  const pad = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`aaa${String(i).padStart(2, '0')}`, people(3)]))
  const limits = { maxCollections: 2 }
  const s1 = snap({ users: people(2) }, {}, limits)
  const baseLost = diffSnapshots(s1, snap({ ...pad, users: people(2) }, {}, limits))
  const prDrop = diffSnapshots(s1, snap({}, {}, limits))
  assert.equal(divergence(baseLost, prDrop).collections.users.status, 'unknown')
  // amber: a cleared field after a shared delete
  const rows = clear => ({ key: ['id'], rows: [1, 2, 3].map(id => ({ id, note: clear ? '' : 'x' })) })
  const c0 = snap({ a: rows(false), z: rows(false) })
  const gone = snap({ a: { key: ['id'], rows: [{ id: 1, note: 'x' }, { id: 2, note: 'x' }] }, z: rows(false) })
  const both = snap({ a: { key: ['id'], rows: [{ id: 1, note: 'x' }, { id: 2, note: 'x' }] }, z: rows(true) })
  const amber = flagChanges(diffSnapshots(c0, gone), diffSnapshots(c0, both), none, { trusted: true })
  assert.deepEqual(amber.map(f => [f.collection, f.kind, f.severity]), [['a', 'delete', 'amber'], ['z', 'cleared', 'amber']])
  // the key alone over the share: kept as its count
  const keyOnly = snap({ t: { key: ['k'.repeat(300)], rows: [{ id: 1 }] } }, {}, { maxBytes: 100 })
  assert.deepEqual([keyOnly.collections.t.truncated, keyOnly.collections.t.rows.length], [true, 0])
  // a count-only collection costs no bytes: the next keeps its share
  const wide = Array.from({ length: 2_001 }, (_, i) => `f${i}`)
  const shared = snap({ a: { key: null, fields: wide, rows: [{ v: 1 }] }, b: { key: null, rows: [{ v: 'z'.repeat(60) }] } }, {}, { maxBytes: 160 })
  assert.deepEqual([shared.collections.a.truncated, shared.collections.b.truncated], [true, false])
  // a token alone in a URL's userinfo: from 16 characters
  const [u] = snap({ c: { key: ['id'], rows: [{ id: 1, at15: 'https://abcdefghij12345@h/x', at16: 'https://abcdefghij123456@h/x' }] } }).collections.c.rows
  assert.equal(u.at15, 'https://abcdefghij12345@h/x')
  assert.match(u.at16, /^https:\/\/\[secret [0-9a-f]{8}\]@h\/x$/)
})

// The review's lows: values still shown in clear.
test('more values masked: a token as a URL\'s user, a short base64 Basic, Go DSNs, JWTs, and the value of an element named as a secret', () => {
  // token shapes built at run time, so no scanner takes them for real ones
  const gh = `${['gh', 'p_'].join('')}${'B'.repeat(36)}`
  const jwt = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.eyJ', 'zdWIiOiIxIn0', '.c2lnbmF0dXJl'].join('')
  const values = {
    oauth: `https://${gh}:x-oauth-basic@github.com/o/r.git`,
    empty: `https://${gh}:@github.com/o/r.git`,
    userTok: 'https://abcdef0123456789:pw-secret-1@h/x',
    basic: 'auth=Basic dXNlcjpwYXNz ok',
    dsn: 'root:dsn-secret-2@tcp(127.0.0.1:3306)/app?parseTime=true',
    jwt: `token was ${jwt} then`,
    add: '<add key="DbPassword" value="xml-secret-3"/>',
    input: '<input name="pw" type="password" value="html-secret-4">',
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...values }] } }).collections.c.rows
  assert.doesNotMatch(JSON.stringify(row), /BBBB|abcdef0123|pw-secret|dXNlcjpwYXNz|dsn-secret|hbGciOi|xml-secret|html-secret/)
  assert.match(row.oauth, /^https:\/\/\[secret [0-9a-f]{8}\]:x-oauth-basic@github\.com\/o\/r\.git$/)
  assert.match(row.empty, /^https:\/\/\[secret [0-9a-f]{8}\]:@github\.com\/o\/r\.git$/)
  assert.match(row.dsn, /^root:\[secret [0-9a-f]{8}\]@tcp\(127\.0\.0\.1:3306\)\/app\?parseTime=true$/)
  assert.match(row.add, /^<add key="DbPassword" value="\[secret [0-9a-f]{8}\]"\/>$/)
  // a plain user, prose after a scheme, and an element not named as a secret
  const [kept] = snap({ c: { key: ['id'], rows: [{ id: 1, a: 'https://app:pw@h/x', b: 'Basic introduction', c: '<input name="email" value="a@b.c">', d: 'Basic Introduction' }] } }).collections.c.rows
  assert.match(kept.a, /^https:\/\/app:\[secret [0-9a-f]{8}\]@h\/x$/)
  assert.deepEqual([kept.b, kept.c, kept.d], ['Basic introduction', '<input name="email" value="a@b.c">', 'Basic Introduction'])
})

// The review's lows: common secret shapes under neutral field names.
test('more keys in text: backticks, aligned config, percent-encoding, command-line flags, a MySQL client\'s -p, and a PEM private key', () => {
  const texts = {
    mysqlLog: 'UPDATE `users` SET `password` = \'hunter2Zq\' WHERE id = 1',
    markdown: '`password`: hunter2Zq',
    aligned: `password${' '.repeat(20)}= hunter2Zq`,
    pct: 'q=1&password%3Dhunter2Zq',
    pctJson: '%7B%22password%22%3A%22hunter2Zq%22%7D',
    flag: 'run --password hunter2Zq',
    flagEq: 'run --db-token=hunter2Zq',
    mysqlP: 'mysql -u root -phunter2Zq app',
    pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----',
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...texts }] } }).collections.c.rows
  for (const f of Object.keys(texts)) assert.match(row[f], /^\[text with a secret-looking key, \d+ characters, [0-9a-f]{8}\]$/, f)
  // a neutral flag, and -p elsewhere, are left be
  const [kept] = snap({ c: { key: ['id'], rows: [{ id: 1, a: 'mkdir -p /tmp/x --verbose', b: 'gcc -pthread -o app' }] } }).collections.c.rows
  assert.deepEqual([kept.a, kept.b], ['mkdir -p /tmp/x --verbose', 'gcc -pthread -o app'])
})
"""
open(R + P, 'w').write(s)
print('ok')
