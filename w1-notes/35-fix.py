p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


# --- constants
sub("""// How many collections' classes the masker remembers before it starts again,
// and how many fields' in all.
const CLASS_CACHE = 1_000
const FIELD_CACHE = 50_000
""", """// How many collections' classes the masker remembers before it starts again,
// and how many fields' in all; a name longer than CACHED_NAME is worked out
// each time, never remembered.
const CLASS_CACHE = 1_000
const FIELD_CACHE = 50_000
const CACHED_NAME = 128
// The longest collection name kept (a longer one is left out, said so), and
// the most fields a key or a collection's declared fields may have.
const MAX_NAME = 200
const MAX_KEY_FIELDS = 32
const MAX_FIELDS = 2_000
""")

# --- the masker's cache
sub("""  function classOf(collection, field) {
    let fields = classes.get(collection)
    if (!fields) {
      if (classes.size >= CLASS_CACHE) { classes.clear(); fieldsCached = 0 }
      fields = { soft: softFields(rules, collection), classify: rulesFor(rules.classify, collection), known: new Map() }
      classes.set(collection, fields)
    }
    if (fields.known.has(field)) return fields.known.get(field)
    let as = null
    if (fields.soft.has(field)) as = 'plain'
    else {
      const said = fields.classify.filter(r => r.fields.includes(field)).map(r => r.as)
      as = SECRET_NAME.test(field) || said.includes('secret') ? 'secret' : said.includes('pii') ? 'pii' : null
    }
    if (fieldsCached < FIELD_CACHE) { fields.known.set(field, as); fieldsCached++ }
    return as
  }""", """  function classOf(collection, field) {
    const cacheable = collection.length <= CACHED_NAME
    let fields = cacheable ? classes.get(collection) : undefined
    if (!fields) {
      fields = { soft: softFields(rules, collection), classify: rulesFor(rules.classify, collection), known: new Map() }
      if (cacheable) {
        if (classes.size >= CLASS_CACHE) { classes.clear(); fieldsCached = 0 }
        classes.set(collection, fields)
      }
    }
    if (fields.known.has(field)) return fields.known.get(field)
    let as = null
    if (fields.soft.has(field)) as = 'plain'
    else {
      const said = fields.classify.filter(r => r.fields.includes(field)).map(r => r.as)
      as = SECRET_NAME.test(field) || said.includes('secret') ? 'secret' : said.includes('pii') ? 'pii' : null
    }
    if (cacheable && field.length <= CACHED_NAME && fieldsCached < FIELD_CACHE) { fields.known.set(field, as); fieldsCached++ }
    return as
  }""")

# --- the text scan's comment
sub("""  // A secret-looking key somewhere in text that isn't (or can't be read as)
  // JSON: `"password": …`, `\\"password\\": …`, `api_key=…`,
  // `user[password]=…`, `<password>…`. Looked for at word starts only, so
  // the scan is linear, and in the first HELD_JSON_MAX characters: a cell
  // shows at most its first MAX_TEXT.""", """  // A secret-looking key somewhere in text that isn't (or can't be read as)
  // JSON: `"password": …`, `\\"password\\": …`, `&quot;password&quot;: …`,
  // `api_key=…`, `user[password]=…`, `<password>…`. Looked for at word
  // starts only, never inside a run of backslashes, so the scan is linear,
  // and in the first HELD_JSON_MAX characters: a cell shows at most its
  // first MAX_TEXT.""")

