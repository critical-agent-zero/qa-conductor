p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""export const SECRET_NAME = /pass|pwd|secret|token|salt|hash|otp|api[-_]?key|access[-_]?key|signing[-_]?key|client[-_]?key|encryption[-_]?key|master[-_]?key|private|session|card|cvv|cvc|ssn|iban|authori[sz]ation|bearer|jwt|cookie|credential|signature|dsn|database[-_]?ur[il]|mongo[-_]?ur[il]|connection[-_]?string|mnemonic|seed[-_]?phrase|recovery[-_]?code|pin[-_]?code|(?:^|[-_])pin(?:[-_]|$)/i""",
    """export const SECRET_NAME = /pass|pwd|secret|token|salt|hash|otp|api[-_]?key|access[-_]?key|signing[-_]?key|client[-_]?key|encryption[-_]?key|master[-_]?key|ssh[-_]?key|private|session|card|cvv|cvc|ssn|iban|authori[sz]ation|bearer|jwt|cookie|credential|signature|dsn|(?:database|mongo|redis|amqp|postgres(?:ql)?|mysql)[-_]?ur[il]|connection[-_]?string|mnemonic|seed[-_]?phrase|recovery[-_]?code|backup[-_]?code|pin[-_]?code|(?:^|[-_])pin(?:[-_]|$)/i""")
sub("""// How many collections' classes the masker remembers before it starts again.
const CLASS_CACHE = 1_000""", """// How many collections' classes the masker remembers before it starts again,
// and how many fields' in all.
const CLASS_CACHE = 1_000
const FIELD_CACHE = 50_000
// Past maxCollections, how many more collections (times maxCollections) are
// kept as counts alone before the rest are left out.
const COUNTED_COLLECTIONS = 10""")

sub("""// A value that counts as set: not null, undefined, '', [] or {}.
function isSet(value) {
  if (value === null || value === undefined || value === '') return false
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (isBytes(value)) return value.byteLength > 0""", """// A value that counts as set: not null, undefined, '', [] or {}, nor an
// empty Set or Map.
function isSet(value) {
  if (value === null || value === undefined || value === '') return false
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (isBytes(value)) return value.byteLength > 0
  if (value instanceof Set || value instanceof Map) return value.size > 0""")

sub("""  // collection -> field -> class, for at most CLASS_CACHE collections:
  // collection and field names are the store's, and a PR's can be many
  const classes = new Map()""", """  // collection -> field -> class, for at most CLASS_CACHE collections and
  // FIELD_CACHE fields in all: collection and field names are the store's,
  // and a PR's can be many
  const classes = new Map()
  let fieldsCached = 0""")
sub("""      if (classes.size >= CLASS_CACHE) classes.clear()""", """      if (classes.size >= CLASS_CACHE) { classes.clear(); fieldsCached = 0 }""")
sub("""    if (fields.known.size < 10_000) fields.known.set(field, as)
    return as
  }""", """    if (fieldsCached < FIELD_CACHE) { fields.known.set(field, as); fieldsCached++ }
    return as
  }""")

sub("""  // A secret-looking key somewhere in text that isn't (or can't be read as)
  // JSON: `"password": …`, `api_key=…`.
  const secretKeyIn = s => {
    for (const m of s.matchAll(/["']?([A-Za-z0-9_.-]{1,64})["']?\\s*[:=]/g)) if (SECRET_NAME.test(m[1])) return true
    return false
  }""", """  // A secret-looking key somewhere in text that isn't (or can't be read as)
  // JSON: `"password": …`, `\\"password\\": …`, `api_key=…`,
  // `user[password]=…`, `<password>…`. Looked for at word starts only, so
  // the scan is linear, and in the first HELD_JSON_MAX characters: a cell
  // shows at most its first MAX_TEXT.
  const secretKeyIn = s => {
    const head = s.length > HELD_JSON_MAX ? s.slice(0, HELD_JSON_MAX) : s
    if (/[:=]/.test(head)) for (const m of head.matchAll(KEY_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true
    if (head.includes('<')) for (const m of head.matchAll(TAG_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true
    return false
  }
  // Credentials in a URL, and an Authorization scheme's value, in text kept
  // as text: replaced by a digest, the rest kept.
  const maskInText = (s, where) => s
    .replace(URL_USERINFO, (_, scheme, user, pw) => `${scheme}${user}:[secret ${mac(`u:${where}\\u0000${pw}`, 8)}]@`)
    .replace(AUTH_VALUE, (_, scheme, value) => `${scheme} [secret ${mac(`a:${where}\\u0000${value}`, 8)}]`)""")
sub("""    return secretKeyIn(s) ? `[text with a secret-looking key, ${s.length} characters, ${mac(`t:${where}\\u0000${s}`, 8)}]` : s
  }""", """    return secretKeyIn(s) ? `[text with a secret-looking key, ${s.length} characters, ${mac(`t:${where}\\u0000${s}`, 8)}]` : maskInText(s, where)
  }""")
sub("""  // JSON that never throws: values under secret-looking keys masked (their
  // digests the field's), JSON held in strings read and masked, bytes as
  // their length, a bigint as its digits, a Set or a Map as its entries, and
  // anything unserializable said to be so.
  function toJson(value, where = '', depth = 0) {
    const replacer = function (k, v) {
      const raw = k === '' ? value : this[k]
      if (k !== '' && SECRET_NAME.test(k) && v !== null && v !== undefined) return `[secret ${mac(`j:${where}\\u0000${k}\\u0000${toJson(raw, where, HELD_JSON_DEPTH)}`, 8)}]`
      if (isBytes(raw)) return `[${raw.byteLength} bytes]`
      if (raw instanceof Set || raw instanceof Map) return [...raw]""", """  // JSON that never throws: values under secret-looking keys masked (their
  // digests the field's), and so the value of a name and value pair
  // (`{name: 'Authorization', value}`) and the one after a secret-looking
  // name in a list of strings (Node's rawHeaders); JSON held in strings read
  // and masked, bytes as their length, a bigint as its digits, a Set or a
  // Map as its entries, and anything unserializable said to be so.
  function toJson(value, where = '', depth = 0) {
    const secret = (k, raw) => `[secret ${mac(`j:${where}\\u0000${k}\\u0000${toJson(raw, where, HELD_JSON_DEPTH)}`, 8)}]`
    const replacer = function (k, v) {
      const raw = k === '' ? value : this[k]
      if (k !== '' && SECRET_NAME.test(k) && v !== null && v !== undefined) return secret(k, raw)
      if (isBytes(raw)) return `[${raw.byteLength} bytes]`
      if (raw instanceof Set || raw instanceof Map) return [...raw]
      if (Array.isArray(v) && v.some(x => typeof x === 'string' && SECRET_NAME.test(x))) {
        return v.map((x, i) => (i > 0 && typeof v[i - 1] === 'string' && SECRET_NAME.test(v[i - 1]) && x !== null && x !== undefined ? secret(v[i - 1], x) : x))
      }
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, 'value') && v.value !== null && v.value !== undefined) {
        const name = typeof v.name === 'string' ? v.name : typeof v.key === 'string' ? v.key : null
        if (name !== null && SECRET_NAME.test(name)) return { ...v, value: secret(name, v.value) }
      }""")
sub("""  // An object or array a string holds as JSON, else undefined.
  function heldJson(s) {
    if (s.length > HELD_JSON_MAX || !/^\\s*[[{]/.test(s)) return undefined
    try {
      const v = JSON.parse(s)
      return v !== null && typeof v === 'object' ? v : undefined
    } catch {
      return undefined
    }
  }""", """  // An object or array a string holds as JSON, else undefined. A JSON
  // string that holds one (JSON encoded twice) is read through.
  function heldJson(s, twice = true) {
    if (s.length > HELD_JSON_MAX) return undefined
    if (twice && /^\\s*"\\s*[[{]/.test(s)) {
      try {
        const inner = JSON.parse(s)
        return typeof inner === 'string' ? heldJson(inner, false) : undefined
      } catch {
        return undefined
      }
    }
    if (!/^\\s*[[{]/.test(s)) return undefined
    try {
      const v = JSON.parse(s)
      return v !== null && typeof v === 'object' ? v : undefined
    } catch {
      return undefined
    }
  }""")
sub("""  return { cell, cached: () => classes.size }
}""", """  return { cell, cached: () => classes.size, cachedFields: () => fieldsCached }
}

// A key in text: at a word start, maybe quoted (an escaped quote too) or in
// brackets, then ':' or '='. A tag's name: `<password>`. A URL's userinfo.
// An Authorization scheme and its value. Each linear in the text.
const KEY_IN_TEXT = /(?<![\\w.-])(?:\\\\*["'])?([\\w.-]{1,64})(?:\\\\*["'])?\\]?\\s{0,8}[:=]/g
const TAG_IN_TEXT = /<([\\w.-]{1,64})>/g
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\\/\\/)([^\\s/:@]{1,256}):([^\\s/@]{1,256})@/gi
const AUTH_VALUE = /\\b(Bearer|Basic|Token)\\s{1,4}([A-Za-z0-9._~+/=-]{8,})/g""")

# collections past maxCollections: by rows, kept as counts, then left out, said so
sub("""  if (names.length > maxCollections) {
    problems.push(`${names.length - maxCollections} collections past the first ${maxCollections} were left out`)
    names = names.slice(0, maxCollections)
  }
  // The byte budget is shared fairly: collections with the fewest rows go
  // first, and each may use at most an equal share of what is left, so one
  // collection (a PR's padding, say) can't starve the others.
  const rowsOf = name => { try { const rows = own(given, name)?.rows; return Array.isArray(rows) ? rows.length : 0 } catch { return 0 } }
  const order = names.map(name => [rowsOf(name), name]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)""", """  const rowsOf = name => { try { const rows = own(given, name)?.rows; return Array.isArray(rows) ? rows.length : 0 } catch { return 0 } }
  // Past maxCollections, collections are kept by rows, most first, so a PR
  // can't push one out with many small ones. Those past it are kept as their
  // counts alone (truncated, so flagged unverified), up to
  // COUNTED_COLLECTIONS times as many; only past those is one left out, and
  // said so by name.
  const counted = new Map()
  if (names.length > maxCollections) {
    const byRows = names.map(name => [rowsOf(name), name]).sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)
    const stubs = byRows.slice(maxCollections, maxCollections * (1 + COUNTED_COLLECTIONS))
    const out = byRows.slice(maxCollections * (1 + COUNTED_COLLECTIONS))
    const listed = list => (list.length <= 5 ? list.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${list.slice(0, 5).join(', ')} and ${list.length - 5} more`)
    for (const name of stubs) counted.set(name, stubOf(own(given, name)))
    problems.push(`${stubs.length} collections past the first ${maxCollections} by rows are kept as counts only: ${listed([...stubs].sort())}`)
    if (out.length) problems.push(`${out.length} collections past those were left out: ${listed([...out].sort())}`)
    const full = new Set(byRows.slice(0, maxCollections))
    names = names.filter(name => full.has(name) || counted.has(name))
  }
  // The byte budget is shared fairly: collections with the fewest rows go
  // first, and each may use at most an equal share of what is left, so one
  // collection (a PR's padding, say) can't starve the others.
  const order = names.filter(name => !counted.has(name)).map(name => [rowsOf(name), name]).sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)).map(([, name]) => name)""")
sub("""  for (const name of names) if (kept.has(name)) put(collections, name, kept.get(name))
  return { collections, problems }
}""", """  for (const name of names) {
    if (kept.has(name)) put(collections, name, kept.get(name))
    else if (counted.has(name)) put(collections, name, counted.get(name))
  }
  return { collections, problems }
}

// A collection kept as its count alone: no rows, truncated.
function stubOf(c) {
  let count = 0
  try {
    const rows = Array.isArray(c?.rows) ? c.rows.length : 0
    count = Math.max(Number.isSafeInteger(c?.count) && c.count >= 0 ? c.count : 0, rows)
  } catch { /* a count of 0 */ }
  return { key: null, fields: null, rows: [], count, truncated: true }
}""")

# divergence: a collection the PR pane's diff lacks
sub("""    const truncated = Boolean(b?.truncated || p?.truncated)
    // truncated on one side only: the other's rows and this one's count
    // can't be set side by side
    const oneSided = Boolean(b && p && b.truncated !== p.truncated)""", """    const truncated = Boolean(b?.truncated || p?.truncated)
    // truncated on one side only: the other's rows and this one's count
    // can't be set side by side. Nor can a collection the PR pane's
    // snapshots don't show at all.
    const oneSided = Boolean(b && p && b.truncated !== p.truncated) || Boolean(b && !p)""")

# flags: unverified for a collection the PR diff lacks, and both cut short unchanged (amber)
sub("""  // cut short in the PR pane only, or cut short with its count changed
  for (const name of Object.keys(prDiff.collections)) {
    const c = own(prDiff.collections, name)
    if (!c.truncated || c.status === 'dropped') continue
    const b = own(baseDiff.collections, name)
    const changed = c.countBefore !== c.countAfter
    if (b?.truncated && !changed) continue
    const shared = Boolean(b?.truncated) && b.countBefore === c.countBefore && b.countAfter === c.countAfter
    flags.push({ collection: name, kind: 'unverified', severity: trusted === true && shared ? 'amber' : 'red', shared, pr: 1, base: b?.truncated ? 1 : 0 })
  }""", """  // cut short in the PR pane only, or cut short with its count changed;
  // cut short in both with no change, only listed, amber
  for (const name of Object.keys(prDiff.collections)) {
    const c = own(prDiff.collections, name)
    if (!c.truncated || c.status === 'dropped') continue
    const b = own(baseDiff.collections, name)
    const changed = c.countBefore !== c.countAfter
    const shared = Boolean(b?.truncated) && b.countBefore === c.countBefore && b.countAfter === c.countAfter
    const severity = (b?.truncated && !changed) || (trusted === true && shared) ? 'amber' : 'red'
    flags.push({ collection: name, kind: 'unverified', severity, shared, pr: 1, base: b?.truncated ? 1 : 0 })
  }
  // in the base pane's diff, but not the PR pane's: its snapshots don't
  // show it (left out past the counts kept, say)
  for (const name of Object.keys(baseDiff.collections)) {
    if (!Object.hasOwn(prDiff.collections, name)) flags.push({ collection: name, kind: 'unverified', severity: 'red', shared: false, pr: 1, base: 0 })
  }""")

# the same fields changed to the same values
sub("""    // a row with which of its fields changed: the same rows with other
    // fields changed are another change
    const updateId = u => `${u.key} ${u.fields.map(f => f.field).sort().join(',')}`""", """    // a row with which of its fields changed, and to what: the same rows with
    // other fields changed, or the same fields set to other values, are
    // another change
    const updateId = u => `${u.key} ${u.fields.map(f => `${f.field}=${canon(f.after)}`).sort().join(',')}`""")
open(p, 'w').write(s)
print('ok')
