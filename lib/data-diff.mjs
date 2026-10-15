// The data checks' pure engine (#8): what a pane's snapshot keeps, what
// changed between two snapshots of one pane, where the PR pane's changes
// depart from the base pane's, and which of them are destructive. No I/O:
// the conductor takes snapshots through the optional inspector seam and keeps
// them in memory for the session. Exported as ./data-diff, so an inspector's
// author can check their snapshots against it.
//
// Values are shown to the gated harness, masked where they may be secret. A
// field whose name looks secret, or that a rule classifies `secret`, keeps
// only a digest, which says whether it changed. One classified `pii` keeps a
// fingerprint, its type and its length. Digests and fingerprints are HMACs
// under a key made for the session, the same for both panes, so equal
// values compare equal across them, and nothing outlives the session.
//
// Collection and field names are the store's, so any string: every object
// keyed by one is written and read as an own property, so `__proto__` or
// `constructor` is a name like any other.

import { createHmac } from 'node:crypto'

// What a snapshot may hold: rows per collection, bytes per pane snapshot,
// and how long the inspector may take.
export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000 })
export const SECRET_NAME = /pass|pwd|secret|token|salt|hash|otp|api_?key|access_?key|signing_?key|client_?key|private|session|card|cvv|cvc|ssn|iban|authori[sz]ation|bearer|jwt|cookie|credential|signature|dsn|database_?url|(?:^|_)pin(?:_|$)/i
// The longest a string, or an object's JSON, is kept whole.
const MAX_TEXT = 200
// More than this many rows changed, or this share of a collection of at
// least MASS_MIN_ROWS, is a mass change.
const MASS_ROWS = 20
const MASS_SHARE = 0.2
const MASS_MIN_ROWS = 5

const own = (obj, name) => (obj && Object.hasOwn(obj, name) ? obj[name] : undefined)
function put(obj, name, value) {
  Object.defineProperty(obj, name, { value, enumerable: true, writable: true, configurable: true })
  return value
}

// --- Rules ---------------------------------------------------------------------

const RULE_LISTS = ['exclude', 'volatile', 'classify', 'softDelete', 'destructive']
const ENTRY_FIELDS = {
  volatile: ['collection', 'fields', 'mode'],
  classify: ['collection', 'fields', 'as'],
  softDelete: ['collection', 'field'],
  destructive: ['collection', 'maxChanged', 'allowDeletes'],
}
const isName = v => typeof v === 'string' && v.length > 0 && v.length <= 200
const isNames = v => Array.isArray(v) && v.every(isName)

// The inspector's `rules`, checked, with defaults: plain data, every list
// optional. A collection name in a rule matches exactly, or with `*`
// standing for any run of characters.
export function validateRules(rules) {
  if (rules === undefined || rules === null) rules = {}
  if (typeof rules !== 'object' || Array.isArray(rules)) throw new Error('rules must be an object')
  for (const key of Object.keys(rules)) if (!RULE_LISTS.includes(key)) throw new Error(`unknown data rule: ${key}`)
  const exclude = rules.exclude ?? []
  if (!isNames(exclude)) throw new Error('exclude must be an array of collection names')
  const each = (name, check) => {
    const list = rules[name] ?? []
    if (!Array.isArray(list)) throw new Error(`${name} must be an array`)
    return list.map((e, i) => {
      const at = `${name}[${i}]`
      if (!e || typeof e !== 'object' || !isName(e.collection)) throw new Error(`${at}.collection must be a collection name`)
      const stray = Object.keys(e).find(k => !ENTRY_FIELDS[name].includes(k))
      if (stray !== undefined) throw new Error(`${at} has a field no rule has: ${stray}`)
      return check(e, at)
    })
  }
  const fieldsOf = (e, at) => {
    if (!isNames(e.fields)) throw new Error(`${at}.fields must be an array of field names`)
    return [...e.fields]
  }
  return {
    exclude: [...exclude],
    volatile: each('volatile', (e, at) => {
      const fields = fieldsOf(e, at)
      if (e.mode !== undefined && e.mode !== 'ignore' && e.mode !== 'presence') throw new Error(`${at}.mode must be ignore or presence`)
      return { collection: e.collection, fields, mode: e.mode ?? 'ignore' }
    }),
    classify: each('classify', (e, at) => {
      const fields = fieldsOf(e, at)
      if (e.as !== 'secret' && e.as !== 'pii') throw new Error(`${at}.as must be secret or pii`)
      return { collection: e.collection, fields, as: e.as }
    }),
    softDelete: each('softDelete', (e, at) => {
      if (!isName(e.field)) throw new Error(`${at}.field must be a field name`)
      return { collection: e.collection, field: e.field }
    }),
    destructive: each('destructive', (e, at) => {
      if (e.maxChanged !== undefined && !(Number.isSafeInteger(e.maxChanged) && e.maxChanged >= 0)) throw new Error(`${at}.maxChanged must be a non-negative integer`)
      if (e.allowDeletes !== undefined && typeof e.allowDeletes !== 'boolean') throw new Error(`${at}.allowDeletes must be a boolean`)
      return { collection: e.collection, maxChanged: e.maxChanged ?? null, allowDeletes: e.allowDeletes === true }
    }),
  }
}