# --- URL credentials (an empty user, a password with '@', a token alone)
sub("""    const masked = head
      .replace(URL_USERINFO, (_, scheme, user, pw) => `${scheme}${user}:[secret ${mac(`u:${where}\\u0000${pw}`, 8)}]@`)
      .replace(AUTH_VALUE, (_, scheme, value) => `${scheme} [secret ${mac(`a:${where}\\u0000${value}`, 8)}]`)""",
    """    const masked = head
      .replace(URL_USERINFO, (_, scheme, user, pw, token) => (token !== undefined
        ? `${scheme}[secret ${mac(`u:${where}\\u0000${token}`, 8)}]@`
        : `${scheme}${user}:[secret ${mac(`u:${where}\\u0000${pw}`, 8)}]@`))
      .replace(AUTH_VALUE, (_, scheme, value) => `${scheme} [secret ${mac(`a:${where}\\u0000${value}`, 8)}]`)""")

# --- double-encoded JSON keeps its outer form inside JSON
sub("""  function maskText(s, where, depth) {
    if (s.length <= HELD_JSON_MAX && depth < HELD_JSON_DEPTH) {
      const held = heldJson(s)
      if (held !== undefined) return toJson(held, where, depth + 1)""", """  function maskText(s, where, depth) {
    if (s.length <= HELD_JSON_MAX && depth < HELD_JSON_DEPTH) {
      const held = heldJson(s)
      // JSON encoded twice keeps its outer string form, masked within
      if (held !== undefined) return isTwice(s) ? JSON.stringify(toJson(held, where, depth + 1)) : toJson(held, where, depth + 1)""")

# --- name and value pairs, in any of their usual spellings
sub("""  // JSON that never throws: values under secret-looking keys masked (their
  // digests the field's), and so the value of a name and value pair
  // (`{name: 'Authorization', value}`) and the one after a secret-looking
  // name in a list of strings (Node's rawHeaders); JSON held in strings read""", """  // JSON that never throws: values under secret-looking keys masked (their
  // digests the field's), and so the value of a name and value pair
  // (`{name: 'Authorization', value}`, `{Name, Value}`, `{key, value}`,
  // `{k, v}`) and the one after a secret-looking name in a list of strings
  // (Node's rawHeaders); JSON held in strings read""")
sub("""      if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, 'value') && v.value !== null && v.value !== undefined) {
        const name = typeof v.name === 'string' ? v.name : typeof v.key === 'string' ? v.key : null
        if (name !== null && SECRET_NAME.test(name)) return { ...v, value: secret(name, v.value) }
      }""", """      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const pair = pairOf(v)
        if (pair !== null) return { ...v, [pair.value]: secret(pair.name, v[pair.value]) }
      }""")

# --- heldJson: say whether a string was JSON encoded twice
sub("""  const text = value => (typeof value === 'string' ? value : isBytes(value) ? bytesOf(value).toString('base64') : toJson(value))
  // An object or array a string holds as JSON, else undefined. A JSON
  // string that holds one (JSON encoded twice) is read through.""", """  const text = value => (typeof value === 'string' ? value : isBytes(value) ? bytesOf(value).toString('base64') : toJson(value))
  // An object or array a string holds as JSON, else undefined. A JSON
  // string that holds one (JSON encoded twice) is read through; isTwice
  // says which a string heldJson read was.""")
sub("""    if (typeof value === 'string') {
      const held = heldJson(value)
      if (held === undefined) {
        // text, NDJSON's included: kept as text, masked where it must be
        const shown = maskText(value, where, 0)
        return shown.length <= MAX_TEXT ? shown : { t: 'long', s: shown.slice(0, MAX_TEXT), len: shown.length, d: mac(`l:${value}`, 16) }
      }
      value = held
    }
    return cellOfJsonText(toJson(value, where, 0))
  }""", """    if (typeof value === 'string') {
      const held = heldJson(value)
      if (held === undefined) {
        // text, NDJSON's included: kept as text, masked where it must be
        const shown = maskText(value, where, 0)
        return shown.length <= MAX_TEXT ? shown : { t: 'long', s: shown.slice(0, MAX_TEXT), len: shown.length, d: mac(`l:${value}`, 16) }
      }
      // JSON encoded twice says so, so re-encoding a column shows
      if (isTwice(value)) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }
      value = held
    }
    return cellOfJsonText(toJson(value, where, 0))
  }""")

