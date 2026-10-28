R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'
P = 'test/data-diff.test.mjs'
s = open(R + P).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:120], s.count(a))
    s = s.replace(a, b, 1)


sub("""test('the tag scan is linear in text dense with tags: 24 cells of 256 KB of `<a ` and `<a:a ` take well under the time they took', () => {
  const a = '<a '.repeat(87_000)
  const ns = '<a:a '.repeat(52_000)
  const rows = Array.from({ length: 20 }, (_, id) => ({ id, v: a })).concat(Array.from({ length: 4 }, (_, id) => ({ id: 20 + id, v: ns })))
  const started = performance.now()
  // well under a second here; over 3 s when the attributes read across
  // the next '<'. The bound leaves room for a loaded machine.
  const kept = snap({ c: { key: ['id'], rows } }).collections.c.rows
  const took = performance.now() - started
  assert.ok(took < 3_000, `${Math.round(took)} ms`)
  assert.deepEqual([kept[0].v.t, kept[23].v.t], ['long', 'long'])""",
    """// Its time isn't asserted: under the owner's W28=B, a PR's data may slow
// masking, which the README documents (Hostile PR data).
test('text dense with tags is read, and tags with a namespace or attributes are found', () => {
  const a = '<a '.repeat(87_000)
  const ns = '<a:a '.repeat(52_000)
  const rows = Array.from({ length: 2 }, (_, id) => ({ id, v: a })).concat(Array.from({ length: 2 }, (_, id) => ({ id: 2 + id, v: ns })))
  const kept = snap({ c: { key: ['id'], rows } }).collections.c.rows
  assert.deepEqual([kept[0].v.t, kept[3].v.t], ['long', 'long'])""")
sub("""  // the DSN rule never reads past a ':' (it stays linear in 'a:' text), and
  // a word before ':' and '@' alone is kept
  const started = performance.now()
  snap({ c: { key: ['id'], rows: [{ id: 1, v: 'a:'.repeat(128 * 1024) }] } })
  assert.ok(performance.now() - started < 1_000)""",
    """  // text of 'a:' is read (its time is the README's, Hostile PR data)
  assert.equal(snap({ c: { key: ['id'], rows: [{ id: 1, v: 'a:'.repeat(128 * 1024) }] } }).collections.c.rows[0].v.t, 'long')""")

s += r"""
// --- Round 6 of #35's review --------------------------------------------------------

// The review's highs: a DSN password holding ':' (round 5's class left ':'
// out), and a DSN match that ran past a secret element's '>'. The corpus
// test holds both; these name them.
test('a DSN password holding \':\' is masked, and a secret element\'s value is masked before any DSN rule reads past its \'>\'', () => {
  const S = 'Zq9SeCr3tVal'
  const values = {
    a: `root:pa:ss${S}@tcp(127.0.0.1:3306)/app`,
    b: `root:${S}:@tcp(db)/app`,
    c: `root::${S}@tcp(db)/app`,
    d: `<input type="password" name="pw" value="${S}" style="width:100%"><style>@media(max-width:1px){}</style>`,
    e: `<input type="hidden" name="api_token" value="${S}" style="display:none"><style>@supports(x:y){}</style>`,
    f: `<x id="secret" value="${S}" href="mailto:a@b.c">x</x>`,
  }
  const [row] = snap({ c: { key: ['id'], rows: [{ id: 1, ...values }] } }).collections.c.rows
  assert.doesNotMatch(JSON.stringify(row), new RegExp(S))
  assert.match(row.d, /^<input type="password" name="pw" value="\[secret [0-9a-f]{8}\]" style="width:100%"><style>@media/)
})

test('the review\'s mutant cases: a base collection the PR\'s diff lacks sorts with what loses rows; fieldsBefore is the before snapshot\'s; MYSQL in capitals; a row pair never masks a key field', () => {
  // the base pane's diff has `users`; the PR pane's lacks it
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, v: 'x' }))
  const seed = snap({ users: { key: ['id'], rows: rows(3) }, zz: { key: ['id'], fields: ['id', 'v', 'old'], rows: rows(30) } })
  const after = snap({ zz: { key: ['id'], fields: ['id', 'v'], rows: rows(30).map(r => ({ ...r, v: 'y' })) } })
  const pr = diffSnapshots(seed, after)
  delete pr.collections.users
  const kinds = flagChanges(diffSnapshots(seed, seed), pr, none, { trusted: true }).map(f => `${f.collection}:${f.kind}`)
  assert.ok(kinds.indexOf('users:unverified') >= 0 && kinds.indexOf('users:unverified') < kinds.indexOf('zz:column-dropped'), kinds.join(' '))
  // seeded columns are those the base pane's before snapshot declares
  const cols = fields => snap({ users: { key: ['id'], fields: ['id', ...fields], rows: [{ id: 1 }] } })
  const baseDiff = diffSnapshots(cols(['email', 'legacy']), cols(['email']))
  const prDiff = diffSnapshots(cols(['email', 'legacy', 'aa_pad']), cols([]))
  const [flag] = flagChanges(baseDiff, prDiff, none, { trusted: true })
  assert.deepEqual([flag.count, flag.seeded, flag.fields], [3, 2, ['email', 'legacy', 'aa_pad']])
  // a MySQL client named in capitals
  const [t] = snap({ c: { key: ['id'], rows: [{ id: 1, v: 'MYSQL -u root -phunter2Zq app' }] } }).collections.c.rows
  assert.match(t.v, /^\[text with a secret-looking key/)
  // a row pair keeps its key fields: renaming a row stays an update
  const kv = (v) => snap({ settings: { key: ['value'], rows: [{ key: 'smtp_password', value: v }] } })
  const k1 = kv('a')
  assert.equal(k1.collections.settings.rows[0].value, 'a', 'a key field is never masked')
  assert.deepEqual(k1.collections.settings.key, ['value'])
})
"""
open(R + P, 'w').write(s)
print('ok')
