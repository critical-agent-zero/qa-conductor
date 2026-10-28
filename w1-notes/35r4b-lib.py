R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/data-diff.mjs', [
    # --- W28=B: no maxCells
    ("""// What a snapshot may hold: rows per collection, bytes and cells (a row's
// fields) per pane snapshot, and how long the inspector may take. maxCells
// bounds the work: masking a snapshot, and diffing and flagging two, takes
// time in proportion to their cells, and runs on the conductor's event loop.
export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, maxCells: 500_000, maxCollections: 1_000, timeoutMs: 30_000 })""",
     """// What a snapshot may hold: rows per collection, bytes per pane snapshot,
// and how long the inspector may take. These bound what is kept, not the
// work on the conductor's event loop: masking scales with the raw data a
// PR's store holds (README, Hostile PR data and the conductor's
// responsiveness).
export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, maxCollections: 1_000, timeoutMs: 30_000 })"""),
    # --- SECRET_NAME: pw, psk and auth as words
    ("""|pin[-_]?code|(?:^|[-_])pin(?:[-_]|$)/i""",
     """|pin[-_]?code|(?:^|[-_])(?:pin|pw|psk)(?:[-_]|$)|^_?auth$/i"""),
    ("""  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes, maxCells = LIMITS.maxCells, maxCollections = LIMITS.maxCollections } = limits ?? {}""",
     """  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes, maxCollections = LIMITS.maxCollections } = limits ?? {}"""),
    ("""  // The byte and cell budgets are shared fairly: collections with the
  // fewest rows go first, and each may use at most an equal share of what is
  // left, so one collection (a PR's padding, say) can't starve the others. A
  // collection past its share is cut short, so only its count is compared.
  const order = names.filter(name => !counted.has(name)).map(name => [rowsOf(name), name]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)
  let left = maxBytes
  let cellsLeft = maxCells
  const kept = new Map()
  order.forEach((name, i) => {
    const budget = Math.floor(left / (order.length - i))
    const cellBudget = Math.floor(cellsLeft / (order.length - i))
    try {
      const out = sanitizeCollection(name, own(given, name), { masker, rules, maxRows, budget, cellBudget, problems })
      if (out === null) return
      left -= out.size
      cellsLeft -= out.cells
      kept.set(name, out.collection)""",
     """  // The byte budget is shared fairly: collections with the fewest rows go
  // first, and each may use at most an equal share of what is left, so one
  // collection (a PR's padding, say) can't starve the others. A collection
  // past its share is cut short, so only its count is compared.
  const order = names.filter(name => !counted.has(name)).map(name => [rowsOf(name), name]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)
  let left = maxBytes
  const kept = new Map()
  order.forEach((name, i) => {
    const budget = Math.floor(left / (order.length - i))
    try {
      const out = sanitizeCollection(name, own(given, name), { masker, rules, maxRows, budget, problems })
      if (out === null) return
      left -= out.size
      kept.set(name, out.collection)"""),
    # --- omitted: names left out for their length don't count
    ("""  return { collections, problems, omitted: total - n }""",
     """  // those left out for their length don't count: no name the diff sees
  // can be one of them, so they make no other collection maybe left out
  return { collections, problems, omitted: total - long - n }"""),
    ("""// throw. `omitted` counts the collections given but not kept (left out, or
// unreadable), or is null when the snapshot couldn't be read at all: the
// diff then never takes a collection missing from it for added or dropped.""",
     """// throw. `omitted` counts the collections given but not kept (left out, or
// unreadable; not those whose names are too long), or is null when the
// snapshot couldn't be read at all: the diff then never takes a collection
// missing from it for added or dropped."""),
    ("""function sanitizeCollection(name, c, { masker, rules, maxRows, budget, cellBudget = Infinity, problems }) {""",
     """function sanitizeCollection(name, c, { masker, rules, maxRows, budget, problems }) {"""),
    ("""  const countOnly = { size: 0, cells: 0, collection: { key: null, fields: null, rows: [], count, truncated: true } }""",
     """  const countOnly = { size: 0, collection: { key: null, fields: null, rows: [], count, truncated: true } }"""),
    ("""  let cells = 0
  for (const r of c.rows.slice(0, maxRows)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { bad++; continue }
    // counted before the row is read, so the work stays within the share
    const names = Object.keys(r)
    if (cells + names.length > cellBudget) { truncated = true; break }
    cells += names.length
    const row = {}
    for (const field of names.sort()) {""",
     """  for (const r of c.rows.slice(0, maxRows)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { bad++; continue }
    const row = {}
    for (const field of Object.keys(r).sort()) {"""),
    ("""  return { size, cells, collection: { key, fields, rows, count, truncated } }""",
     """  return { size, collection: { key, fields, rows, count, truncated } }"""),
    # --- the text scans
    ("""  const secretKeyIn = s => {
    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
    if (/[:=]/.test(head)) for (const m of head.matchAll(KEY_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true
    if (head.includes('<')) for (const m of head.matchAll(TAG_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true
    return false
  }""",
     """  const secretKeyIn = s => {
    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
    if (/[:=]|%3[ad]/i.test(head)) for (const m of head.matchAll(KEY_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true
    if (head.includes('<')) for (const m of head.matchAll(TAG_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true
    if (head.includes('-')) {
      for (const m of head.matchAll(FLAG_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true
      if (MYSQL_P.test(head) || PEM_KEY.test(head)) return true
    }
    return false
  }"""),
    ("""  const maskInText = (s, where) => {
    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
    const masked = head
      .replace(URL_USERINFO, (_, scheme, user, pw, token) => (token !== undefined
        ? `${scheme}[secret ${mac(`u:${where}\\u0000${token}`, 8)}]@`
        : `${scheme}${user}:[secret ${mac(`u:${where}\\u0000${pw}`, 8)}]@`))
      .replace(AUTH_VALUE, (_, scheme, value) => `${scheme} [secret ${mac(`a:${where}\\u0000${value}`, 8)}]`)
    return head === s ? masked : masked + s.slice(HELD_JSON_MAX)
  }""",
     """  const maskInText = (s, where) => {
    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
    const hidden = (tag, value) => `[secret ${mac(`${tag}:${where}\\u0000${value}`, 8)}]`
    const masked = head
      .replace(URL_USERINFO, (_, scheme, user, pw, token) => {
        if (token !== undefined) return `${scheme}${hidden('u', token)}@`
        // a user that is a token: one that looks like it, or one with no
        // password or GitHub's x-oauth-basic beside it
        const oauth = /^x-oauth-basic$/i.test(pw)
        const userShown = user !== '' && (tokenLike(user) || pw === '' || oauth) ? hidden('u', user) : user
        return `${scheme}${userShown}:${pw === '' || oauth ? pw : hidden('u', pw)}@`
      })
      .replace(AUTH_VALUE, (match, scheme, value) => (authToken(scheme, value) ? `${scheme} ${hidden('a', value)}` : match))
      .replace(DSN_USERINFO, (_, user, pw, proto) => `${user}:${hidden('d', pw)}@${proto}(`)
      .replace(JWT, value => hidden('j', value))
      // an element whose key, name, id or type looks secret: its value
      .replace(ATTR_TAG, tag => {
        const named = ATTR_NAME.exec(tag)
        return named && SECRET_NAME.test(named[2]) ? tag.replace(ATTR_VALUE, (_, eq, q, value) => `value${eq}${q}${hidden('x', value)}${q}`) : tag
      })
    return head === s ? masked : masked + s.slice(HELD_JSON_MAX)
  }"""),
    # --- the pair rule: every value key, and no bound on the strict spellings
    ("""        const pair = pairOf(v)
        if (pair !== null) return { ...v, [pair.value]: secret(pair.name, v[pair.value]) }""",
     """        const pair = pairOf(v)
        if (pair !== null) return { ...v, ...Object.fromEntries(pair.values.map(k => [k, secret(pair.name, v[k])])) }"""),
    ("""  // JSON that never throws: values under secret-looking keys masked (their
  // digests the field's), and so the value of a name and value pair""",
     """  // JSON that never throws: values under secret-looking keys masked (their
  // digests the field's), and so every value of a name and value pair"""),
    # --- the patterns
    ("""// A key in text: at a word start, maybe quoted (an escaped quote, or one
// HTML-escaped, too) or in brackets, then ':' or '='. A match never starts
// inside a run of backslashes, so a long run is read once, not once from
// each of its backslashes; a key right after a single one (`\\npassword=`,
// `C:\\x\\api_key=`) still counts. A tag's name, with a namespace or
// attributes: `<password>`, `<wsse:Password Type="…">`. A URL's userinfo:
// a password (the user may be empty, the password hold '@'), or a token
// alone. An Authorization scheme, in any case, and a value that looks like
// a token: a digit in it, or 16 characters, so prose such as "Basic
// introduction" is left be. Each linear in the text.
const QUOTE = String.raw`(?:\\\\*["']|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);)`
const KEY_IN_TEXT = new RegExp(String.raw`(?<![\\w.-])(?<!\\\\(?=\\\\))${QUOTE}?([\\w.-]{1,128})${QUOTE}?\\]?\\s{0,8}[:=]`, 'g')
const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^>]{0,256})?>/g
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\\/\\/)(?:([^\\s/:@]{0,256}):([^\\s/]{1,256})|([^\\s/:@]{16,256}))@/gi
const AUTH_VALUE = /\\b(bearer|basic|token)\\s{1,4}((?=[A-Za-z0-9._~+/=-]{0,1024}\\d)[A-Za-z0-9._~+/=-]{8,}|[A-Za-z0-9._~+/=-]{16,})/gi""",
     """// A key in text: at a word start (or right after a percent-escape), maybe
// quoted (an escaped quote, a backtick, one HTML-escaped in any case, or
// one percent-encoded) or in brackets, then up to 32 spaces and ':' or '='
// (or their percent-encodings). A match never starts inside a run of
// backslashes, so a long run is read once, not once from each of its
// backslashes; a key right after a single one (`\\npassword=`,
// `C:\\x\\api_key=`) still counts. A tag's name, with a namespace or
// attributes: `<password>`, `<wsse:Password Type="…">`; its attributes
// never run past the next '<'. A command-line flag (`--password x`,
// `--db-token=x`), a MySQL client's `-p<password>`, and a PEM private key.
const QUOTE = String.raw`(?:\\\\*["'\\x60]|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);|%2[27])`
const KEY_IN_TEXT = new RegExp(String.raw`(?<=^|[^\\w.-]|%[0-9a-f]{2})(?<!\\\\(?=\\\\))${QUOTE}?([\\w.-]{1,128})${QUOTE}?\\]?\\s{0,32}(?:[:=]|%3[ad])`, 'gi')
const TAG_IN_TEXT = /<(?:[\\w.-]{1,64}:)?([\\w.-]{1,128})(?:\\s[^<>]{0,256})?>/g
const FLAG_IN_TEXT = /(?<!\\S)--?([a-z][\\w-]{0,63})(?=[ =])/gi
const MYSQL_P = /\\b(?:mysql|mysqldump|mysqladmin|mariadb)\\b[^\\n]{0,256}?\\s-p[^\\s-]/i
const PEM_KEY = /-----BEGIN [A-Z ]{0,64}PRIVATE KEY-----/
// Values in text kept as text, each replaced by a digest:
// - a URL's userinfo: a password (the user may be empty, the password
//   hold '@'), or a token alone (16 characters or more); the user too when
//   it looks like a token, or has no password, or GitHub's x-oauth-basic;
// - an Authorization scheme's value, in any case, that looks like a token
//   (authToken);
// - a Go DSN's password (`user:pw@tcp(…)`);
// - a JWT;
// - the value attribute of an element whose key, name, id or type looks
//   secret (`<add key="DbPassword" value="…"/>`, `<input type="password"
//   value="…">`).
// Each linear in the text.
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\\/\\/)(?:([^\\s/:@]{0,256}):([^\\s/]{0,256})|([^\\s/:@]{16,256}))@/gi
const AUTH_VALUE = /\\b(bearer|basic|token)\\s{1,4}([A-Za-z0-9._~+/=-]{8,})/gi
const DSN_USERINFO = /(?<![\\w.-])([\\w.-]{1,64}):([^\\s@/]{1,256})@(tcp|udp|unix)\\(/gi
const JWT = /(?<![\\w-])eyJ[\\w-]{4,}\\.eyJ[\\w-]{4,}\\.[\\w-]{4,}/g
const ATTR_TAG = /<[\\w:.-]{1,64}\\s[^<>]{0,1024}>/g
const ATTR_NAME = /\\b(key|name|id|type)\\s*=\\s*["']([^"'<>]{1,128})["']/i
const ATTR_VALUE = /\\bvalue(\\s*=\\s*)(["'])([^"'<>]*)\\2/gi
// A user that looks like a token: a known prefix, or 16 characters with a
// digit.
const tokenLike = s => /^(?:gh[pousr]_|github_pat_|glpat-|xox[abpr]-|sk_live_|sk-)/.test(s) || (s.length >= 16 && /\\d/.test(s))
// An Authorization value that looks like a token: a digit in it, or 16
// characters; for Basic, base64 too (user:password encoded: a length of 4s,
// and a digit, '+', '/', '=' or a capital past the first letter), so prose
// such as "Basic introduction" is left be.
const authToken = (scheme, value) => /\\d/.test(value) || value.length >= 16
  || (/^basic$/i.test(scheme) && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && /[0-9+/=]|.[A-Z]/.test(value))"""),
    ("""// A name and value pair's own keys, in their usual spellings: `name`,
// `key`, `field` or `k` for the name, `value`, `val` or `v` for the value, in
// any case. Only a small object is one: a pair has few keys.
const PAIR_NAMES = new Set(['name', 'key', 'field', 'k'])
const PAIR_VALUES = new Set(['value', 'val', 'v'])
function pairOf(obj) {
  const keys = Object.keys(obj)
  if (keys.length > 6) return null
  let name = null
  let value = null
  for (const k of keys) {
    const lower = k.toLowerCase()
    if (name === null && PAIR_NAMES.has(lower) && typeof obj[k] === 'string') name = obj[k]
    else if (value === null && PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) value = k
  }
  return name !== null && value !== null && SECRET_NAME.test(name) ? { name, value } : null
}""",
     """// A name and value pair's own keys, in their usual spellings: `name`,
// `key`, `field` or `k` for the name, `value`, `val` or `v` for the value, in
// any case. Every value key is masked. `name` or `key` with `value`, all
// lower case or all capitalized, is a pair whatever else the object holds (a
// HAR cookie has 8 keys, an SSM Parameter 7); the looser spellings only in a
// small object, of at most 6 keys.
const PAIR_NAMES = new Set(['name', 'key', 'field', 'k'])
const PAIR_VALUES = new Set(['value', 'val', 'v'])
const isText = (obj, k) => Object.hasOwn(obj, k) && typeof obj[k] === 'string'
function pairOf(obj) {
  const keys = Object.keys(obj)
  const strict = ((isText(obj, 'name') || isText(obj, 'key')) && Object.hasOwn(obj, 'value'))
    || ((isText(obj, 'Name') || isText(obj, 'Key')) && Object.hasOwn(obj, 'Value'))
  if (!strict && keys.length > 6) return null
  let name = null
  const values = []
  for (const k of keys) {
    const lower = k.toLowerCase()
    if (name === null && PAIR_NAMES.has(lower) && typeof obj[k] === 'string') name = obj[k]
    else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)
  }
  return name !== null && values.length > 0 && SECRET_NAME.test(name) ? { name, values } : null
}"""),
    # --- column-dropped folded per collection
    ("""// - column-dropped: a declared field gone, per field;""",
     """// - column-dropped: declared fields gone, one flag per collection, with
//   `count` and the first five in `fields`, so many can't push another
//   flag out of a capped list;"""),
    ("""      flags.push({ collection: name, kind: mine.kind, severity, shared, pr: mine.n, base: theirs?.n ?? 0, ...(mine.field === null ? {} : { field: mine.field }) })""",
     """      const columns = mine.kind === 'column-dropped' ? { count: mine.n, fields: [...mine.items].sort().slice(0, 5) } : {}
      flags.push({ collection: name, kind: mine.kind, severity, shared, pr: mine.n, base: theirs?.n ?? 0, ...(mine.field === null ? {} : { field: mine.field }), ...columns })"""),
    ("""    for (const field of c.fieldsDropped) add('column-dropped', field, 1, [field])""",
     """    add('column-dropped', null, c.fieldsDropped.length, [...c.fieldsDropped])"""),
    ("""// unverified and cleared; then by collection, kind and field. So many
// column or mass-change flags can't push a delete out of a capped list.""",
     """// unverified and cleared; then by collection, kind and field. So a
// collection's dropped columns, one flag, or many mass changes can't push a
// delete out of a capped list."""),
])
print('ok')
