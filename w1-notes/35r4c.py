R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/data-diff.mjs', [
    ("""// A key in text: at a word start (or right after a percent-escape), maybe
// quoted (an escaped quote, a backtick, one HTML-escaped in any case, or
// one percent-encoded) or in brackets, then up to 32 spaces and ':' or '='
// (or their percent-encodings).""",
     """// A key in text: at a word start, maybe quoted (an escaped quote, a
// backtick, one HTML-escaped in any case, or one percent-encoded) or in
// brackets, then up to 32 spaces and ':' or '=' (or their
// percent-encodings)."""),
    ("""(?<=^|[^\\w.-]|%[0-9a-f]{2})(?<!\\\\(?=\\\\))""", """(?<![\\w.-])(?<!\\\\(?=\\\\))"""),
])

edit('README.md', [
    ("""A key counts at a word's start or right after a percent-escape, quoted or not""", """A key counts at a word's start, quoted or not"""),
])

edit('test/data-diff.test.mjs', [
    # N3: the first five fields, sorted
    ("""  const alike = flagChanges(diffSnapshots(c0, cols(['id'])), diffSnapshots(c0, cols(['id'])), none, { trusted: true })
  assert.deepEqual(alike.map(f => [f.kind, f.severity]), [['column-dropped', 'amber']])""",
     """  const alike = flagChanges(diffSnapshots(c0, cols(['id'])), diffSnapshots(c0, cols(['id'])), none, { trusted: true })
  assert.deepEqual(alike.map(f => [f.kind, f.severity]), [['column-dropped', 'amber']])
  // the first five by name, whatever the declared order
  const w0 = cols(['id', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])
  const wide = flagChanges(diffSnapshots(w0, w0), diffSnapshots(w0, cols(['id'])), none, { trusted: true })
  assert.deepEqual(wide.map(f => [f.count, f.fields]), [[7, ['a', 'b', 'c', 'd', 'e']]])"""),
    # N10: a name that isn't a string, even one that would read as secret
    ("""  // nor is a name that isn't a string
  const [named] = snap({ c: { key: ['id'], rows: [{ id: 1, o: { name: 7, value: 'shown-8' } }] } }).collections.c.rows
  assert.match(named.o.s, /shown-8/)""",
     """  // nor is one whose name isn't a string, a list say
  const [named] = snap({ c: { key: ['id'], rows: [{ id: 1, o: { name: ['password'], value: 'shown-8' } }] } }).collections.c.rows
  assert.match(named.o.s, /shown-8/)"""),
    # N26, N29: fields with neutral names, text with no secret-looking key
    ("""    basic: 'auth=Basic dXNlcjpwYXNz ok',""", """    basic: 'header Basic dXNlcjpwYXNz ok',"""),
    ("""    jwt: `token was ${jwt} then`,""", """    bearerless: `was ${jwt} then`,"""),
    # N24, N25, N32: a short user with no password, or with x-oauth-basic, and a known token prefix
    ("""    userTok: 'https://abcdef0123456789:pw-secret-1@h/x',""",
     """    userTok: 'https://abcdef0123456789:pw-secret-1@h/x',
    noPw: 'https://deployuser:@h/x',
    oauthUser: 'https://shortuser:x-oauth-basic@github.com/o/r.git',
    prefixed: `https://${['glp', 'at-'].join('')}abcdefghij:pw-secret-9@h/x`,"""),
    ("""  assert.doesNotMatch(JSON.stringify(row), /BBBB|abcdef0123|pw-secret|dXNlcjpwYXNz|dsn-secret|hbGciOi|xml-secret|html-secret/)""",
     """  assert.doesNotMatch(JSON.stringify(row), /BBBB|abcdef0123|pw-secret|dXNlcjpwYXNz|dsn-secret|hbGciOi|xml-secret|html-secret|deployuser|shortuser|abcdefghij/)
  assert.match(row.bearerless, /^was \\[secret [0-9a-f]{8}\\] then$/)
  assert.match(row.basic, /^header Basic \\[secret [0-9a-f]{8}\\] ok$/)"""),
    # N34: cleared after a shared mass change of the same severity
    ("""  const amber = flagChanges(diffSnapshots(c0, gone), diffSnapshots(c0, both), none, { trusted: true })
  assert.deepEqual(amber.map(f => [f.collection, f.kind, f.severity]), [['a', 'delete', 'amber'], ['z', 'cleared', 'amber']])""",
     """  const amber = flagChanges(diffSnapshots(c0, gone), diffSnapshots(c0, both), none, { trusted: true })
  assert.deepEqual(amber.map(f => [f.collection, f.kind, f.severity]), [['a', 'delete', 'amber'], ['z', 'cleared', 'amber']])
  // and after a shared mass change, though its collection sorts first
  const notes = topic => ({ key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, topic })) })
  const m0 = snap({ a: rows(false), z: notes('t') })
  const massed = snap({ a: rows(false), z: notes('u') })
  const massCleared = snap({ a: rows(true), z: notes('u') })
  const late = flagChanges(diffSnapshots(m0, massed), diffSnapshots(m0, massCleared), none, { trusted: true })
  assert.deepEqual(late.map(f => [f.collection, f.kind, f.severity]), [['z', 'mass-change', 'amber'], ['a', 'cleared', 'amber']])"""),
])
print('ok')