# --- the patterns
sub("""// A key in text: at a word start, maybe quoted (an escaped quote too) or in
// brackets, then ':' or '='. A tag's name: `<password>`. A URL's userinfo.
// An Authorization scheme and its value. Each linear in the text.
const KEY_IN_TEXT = /(?<![\\w.-])(?:\\\\*["'])?([\\w.-]{1,128})(?:\\\\*["'])?\\]?\\s{0,8}[:=]/g
const TAG_IN_TEXT = /<([\\w.-]{1,128})>/g
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\\/\\/)([^\\s/:@]{1,256}):([^\\s/@]{1,256})@/gi
const AUTH_VALUE = /\\b(Bearer|Basic|Token)\\s{1,4}([A-Za-z0-9._~+/=-]{8,})/g
""", """// A key in text: at a word start, maybe quoted (an escaped quote, or one
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
const AUTH_VALUE = /\\b(bearer|basic|token)\\s{1,4}((?=[A-Za-z0-9._~+/=-]{0,1024}\\d)[A-Za-z0-9._~+/=-]{8,}|[A-Za-z0-9._~+/=-]{16,})/gi
// A string JSON encoded twice: a JSON string literal holding an object or
// array.
const isTwice = s => /^\\s*"/.test(s)
// A name and value pair's own keys, in their usual spellings: `name`,
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
}
""")

# --- sanitizeSnapshot: long names, the omitted count, the caps
sub("""// A probe's snapshot as the conductor keeps it: excluded collections gone,
// every value a cell, volatile fields dropped (or kept as whether they are
// set), at most maxRows rows a collection and maxBytes in all (collections
// in name order), each with its true count. A collection with fewer rows
// than its count is truncated. One whose rows don't all have its key
// fields, or share a key, has no key. Anything malformed, or that throws as
// it is read, is a problem, never a throw.
export function sanitizeSnapshot(raw, { masker, rules, limits }) {
  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes, maxCollections = LIMITS.maxCollections } = limits ?? {}
  const problems = []
  const collections = {}
  let names
  let given
  try {
    given = raw?.collections
    if (!given || typeof given !== 'object' || Array.isArray(given)) return { collections, problems: ['the snapshot has no collections object'] }
    names = Object.keys(given).filter(name => !rules.exclude.some(p => globMatch(p, name))).sort()
  } catch (err) {
    return { collections, problems: [`the snapshot could not be read: ${String(err?.message ?? err)}`] }
  }""", """// A probe's snapshot as the conductor keeps it: excluded collections gone,
// every value a cell, volatile fields dropped (or kept as whether they are
// set), at most maxRows rows a collection and maxBytes in all, each with its
// true count. A collection with fewer rows than its count is truncated. One
// whose rows don't all have its key fields, or share a key, has no key.
// Anything malformed, or that throws as it is read, is a problem, never a
// throw. `omitted` counts the collections given but not kept (left out, or
// unreadable), or is null when the snapshot couldn't be read at all: the
// diff then never takes a collection missing from it for added or dropped.
export function sanitizeSnapshot(raw, { masker, rules, limits }) {
  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes, maxCollections = LIMITS.maxCollections } = limits ?? {}
  const problems = []
  const collections = {}
  let names
  let given
  try {
    given = raw?.collections
    if (!given || typeof given !== 'object' || Array.isArray(given)) return { collections, problems: ['the snapshot has no collections object'], omitted: null }
    names = Object.keys(given).filter(name => !rules.exclude.some(p => globMatch(p, name))).sort()
  } catch (err) {
    return { collections, problems: [`the snapshot could not be read: ${String(err?.message ?? err)}`], omitted: null }
  }
  const total = names.length
  // a name longer than MAX_NAME is left out: no answer has to carry it
  const long = names.filter(name => name.length > MAX_NAME).length
  if (long) {
    problems.push(`${long} collection${long === 1 ? '' : 's'} with a name over ${MAX_NAME} characters ${long === 1 ? 'was' : 'were'} left out`)
    names = names.filter(name => name.length <= MAX_NAME)
  }""")
