R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/data-diff.mjs', [
    # --- the key scan: after an escape too, and the escape's remnant stripped
    ("""  const secretKeyIn = s => {
    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
    if (/[:=]|%3[ad]/i.test(head)) for (const m of head.matchAll(KEY_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true""",
     """  const secretKeyIn = s => {
    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
    if (/[:=]|%3[ad]/i.test(head)) {
      for (const m of head.matchAll(KEY_IN_TEXT)) {
        if (SECRET_NAME.test(m[1])) return true
        // a key read from inside an escape (`%26pin=`, `\\npw=`): the name
        // past the escape's hex digits or letter, for names that are words
        const before = head[m.index - 1]
        const past = before === '%' ? m[1].replace(/^[0-9a-f]{2}/i, '') : before === '\\\\' ? m[1].replace(/^[nrt]/, '') : null
        if (past !== null && past !== m[1] && SECRET_NAME.test(past)) return true
      }
    }"""),
    # --- maskInText: DSN, attributes
    ("""      .replace(DSN_USERINFO, (_, user, pw, proto) => `${user}:${hidden('d', pw)}@${proto}(`)""",
     """      .replace(DSN_USERINFO, (_, user, pw, rest) => `${user}:${hidden('d', pw)}@${rest}`)"""),
    ("""      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2]))
        ? tag.replace(ATTR_VALUE, (_, eq, q, value) => `value${eq}${q}${hidden('x', value)}${q}`)
        : tag))""",
     """      .replace(ATTR_TAG, tag => ([...tag.matchAll(ATTR_NAME)].some(m => SECRET_NAME.test(m[2] ?? m[3] ?? m[4]))
        ? tag.replace(ATTR_VALUE, (_, name, eq, dq, sq, bare) => {
          const value = dq ?? sq ?? bare
          const q = dq !== undefined ? '"' : sq !== undefined ? "'" : ''
          return `${name}${eq}${q}${hidden('x', value)}${q}`
        })
        : tag))"""),
    # --- the cell: a pair's value forced secret
    ("""  function cell(collection, field, value) {
    const as = classOf(collection, field)""",
     """  // `secret`: the field is a name and value pair's value (pairOf), so
  // secret whatever its name, unless it is a softDelete field
  function cell(collection, field, value, secret = false) {
    const named = classOf(collection, field)
    const as = secret && named !== 'plain' ? 'secret' : named"""),
    # --- the patterns
    ("""// A key in text: at a word start, maybe quoted (an escaped quote, a
// backtick, one HTML-escaped in any case, or one percent-encoded) or in
// brackets, then up to 32 spaces and ':' or '=' (or their
// percent-encodings). A match never starts inside a run of
// backslashes, so a long run is read once, not once from each of its
// backslashes; a key right after a single one (`\\npassword=`,
// `C:\\x\\api_key=`) still counts. A tag's name, with a namespace or
// attributes: `<password>`, `<wsse:Password Type="…">`; its attributes
// never run past the next '<'. A command-line flag (`--password x`,
// `--db-token=x`), a MySQL client's `-p<password>`, and a PEM private key.""",
     """// A key in text: at a word start, or right after a percent-escape
// (`x%3dpassword=`, `%26pin%3D`) or a one-letter backslash escape
// (`\\npw=`), maybe quoted (an escaped quote, a backtick, one HTML-escaped
// in any case, or one percent-encoded) or in brackets, then up to 32
// spaces and ':' or '=' (or their percent-encodings). A match never starts
// inside a run of backslashes, so a long run is read once, not once from
// each of its backslashes; a key right after a single one
// (`\\npassword=`, `C:\\x\\api_key=`) still counts. A tag's name, with a
// namespace, before whitespace, '/' or '>': `<password>`, `<wsse:Password
// Type="…">`; its attributes aren't read, so a '<' in one doesn't matter.
// A command-line flag (`--password x`, `--db-token=x`), a MySQL client's
// `-p<password>`, and a PEM or PGP private key."""),
    ("""const KEY_IN_TEXT = new RegExp(String.raw`(?<![\\w.-])(?<!\\\\(?=\\\\))${QUOTE}?([\\w.-]{1,128})${QUOTE}?\\]?\\s{0,32}(?:[:=]|%3[ad])`, 'gi')
const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^<>]{0,256})?>/g
const FLAG_IN_TEXT = /(?<!\\S)--?([a-z][\\w-]{0,63})(?=[ =])/gi
const MYSQL_P = /\\b(?:mysql|mysqldump|mysqladmin|mariadb)\\b[^\\n]{0,256}?\\s-p[^\\s-]/i
const PEM_KEY = /-----BEGIN [A-Z ]{0,64}PRIVATE KEY-----/""",
     """const KEY_IN_TEXT = new RegExp(String.raw`(?:(?<![\\w.-])|(?<=%[0-9a-f]{2})|(?<=(?<!\\\\)\\\\[nrt]))(?<!\\\\(?=\\\\))${QUOTE}?([\\w.-]{1,128})${QUOTE}?\\]?\\s{0,32}(?:[:=]|%3[ad])`, 'gi')
const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?=[\\s/>])/g
const FLAG_IN_TEXT = /(?<!\\S)--?([a-z][\\w-]{0,63})(?=[\\s=])/gi
const MYSQL_P = /\\b(?:mysql|mysqldump|mysqladmin|mariadb)\\b[^\\n]{0,256}?\\s-p[^\\s-]/i
const PEM_KEY = /-----BEGIN [A-Z ]{0,64}PRIVATE KEY(?: BLOCK)?-----/"""),
    ("""// - a Go DSN's password (`user:pw@tcp(…)`);
// - a JWT;
// - the value attribute of an element whose key, name, id or type looks
//   secret (`<add key="DbPassword" value="…"/>`, `<input type="password"
//   value="…">`).
// Each linear in the text.""",
     """// - a Go DSN's password (`user:pw@tcp(…)`, `@tcp6(`, `@unix(`, any
//   network, or `@/`), up to its last '@' and never across a ':';
// - a JWT;
// - the value attribute of an element whose key, name, id or type looks
//   secret, quoted either way or not (`<add key="DbPassword" value="…"/>`,
//   `<input type=password value=…>`).
// Each scans a bounded stretch from where it starts."""),
    ("""const DSN_USERINFO = /(?<![\\w.-])([\\w.-]{1,64}):([^\\s@/]{1,256})@(tcp|udp|unix)\\(/gi""",
     """const DSN_USERINFO = /(?<![\\w.-])([\\w.-]{1,64}):([^\\s/:]{1,256})@((?:[a-z][\\w-]{0,31})?\\(|\\/)/gi"""),
    ("""const ATTR_NAME = /\\b(key|name|id|type)\\s*=\\s*["']([^"'<>]{1,128})["']/gi
const ATTR_VALUE = /\\bvalue(\\s*=\\s*)(["'])([^"'<>]*)\\2/gi""",
     """const ATTR_NAME = /\\b(key|name|id|type)\\s*=\\s*(?:"([^"<>]{1,128})"|'([^'<>]{1,128})'|([^\\s"'<>=\\x60]{1,128}))/gi
const ATTR_VALUE = /\\b(value)(\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'<>=\\x60]+))/gi"""),
    # --- pairOf: any name-like key
    ("""// A name and value pair's own keys, in their usual spellings: `name`,
// `key`, `field` or `k` for the name, `value`, `val` or `v` for the value, in
// any case. Every value key is masked.""",
     """// A name and value pair's own keys, in their usual spellings: `name`,
// `key`, `field` or `k` for the name, `value`, `val` or `v` for the value, in
// any case. Any name-like key may name it (`{key: 'mail.smtp', name:
// 'Password', value}`), and every value key is masked."""),
    ("""  let name = null
  const values = []
  for (const k of keys) {
    const lower = k.toLowerCase()
    if (name === null && PAIR_NAMES.has(lower) && typeof obj[k] === 'string') name = obj[k]
    else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)
  }
  return name !== null && values.length > 0 && SECRET_NAME.test(name) ? { name, values } : null""",
     """  let name = null
  const values = []
  for (const k of keys) {
    const lower = k.toLowerCase()
    if (PAIR_NAMES.has(lower)) {
      if (name === null && typeof obj[k] === 'string' && SECRET_NAME.test(obj[k])) name = obj[k]
    } else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)
  }
  return name !== null && values.length > 0 ? { name, values } : null"""),
    # --- rows as pairs
    ("""    for (const field of Object.keys(r).sort()) {
      if (drop.has(field)) continue
      put(row, field, presence.has(field) ? isSet(r[field]) : masker.cell(name, field, r[field]))
    }""",
     """    // a row that is a name and value pair (a settings table's `{key:
    // 'smtp_password', value}`): its value fields are secret
    const pair = pairOf(r)
    for (const field of Object.keys(r).sort()) {
      if (drop.has(field)) continue
      put(row, field, presence.has(field) ? isSet(r[field]) : masker.cell(name, field, r[field], pair !== null && pair.values.includes(field)))
    }"""),
    # --- diff entries carry the before snapshot's declared fields
    ("""    keyLost: false,
    omitted: null,""",
     """    keyLost: false,
    omitted: null,
    // the before snapshot's declared fields, for flagChanges: which dropped
    // columns the base pane declares too
    fieldsBefore: b?.fields ?? null,"""),
    # --- the order's first group, and column-dropped's fields
    ("""const LOSES_DATA = new Set(['delete', 'emptied', 'dropped', 'key-lost'])""",
     """// What loses rows, a collection or its key: listed first. A dropped
// column loses data too, but is one flag a collection whatever the PR's
// padding, so it comes next, with mass changes.
const LOSES_ROWS = new Set(['delete', 'emptied', 'dropped', 'key-lost'])"""),
    ("""      const columns = mine.kind === 'column-dropped' ? { count: mine.n, fields: [...mine.items].sort().slice(0, 5) } : {}""",
     """      // a collection's dropped columns: those the base pane declares too
      // (its seeded columns) first, with their own count, then the PR's own
      let columns = {}
      if (mine.kind === 'column-dropped') {
        const declared = new Set(own(baseDiff.collections, name)?.fieldsBefore ?? [])
        const seeded = mine.items.filter(f => declared.has(f)).sort()
        const others = mine.items.filter(f => !declared.has(f)).sort()
        columns = { count: mine.n, seeded: seeded.length, fields: [...seeded, ...others].slice(0, 5) }
      }"""),
    ("""  const prOwn = f => (f.collection === null || !Object.hasOwn(baseDiff.collections, f.collection) ? 1 : 0)
  // what loses data (rows, a collection, the key) before what changes it in
  // bulk (a column, a mass change), before what can't be seen or is cleared
  const late = f => (LOSES_DATA.has(f.kind) ? 0 : f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)""",
     """  const prOwn = f => (f.collection === null || !Object.hasOwn(baseDiff.collections, f.collection) ? 1 : 0)
  // a base-pane collection the PR's snapshots may have left out: its drop
  // or wipe can't be seen, so its unverified flag stands with what loses rows
  const leftOut = f => f.kind === 'unverified' && typeof f.collection === 'string'
    && (!Object.hasOwn(prDiff.collections, f.collection) || Boolean(own(prDiff.collections, f.collection).omitted))
  // what loses rows, a collection or the key, before what changes it in
  // bulk (a column, a mass change), before what can't be seen or is cleared
  const late = f => (LOSES_ROWS.has(f.kind) || leftOut(f) ? 0 : f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)"""),
])
print('ok')