// Each glob compiled once.
const GLOBS = new Map()
function globMatch(pattern, name) {
  if (!pattern.includes('*')) return pattern === name
  let re = GLOBS.get(pattern)
  if (!re) {
    re = new RegExp(`^${pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's')
    GLOBS.set(pattern, re)
  }
  return re.test(name)
}
const rulesFor = (list, collection) => list.filter(r => globMatch(r.collection, collection))
// A collection's own destructive rule, else the first glob that matches it.
const destructiveRule = (rules, name) => rules.destructive.find(r => r.collection === name)
  ?? rulesFor(rules.destructive, name)[0]
  ?? { maxChanged: null, allowDeletes: false }
const softFields = (rules, name) => new Set(rulesFor(rules.softDelete, name).map(r => r.field))

// --- Cells ----------------------------------------------------------------------

const isBytes = v => ArrayBuffer.isView(v) || v instanceof ArrayBuffer
const bytesOf = v => (ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.from(v))

// A value that counts as set: not null, undefined, '', [] or {}.
function isSet(value) {
  if (value === null || value === undefined || value === '') return false
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (isBytes(value)) return value.byteLength > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

// A value as a snapshot keeps it, a "cell":
// - null, a boolean, a finite number, or a string of at most MAX_TEXT
//   characters (a bigint becomes its digits, a date its ISO string);
// - { t: 'json', s }: an object or array, or a string holding one, as
//   JSON, with any value under a secret-looking key masked;
// - { t: 'long', s, len, d }: a longer string, or JSON, cut, with a digest;
// - { t: 'blob', len, d }: bytes;
// - { t: 'secret', d }: a secret value: only whether it changed shows;
// - { t: 'pii', fp, type, len }: personal data, as a fingerprint.
// A value that isn't set (null, '', [] or {}) is kept as it is, whatever
// its field, so clearing one shows. A softDelete field is never masked.
// Cells compare equal exactly when their JSON does.
export function createMasker({ key, rules }) {
  const mac = (text, n) => createHmac('sha256', key).update(text).digest('hex').slice(0, n)
  const classes = new Map()
  // 'secret', 'pii', 'plain' (a softDelete field) or null. A secret-looking
  // name, or any `secret` rule, wins over `pii`.
  function classOf(collection, field) {
    const id = `${collection}\u0000${field}`
    if (classes.has(id)) return classes.get(id)
    let as = null
    if (softFields(rules, collection).has(field)) as = 'plain'
    else {
      const said = rulesFor(rules.classify, collection).filter(r => r.fields.includes(field)).map(r => r.as)
      as = SECRET_NAME.test(field) || said.includes('secret') ? 'secret' : said.includes('pii') ? 'pii' : null
    }
    classes.set(id, as)
    return as
  }
  // JSON that never throws: values under secret-looking keys masked, bytes
  // as their length, a bigint as its digits, and anything unserializable
  // said to be so.
  function toJson(value) {
    const replacer = function (k, v) {
      const raw = k === '' ? value : this[k]
      if (k !== '' && SECRET_NAME.test(k) && v !== null && v !== undefined) return `[secret ${mac(`j:${toJson(raw)}`, 8)}]`
      if (isBytes(raw)) return `[${raw.byteLength} bytes]`
      if (typeof v === 'bigint') return v.toString()
      return v
    }
    try {
      return JSON.stringify(value, replacer) ?? 'null'
    } catch {
      return '"[unserializable]"'
    }
  }
  const text = value => (typeof value === 'string' ? value : isBytes(value) ? bytesOf(value).toString('base64') : toJson(value))
  // An object or array a string holds as JSON, else undefined.
  function heldJson(s) {
    if (!/^\s*[[{]/.test(s)) return undefined
    try {
      const v = JSON.parse(s)
      return v !== null && typeof v === 'object' ? v : undefined
    } catch {
      return undefined
    }
  }
  function plain(value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'function' || typeof value === 'symbol') return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
    if (isBytes(value)) return { t: 'blob', len: value.byteLength, d: mac(`b:${text(value)}`, 16) }
    if (typeof value === 'string') {
      const held = heldJson(value)
      if (held === undefined) return value.length <= MAX_TEXT ? value : { t: 'long', s: value.slice(0, MAX_TEXT), len: value.length, d: mac(`l:${value}`, 16) }
      value = held
    }
    const s = toJson(value)
    return s.length <= MAX_TEXT ? { t: 'json', s } : { t: 'long', s: s.slice(0, MAX_TEXT), len: s.length, d: mac(`l:${s}`, 16) }
  }
  function cell(collection, field, value) {
    const as = classOf(collection, field)
    if (as === null || as === 'plain' || !isSet(value)) return plain(value)
    if (as === 'secret') return { t: 'secret', d: mac(`s:${collection}\u0000${field}\u0000${text(value)}`, 16) }
    const type = Array.isArray(value) ? 'array' : typeof value
    return { t: 'pii', fp: mac(`p:${text(value)}`, 8), type, len: text(value).length }
  }
  return { cell }
}

const canon = value => JSON.stringify(value)
const sizeOf = value => Buffer.byteLength(canon(value))
const isEmptyCell = c => c === null || c === '' || (c?.t === 'json' && (c.s === '[]' || c.s === '{}'))
// A softDelete field that says "not deleted".
const isUnsetCell = c => c === null || c === false || c === 0 || c === ''

// --- Snapshots ------------------------------------------------------------------

// A probe's snapshot as the conductor keeps it: excluded collections gone,
// every value a cell, volatile fields dropped (or kept as whether they are
// set), at most maxRows rows a collection and maxBytes in all (collections
// in name order), each with its true count. A collection with fewer rows
// than its count is truncated. One whose rows don't all have its key
// fields, or share a key, has no key. Anything malformed, or that throws as
// it is read, is a problem, never a throw.
export function sanitizeSnapshot(raw, { masker, rules, limits }) {
  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes } = limits ?? {}
  const problems = []
  const collections = {}
  let given
  try { given = raw?.collections } catch { given = undefined }
  if (!given || typeof given !== 'object' || Array.isArray(given)) return { collections, problems: ['the snapshot has no collections object'] }
  let budget = maxBytes
  for (const name of Object.keys(given).sort()) {
    if (rules.exclude.some(p => globMatch(p, name))) continue
    try {
      const out = sanitizeCollection(name, own(given, name), { masker, rules, maxRows, budget, problems })
      if (out === null) continue
      budget -= out.size
      put(collections, name, out.collection)
    } catch (err) {
      problems.push(`${name}: could not be read: ${String(err?.message ?? err)}`)
    }
  }
  return { collections, problems }
}

function sanitizeCollection(name, c, { masker, rules, maxRows, budget, problems }) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.rows)) {
    problems.push(`${name}: rows must be an array`)
    return null
  }
  const volatile = rulesFor(rules.volatile, name)
  const drop = new Set(volatile.filter(r => r.mode === 'ignore').flatMap(r => r.fields))
  const presence = new Set(volatile.filter(r => r.mode === 'presence').flatMap(r => r.fields))
  const counted = Number.isSafeInteger(c.count) && c.count >= 0 ? c.count : null
  if (c.truncated === true && counted === null) problems.push(`${name}: truncated without a count`)
  const count = Math.max(counted ?? 0, c.rows.length)
  let truncated = c.truncated === true || c.rows.length > maxRows || count > c.rows.length
  const rows = []
  let size = 0
  let bad = 0
  for (const r of c.rows.slice(0, maxRows)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { bad++; continue }
    const row = {}
    for (const field of Object.keys(r).sort()) {
      if (drop.has(field)) continue
      put(row, field, presence.has(field) ? isSet(r[field]) : masker.cell(name, field, r[field]))
    }
    const bytes = sizeOf(row)
    if (size + bytes > budget) { truncated = true; break }
    size += bytes
    rows.push(row)
  }
  if (bad) problems.push(`${name}: ${bad} row${bad === 1 ? ' is' : 's are'} not ${bad === 1 ? 'an object' : 'objects'}`)
  const named = isNames(c.key) ? c.key.filter(f => !drop.has(f)) : []
  const unique = new Set(rows.map(row => keyOf(named, row))).size === rows.length
  const key = named.length > 0 && unique && rows.every(row => named.every(f => Object.hasOwn(row, f))) ? named : null
  const fields = isNames(c.fields) ? c.fields.filter(f => !drop.has(f)) : null
  return { size, collection: { key, fields, rows, count, truncated } }
}

// --- Diff -----------------------------------------------------------------------

function keyOf(key, row) {
  return canon(key.map(f => own(row, f) ?? null))
}
const namesOf = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()

// What changed in each collection between two sanitized snapshots of one
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
    if (!b) {
      const out = changeOf('added', null, a, a.key)
      if (!a.truncated) out.inserted = a.rows.map(row => ({ key: a.key ? keyOf(a.key, row) : null, row }))
      put(collections, name, out)
      continue
    }
    const key = b.key && a.key && canon(b.key) === canon(a.key) ? b.key : null
    const out = changeOf('same', b, a, key)
    if (b.fields && a.fields) {
      out.fieldsDropped = b.fields.filter(f => !a.fields.includes(f))
      out.fieldsAdded = a.fields.filter(f => !b.fields.includes(f))
    }
    const schema = new Set([...out.fieldsDropped, ...out.fieldsAdded])
    if (out.truncated) {
      out.status = b.count !== a.count || schema.size ? 'changed' : 'unknown'
    } else {
      if (key) diffKeyed(out, key, b.rows, a.rows, schema)
      else diffBag(out, b.rows, a.rows, schema)
      if (out.inserted.length || out.deleted.length || out.updated.length || schema.size || b.count !== a.count) out.status = 'changed'
    }
    put(collections, name, out)
  }
  return { collections }
}

function changeOf(status, b, a, key) {
  return {
    status,
    key,
    inserted: [],
    updated: [],
    deleted: [],
    fieldsDropped: [],
    fieldsAdded: [],
    countBefore: b ? b.count : 0,
    countAfter: a ? a.count : 0,
    truncated: Boolean(b?.truncated || a?.truncated),
  }
}

function diffKeyed(out, key, beforeRows, afterRows, schema) {
  const was = new Map(beforeRows.map(row => [keyOf(key, row), row]))
  const now = new Map(afterRows.map(row => [keyOf(key, row), row]))
  for (const [k, row] of now) if (!was.has(k)) out.inserted.push({ key: k, row })
  for (const [k, row] of was) {
    const next = now.get(k)
    if (!next) { out.deleted.push({ key: k, row }); continue }
    const fields = []
    for (const field of namesOf(row, next)) {
      if (schema.has(field)) continue
      const x = own(row, field) ?? null
      const y = own(next, field) ?? null
      if (canon(x) !== canon(y)) fields.push({ field, before: x, after: y })
    }
    if (fields.length) out.updated.push({ key: k, fields })
  }
}

// Without a key: rows as a multiset, compared without the fields the
// schema gained or lost.
function diffBag(out, beforeRows, afterRows, schema) {
  const shape = row => canon(Object.keys(row).filter(f => !schema.has(f)).map(f => [f, row[f]]))
  const bag = rows => {
    const m = new Map()
    for (const row of rows) {
      const c = shape(row)
      const list = m.get(c)
      if (list) list.push(row)
      else m.set(c, [row])
    }
    return m
  }
  const was = bag(beforeRows)
  const now = bag(afterRows)
  for (const [c, rows] of now) for (const row of rows.slice((was.get(c) ?? []).length)) out.inserted.push({ key: null, row })
  for (const [c, rows] of was) for (const row of rows.slice((now.get(c) ?? []).length)) out.deleted.push({ key: null, row })
}

// --- Divergence -----------------------------------------------------------------

// Where the PR pane's changes depart from the base pane's, collection by
// collection. Matched by key, each change (and each field the schema gained
// or lost) is in both panes alike, the PR's only, the base's only, or
// differs between them. Without a common key, or truncated, the counts of
// inserted, updated and deleted rows are compared, with the schema's
// changes. A collection's status sums its changes up: `same`, `both`,
// `pr-only`, `base-only` or `differs`, or `unknown` for a truncated one
// whose counts show nothing.
export function divergence(baseDiff, prDiff) {
  const collections = {}
  for (const name of namesOf(baseDiff.collections, prDiff.collections)) {
    const b = own(baseDiff.collections, name) ?? null
    const p = own(prDiff.collections, name) ?? null
    const counts = { base: countsOf(b), pr: countsOf(p) }
    const truncated = Boolean(b?.truncated || p?.truncated)
    const keyed = b && p && b.key && p.key && canon(b.key) === canon(p.key) && !truncated
    const schema = b && p ? schemaChanges(b, p) : []
    let changes = schema
    let status
    if (keyed) {
      changes = [...schema, ...keyedChanges(b, p)]
      status = sumUp(changes.map(c => c.status))
    } else {
      status = sumUp([...schema.map(c => c.status), byCounts(counts)])
      if (truncated && status === 'same') status = 'unknown'
    }
    const lifeOf = d => (d?.status === 'added' || d?.status === 'dropped' ? d.status : null)
    const lb = lifeOf(b)
    const lp = lifeOf(p)
    if (lb !== null || lp !== null) {
      const life = sideBySide(lb, lp)
      // the other pane changed what this one dropped or added: they differ
      const otherChanged = life === 'pr-only' ? b?.status === 'changed' : life === 'base-only' ? p?.status === 'changed' : false
      status = life === 'both' ? (status === 'differs' ? 'differs' : 'both') : otherChanged ? 'differs' : life
    }
    put(collections, name, { status, truncated, changes, counts })
  }
  return { collections }
}

function countsOf(d) {
  if (!d) return { inserted: 0, updated: 0, deleted: 0 }
  if (d.truncated) return { inserted: Math.max(0, d.countAfter - d.countBefore), updated: 0, deleted: Math.max(0, d.countBefore - d.countAfter) }
  return { inserted: d.inserted.length, updated: d.updated.length, deleted: d.deleted.length }
}

function byCounts({ base, pr }) {
  const n = c => c.inserted + c.updated + c.deleted
  if (canon(base) === canon(pr)) return n(pr) ? 'both' : 'same'
  if (n(base) === 0) return 'pr-only'
  if (n(pr) === 0) return 'base-only'
  return 'differs'
}

// Two things each pane did (or null, didn't): which pane did it, or whether
// they differ.
function sideBySide(base, pr) {
  if (base === null && pr === null) return 'same'
  if (base === null) return 'pr-only'
  if (pr === null) return 'base-only'
  return base === pr ? 'both' : 'differs'
}

function sumUp(statuses) {
  const seen = new Set(statuses.filter(s => s !== 'same'))
  if (seen.size === 0) return 'same'
  if (seen.has('differs') || (seen.has('pr-only') && seen.has('base-only'))) return 'differs'
  if (seen.has('pr-only')) return 'pr-only'
  if (seen.has('base-only')) return 'base-only'
  return 'both'
}

function schemaChanges(b, p) {
  const out = []
  for (const [kind, list] of [['field-dropped', 'fieldsDropped'], ['field-added', 'fieldsAdded']]) {
    for (const field of [...new Set([...b[list], ...p[list]])].sort()) {
      const status = sideBySide(b[list].includes(field) ? kind : null, p[list].includes(field) ? kind : null)
      out.push({ kind, key: null, field, status, base: null, pr: null })
    }
  }
  return out
}

function keyedChanges(b, p) {
  const changesOf = d => {
    const m = new Map()
    for (const r of d.deleted) m.set(r.key, { kind: 'delete', value: null })
    for (const r of d.inserted) m.set(r.key, { kind: 'insert', value: r.row })
    for (const u of d.updated) m.set(u.key, { kind: 'update', value: u.fields })
    return m
  }
  const bm = changesOf(b)
  const pm = changesOf(p)
  const out = []
  for (const key of [...new Set([...bm.keys(), ...pm.keys()])].sort()) {
    const x = bm.get(key) ?? null
    const y = pm.get(key) ?? null
    const status = sideBySide(x && canon(x), y && canon(y))
    out.push({ kind: (y ?? x).kind, key, status, base: x ? x.value : null, pr: y ? y.value : null })
  }
  return out
}

// --- Flags ----------------------------------------------------------------------

const KINDS = ['delete', 'emptied', 'dropped', 'column-dropped', 'mass-change', 'cleared']

// The PR pane's destructive changes, from its diff and the base pane's over
// the same span:
// - delete: rows gone, or newly soft-deleted (a softDelete field set);
// - emptied: a collection whose count fell to 0;
// - dropped: a collection gone;
// - column-dropped: a declared field gone, per field;
// - mass-change: more than 20 rows updated or deleted, or more than 20% of
//   a collection of at least 5 (or past a destructive rule's maxChanged);
// - cleared: a value set before, null, '', [] or {} now, per field.
// Each is red unless the session is trusted (`trusted: true`, its isolation
// verdict `isolated`) and the base made the same change: the same rows by
// key (or the same rows, without one), the same field, or, for a truncated
// collection, no fewer rows. Then it is amber. A cleared field is amber at
// most. A destructive rule's allowDeletes lets a collection's deletes go
// unflagged, not its emptying.
export function flagChanges(baseDiff, prDiff, rules, { trusted }) {
  const base = tally(baseDiff, rules)
  const pr = tally(prDiff, rules)
  const flags = []
  for (const [name, kinds] of pr) {
    for (const [id, mine] of kinds) {
      const theirs = base.get(name)?.get(id)
      const excused = trusted === true && theirs !== undefined && (mine.items === null || theirs.items === null ? mine.n <= theirs.n : includes(theirs.items, mine.items))
      const severity = mine.kind === 'cleared' || excused ? 'amber' : 'red'
      flags.push({ collection: name, kind: mine.kind, severity, pr: mine.n, base: theirs?.n ?? 0, ...(mine.field === null ? {} : { field: mine.field }) })
    }
  }
  const order = (x, y) => (x.collection < y.collection ? -1 : x.collection > y.collection ? 1 : 0)
    || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind)
    || String(x.field).localeCompare(String(y.field))
  return flags.sort(order)
}

// Whether a multiset holds every item of another.
function includes(all, some) {
  const left = new Map()
  for (const item of all) left.set(item, (left.get(item) ?? 0) + 1)
  for (const item of some) {
    const n = left.get(item) ?? 0
    if (n === 0) return false
    left.set(item, n - 1)
  }
  return true
}

// collection -> `kind` or `kind field` -> { kind, field, n, items }, where
// items name what the change touched (keys, or rows without a key), or are
// null when only a count is known.
function tally(diff, rules) {
  const out = new Map()
  for (const name of Object.keys(diff.collections)) {
    const c = own(diff.collections, name)
    const rule = destructiveRule(rules, name)
    const soft = softFields(rules, name)
    const kinds = new Map()
    const add = (kind, field, n, items) => {
      if (!n) return
      const id = field === null ? kind : `${kind} ${field}`
      const was = kinds.get(id)
      const merged = !was ? items : was.items === null || items === null ? null : [...was.items, ...items]
      kinds.set(id, { kind, field, n: (was?.n ?? 0) + n, items: merged })
    }
    out.set(name, kinds)
    if (c.status === 'dropped') { add('dropped', null, 1, [name]); continue }
    const rowId = r => (r.key !== null ? r.key : canon(r.row))
    const softly = c.updated.filter(u => u.fields.some(f => soft.has(f.field) && isUnsetCell(f.before) && !isUnsetCell(f.after)))
    const hard = c.truncated ? Math.max(0, c.countBefore - c.countAfter) : c.deleted.length
    const gone = c.truncated ? null : [...c.deleted.map(rowId), ...softly.map(u => u.key)]
    if (!rule.allowDeletes) add('delete', null, hard + softly.length, gone)
    if (c.countBefore > 0 && c.countAfter === 0) add('emptied', null, 1, ['emptied'])
    for (const field of c.fieldsDropped) add('column-dropped', field, 1, [field])
    const changed = c.updated.length + hard
    const mass = rule.maxChanged !== null
      ? changed > rule.maxChanged
      : changed > MASS_ROWS || (c.countBefore >= MASS_MIN_ROWS && changed > c.countBefore * MASS_SHARE)
    if (mass) add('mass-change', null, changed, c.truncated ? null : [...c.updated.map(u => u.key), ...c.deleted.map(rowId)])
    for (const u of c.updated) {
      for (const f of u.fields) if (!soft.has(f.field) && !isEmptyCell(f.before) && isEmptyCell(f.after)) add('cleared', f.field, 1, [u.key])
    }
  }
  return out
}

// Whether a session's base pane can excuse a PR change: only when its
// isolation verdict is `isolated`. Otherwise the comparison is advisory.
// flagChanges takes it as `trusted: trustOf(isolation) === 'trusted'`.
export function trustOf(isolation) {
  return isolation?.verdict === 'isolated' ? 'trusted' : 'advisory'
}