sub("""  for (const name of names) {
    if (kept.has(name)) put(collections, name, kept.get(name))
    else if (counted.has(name)) put(collections, name, counted.get(name))
  }
  return { collections, problems }
}""", """  let n = 0
  for (const name of names) {
    if (kept.has(name)) { put(collections, name, kept.get(name)); n++ } else if (counted.has(name)) { put(collections, name, counted.get(name)); n++ }
  }
  return { collections, problems, omitted: total - n }
}""")

# --- sanitizeCollection: the key and declared fields charged to its bytes, and capped
sub("""  const counted = Number.isSafeInteger(c.count) && c.count >= 0 ? c.count : null
  if (c.truncated === true && counted === null) problems.push(`${name}: truncated without a count`)
  const count = Math.max(counted ?? 0, c.rows.length)
  let truncated = c.truncated === true || c.rows.length > maxRows || count > c.rows.length
  const rows = []
  let size = 0
  let bad = 0""", """  const counted = Number.isSafeInteger(c.count) && c.count >= 0 ? c.count : null
  if (c.truncated === true && counted === null) problems.push(`${name}: truncated without a count`)
  const count = Math.max(counted ?? 0, c.rows.length)
  let truncated = c.truncated === true || c.rows.length > maxRows || count > c.rows.length
  // The key and the declared fields: at most MAX_KEY_FIELDS (else no key)
  // and MAX_FIELDS (else only the count is kept), and charged to the
  // collection's bytes like its rows (else only the count is kept).
  let named = isNames(c.key) ? c.key.filter(f => !drop.has(f)) : []
  if (named.length > MAX_KEY_FIELDS) {
    problems.push(`${name}: a key of ${named.length} fields is more than ${MAX_KEY_FIELDS}, so its rows are compared without one`)
    named = []
  }
  const fields = isNames(c.fields) ? c.fields.filter(f => !drop.has(f)) : null
  const countOnly = { size: 0, collection: { key: null, fields: null, rows: [], count, truncated: true } }
  if (fields && fields.length > MAX_FIELDS) {
    problems.push(`${name}: ${fields.length} declared fields are more than ${MAX_FIELDS}, so it is kept as its count`)
    return countOnly
  }
  let size = sizeOf(named) + sizeOf(fields)
  if (size > budget) {
    problems.push(`${name}: its key and declared fields don't fit its share of the bytes, so it is kept as its count`)
    return countOnly
  }
  const rows = []
  let bad = 0""")
sub("""  if (bad) problems.push(`${name}: ${bad} row${bad === 1 ? ' is' : 's are'} not ${bad === 1 ? 'an object' : 'objects'}`)
  const named = isNames(c.key) ? c.key.filter(f => !drop.has(f)) : []
  const unique = new Set(rows.map(row => keyOf(named, row))).size === rows.length
  const key = named.length > 0 && unique && rows.every(row => named.every(f => Object.hasOwn(row, f))) ? named : null
  const fields = isNames(c.fields) ? c.fields.filter(f => !drop.has(f)) : null
  return { size, collection: { key, fields, rows, count, truncated } }""", """  if (bad) problems.push(`${name}: ${bad} row${bad === 1 ? ' is' : 's are'} not ${bad === 1 ? 'an object' : 'objects'}`)
  const unique = new Set(rows.map(row => keyOf(named, row))).size === rows.length
  const key = named.length > 0 && unique && rows.every(row => named.every(f => Object.hasOwn(row, f))) ? named : null
  return { size, collection: { key, fields, rows, count, truncated } }""")

# --- diffSnapshots: a collection missing from a snapshot that left some out
sub("""// What changed in each collection between two sanitized snapshots of one
// pane. A row is matched by its key; with no key, or a different one, the
// collection is a multiset of rows, and its `key` is null. A collection
// truncated on either side reports only its count: `unknown` when that
// didn't change. A field the collection's declared fields gained or lost is
// named once, not as an update to every row.
export function diffSnapshots(before, after) {
  const collections = {}
  for (const name of namesOf(before.collections, after.collections)) {
    const b = own(before.collections, name)
    const a = own(after.collections, name)
    if (!a) { put(collections, name, changeOf('dropped', b, null, b.key)); continue }
    if (!b) {""", """// What changed in each collection between two sanitized snapshots of one
// pane. A row is matched by its key; with no key, or a different one, the
// collection is a multiset of rows, and its `key` is null. A collection
// truncated on either side reports only its count: `unknown` when that
// didn't change. A field the collection's declared fields gained or lost is
// named once, not as an update to every row. A collection missing from a
// snapshot that left some out (`omitted`) may only have been left out: it
// is `unknown`, truncated, with `omitted` saying which side, never added
// or dropped.
const mayOmit = snapshot => snapshot.omitted !== undefined && snapshot.omitted !== 0
export function diffSnapshots(before, after) {
  const collections = {}
  for (const name of namesOf(before.collections, after.collections)) {
    const b = own(before.collections, name)
    const a = own(after.collections, name)
    if (!a) { put(collections, name, mayOmit(after) ? omittedChange(b, null, 'after') : changeOf('dropped', b, null, b.key)); continue }
    if (!b && mayOmit(before)) { put(collections, name, omittedChange(null, a, 'before')); continue }
    if (!b) {""")
sub("""    truncated: Boolean(b?.truncated || a?.truncated),
    keyLost: false,
  }
}
""", """    truncated: Boolean(b?.truncated || a?.truncated),
    keyLost: false,
    omitted: null,
  }
}

// A collection one snapshot may have left out: its count there is unknown.
function omittedChange(b, a, side) {
  return { ...changeOf('unknown', b, a, null), countBefore: b ? b.count : null, countAfter: a ? a.count : null, truncated: true, omitted: side }
}
""")

# --- divergence: an omitted side is unknown
sub("""      status = life === 'both' ? (status === 'differs' ? 'differs' : 'both') : otherChanged ? 'differs' : life
    }
    put(collections, name, { status, truncated, changes, counts })""", """      status = life === 'both' ? (status === 'differs' ? 'differs' : 'both') : otherChanged ? 'differs' : life
    }
    // a side whose snapshot may have left it out says nothing either way
    if (b?.omitted || p?.omitted) status = 'unknown'
    put(collections, name, { status, truncated, changes, counts })""")
sub("""function countsOf(d) {
  if (!d) return { inserted: 0, updated: 0, deleted: 0 }""", """function countsOf(d) {
  if (!d || d.omitted) return { inserted: 0, updated: 0, deleted: 0 }""")

# --- flags: the JSDoc, the fold, the order
sub("""// - unverified: a collection the PR pane's snapshot cut short where the base
//   pane's didn't, or a cut-short one whose count changed: what happened
//   past the cut can't be seen, so it is never taken for nothing;
// - cleared: a value set before, null, '', [] or {} now, per field.
// `shared` says the base made the same change: the same rows by key (or the
// same rows, without one), with the same fields changed, the same field, or
// for two cut-short collections the same count change, no fewer rows. A
// count stands for rows only when both sides have only counts. A flag is
// amber when it is shared and the session is trusted (`trusted: true`, its
// isolation verdict `isolated`), else red. A cleared field is amber at most.
// A destructive rule's allowDeletes lets a collection's deletes go
// unflagged, not its emptying.""", """// - unverified: a collection the PR pane's snapshot cut short where the base
//   pane's didn't, a cut-short one whose count changed, one a PR snapshot
//   may have left out, or one the base pane's diff has and the PR pane's
//   lacks: what happened past the cut can't be seen, so it is never taken
//   for nothing. One cut short in both panes with no change in count is
//   listed too, amber whatever the trust. Those only the PR pane has (the
//   base pane's diff lacks them) are folded into one flag, with `collection`
//   null, `collections` their number and `names` the first five;
// - cleared: a value set before, null, '', [] or {} now, per field.
// `shared` says the base made the same change: the same rows by key (or the
// same rows, without one), with the same fields changed to the same values,
// the same field, or for two cut-short collections the same count change,
// no fewer rows. A count stands for rows only when both sides have only
// counts. A flag is amber when it is shared and the session is trusted
// (`trusted: true`, its isolation verdict `isolated`), else red; a cleared
// field is amber at most. A destructive rule's allowDeletes lets a
// collection's deletes go unflagged, not its emptying.
// The order: red first; within a severity, collections the base pane has
// before those only the PR pane has; then the destructive kinds before
// unverified and cleared; then by collection, kind and field.""")
sub("""  // cut short in the PR pane only, or cut short with its count changed;
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
  }
  const order = (x, y) => (x.collection < y.collection ? -1 : x.collection > y.collection ? 1 : 0)
    || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind)
    || String(x.field).localeCompare(String(y.field))
  return flags.sort(order)
}""", """  // cut short in the PR pane only, or cut short with its count changed, or
  // maybe left out; cut short in both with no change, only listed, amber.
  // Those the base pane's diff lacks are the PR's own: one flag for them all
  const prOnly = []
  for (const name of Object.keys(prDiff.collections)) {
    const c = own(prDiff.collections, name)
    if (!c.truncated || c.status === 'dropped') continue
    const b = own(baseDiff.collections, name)
    if (b === undefined) { prOnly.push(name); continue }
    const changed = c.countBefore !== c.countAfter
    const shared = !c.omitted && !b.omitted && Boolean(b.truncated) && b.countBefore === c.countBefore && b.countAfter === c.countAfter
    const severity = (b.truncated && !changed) || (trusted === true && shared) ? 'amber' : 'red'
    flags.push({ collection: name, kind: 'unverified', severity, shared, pr: 1, base: b.truncated ? 1 : 0 })
  }
  if (prOnly.length) {
    prOnly.sort()
    flags.push({ collection: null, kind: 'unverified', severity: 'red', shared: false, pr: prOnly.length, base: 0, collections: prOnly.length, names: prOnly.slice(0, 5) })
  }
  // in the base pane's diff, but not the PR pane's: its snapshots don't
  // show it (left out past the counts kept, say)
  for (const name of Object.keys(baseDiff.collections)) {
    if (!Object.hasOwn(prDiff.collections, name)) flags.push({ collection: name, kind: 'unverified', severity: 'red', shared: false, pr: 1, base: 0 })
  }
  const prOwn = f => (f.collection === null || !Object.hasOwn(baseDiff.collections, f.collection) ? 1 : 0)
  const late = f => (f.kind === 'unverified' || f.kind === 'cleared' ? 1 : 0)
  const byName = (x, y) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1)
  const order = (x, y) => (x.severity === y.severity ? 0 : x.severity === 'red' ? -1 : 1)
    || prOwn(x) - prOwn(y)
    || late(x) - late(y)
    || byName(x.collection, y.collection)
    || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind)
    || String(x.field).localeCompare(String(y.field))
  return flags.sort(order)
}""")

# --- tally: an omitted collection says nothing but unverified
sub("""    out.set(name, kinds)
    if (c.status === 'dropped') { add('dropped', null, 1, [name]); continue }""", """    out.set(name, kinds)
    if (c.status === 'dropped') { add('dropped', null, 1, [name]); continue }
    if (c.omitted) continue""")
open(p, 'w').write(s)
print('ok')
