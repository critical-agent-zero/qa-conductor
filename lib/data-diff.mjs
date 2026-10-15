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

import { createHmac } from 'node:crypto'

// What a snapshot may hold: rows per collection, bytes per pane snapshot,
// and how long the inspector may take.
export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000 })
export const SECRET_NAME = /pass|secret|token|salt|hash|otp|api_?key|private|session|card|ssn|iban/i
// The longest a string, or an object's JSON, is kept whole.
const MAX_TEXT = 200
// More than this many rows changed, or this share of a collection of at
// least MASS_MIN_ROWS, is a mass change.
const MASS_ROWS = 20
const MASS_SHARE = 0.2
const MASS_MIN_ROWS = 5

// --- Rules ---------------------------------------------------------------------

const RULE_LISTS = ['exclude', 'volatile', 'classify', 'softDelete', 'destructive']
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
      if (!e || typeof e !== 'object' || !isName(e.collection)) throw new Error(`${name}[${i}].collection must be a collection name`)
      return check(e, `${name}[${i}]`)
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

function globMatch(pattern, name) {
  if (!pattern.includes('*')) return pattern === name
  const re = new RegExp(`^${pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(name)
}
const rulesFor = (list, collection) => list.filter(r => globMatch(r.collection, collection))

// --- Cells ----------------------------------------------------------------------

// A value as a snapshot keeps it, a "cell":
// - null, a boolean, a finite number, or a string of at most MAX_TEXT
//   characters (a bigint becomes its digits, a date its ISO string);
// - { t: 'json', s }: an object or array, as JSON, with any value under a
//   secret-looking key masked;
// - { t: 'long', s, len, d }: a longer string, or JSON, cut, with a digest;
// - { t: 'blob', len, d }: bytes;
// - { t: 'secret', d }: a secret value: only whether it changed shows;
// - { t: 'pii', fp, type, len }: personal data, as a fingerprint.
// A value that isn't set (null, undefined) is null, whatever its field.
// Cells compare equal exactly when their JSON does.
export function createMasker({ key, rules }) {
  const mac = (text, n) => createHmac('sha256', key).update(text).digest('hex').slice(0, n)
  const classOf = (collection, field) => {
    for (const r of rulesFor(rules.classify, collection)) if (r.fields.includes(field)) return r.as
    return SECRET_NAME.test(field) ? 'secret' : null
  }
  // JSON that never throws: a bigint as its digits, values under secret-
  // looking keys masked, and anything unserializable said to be so.
  function toJson(value) {
    const masked = (k, v) => {
      if (typeof v === 'bigint') return v.toString()
      if (k !== '' && SECRET_NAME.test(k) && v !== null && v !== undefined) return `[secret ${mac(`j:${toJson(v)}`, 8)}]`
      return v
    }
    try {
      return JSON.stringify(value, masked) ?? 'null'
    } catch {
      return '"[unserializable]"'
    }
  }
  const isBytes = v => ArrayBuffer.isView(v) || v instanceof ArrayBuffer
  const bytesOf = v => (ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.from(v))
  const text = value => (typeof value === 'string' ? value : isBytes(value) ? bytesOf(value).toString('base64') : toJson(value))
  function plain(value) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'function' || typeof value === 'symbol') return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
    if (isBytes(value)) return { t: 'blob', len: value.byteLength, d: mac(`b:${text(value)}`, 16) }
    const isString = typeof value === 'string'
    const s = isString ? value : toJson(value)
    if (s.length <= MAX_TEXT) return isString ? s : { t: 'json', s }
    return { t: 'long', s: s.slice(0, MAX_TEXT), len: s.length, d: mac(`l:${s}`, 16) }
  }
  function cell(collection, field, value) {
    if (value === null || value === undefined) return null
    const as = classOf(collection, field)
    if (as === 'secret') return { t: 'secret', d: mac(`s:${text(value)}`, 16) }
    if (as === 'pii') {
      const type = Array.isArray(value) ? 'array' : typeof value
      return { t: 'pii', fp: mac(`p:${text(value)}`, 8), type, len: text(value).length }
    }
    return plain(value)
  }
  return { cell }
}

const canon = value => JSON.stringify(value)
const sizeOf = value => Buffer.byteLength(canon(value))
// A value that counts as set: not null, undefined, '', [] or {}.
function isSet(value) {
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}
const isEmptyCell = c => c === null || c === '' || (c?.t === 'json' && (c.s === '[]' || c.s === '{}'))
const isUnsetCell = c => c === null || c === false

// --- Snapshots ------------------------------------------------------------------

// A probe's snapshot as the conductor keeps it: excluded collections gone,
// every value a cell, volatile fields dropped (or kept as whether they are
// set), at most maxRows rows a collection and maxBytes in all (collections
// in name order), each with its true count. A collection whose rows don't
// all have its key fields, or share a key, has none. Anything malformed is a
// problem, never a throw. Collection names keep what the store calls them:
// the harness shows them as text.
export function sanitizeSnapshot(raw, { masker, rules, limits = {} }) {
  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes } = limits
  const problems = []
  const collections = {}
  const given = raw?.collections
  if (!given || typeof given !== 'object' || Array.isArray(given)) return { collections, problems: ['the snapshot has no collections object'] }
  let budget = maxBytes
  for (const name of Object.keys(given).sort()) {
    if (rules.exclude.some(p => globMatch(p, name))) continue
    const c = given[name]
    if (!c || typeof c !== 'object' || !Array.isArray(c.rows)) { problems.push(`${name}: rows must be an array`); continue }
    const volatile = rulesFor(rules.volatile, name)
    const drop = new Set(volatile.filter(r => r.mode === 'ignore').flatMap(r => r.fields))
    const presence = new Set(volatile.filter(r => r.mode === 'presence').flatMap(r => r.fields))
    const rows = []
    let truncated = c.truncated === true || c.rows.length > maxRows
    let bad = 0
    for (const r of c.rows.slice(0, maxRows)) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) { bad++; continue }
      const row = {}
      for (const field of Object.keys(r).sort()) {
        if (drop.has(field)) continue
        row[field] = presence.has(field) ? isSet(r[field]) : masker.cell(name, field, r[field])
      }
      const size = sizeOf(row)
      if (size > budget) { truncated = true; break }
      budget -= size
      rows.push(row)
    }
    if (bad) problems.push(`${name}: ${bad} row${bad === 1 ? ' is' : 's are'} not ${bad === 1 ? 'an object' : 'objects'}`)
    const named = isNames(c.key) ? c.key.filter(f => !drop.has(f)) : []
    const keys = new Set(rows.map(row => keyOf(named, row)))
    const key = named.length > 0 && rows.every(row => named.every(f => Object.hasOwn(row, f))) && keys.size === rows.length ? named : null
    const fields = isNames(c.fields) ? c.fields.filter(f => !drop.has(f)) : null
    const count = Math.max(Number.isSafeInteger(c.count) && c.count >= 0 ? c.count : 0, c.rows.length)
    collections[name] = { key, fields, rows, count, truncated }
  }
  return { collections, problems }
}

// --- Diff -----------------------------------------------------------------------

function keyOf(key, row) {
  return canon(key.map(f => row[f] ?? null))
}

// What changed in each collection between two sanitized snapshots of one
// pane. A row is matched by its key; with no key (or a different one), the
// collection is a multiset of rows. A collection truncated on either side
// reports only its count. A field the collection's declared fields gained or
// lost is named once, not as an update to every row.
export function diffSnapshots(before, after) {
  const names = [...new Set([...Object.keys(before.collections), ...Object.keys(after.collections)])].sort()
  const collections = {}
  for (const name of names) {
    const b = before.collections[name]
    const a = after.collections[name]
    if (!a) { collections[name] = changeOf('dropped', b, null); continue }
    if (!b) {
      const out = changeOf('added', null, a)
      if (!a.truncated) out.inserted = a.rows.map(row => ({ key: a.key ? keyOf(a.key, row) : null, row }))
      collections[name] = out
      continue
    }
    const out = changeOf('same', b, a)
    if (b.fields && a.fields) {
      out.fieldsDropped = b.fields.filter(f => !a.fields.includes(f))
      out.fieldsAdded = a.fields.filter(f => !b.fields.includes(f))
    }
    const schema = new Set([...out.fieldsDropped, ...out.fieldsAdded])
    if (!out.truncated) {
      const key = b.key && a.key && canon(b.key) === canon(a.key) ? b.key : null
      if (key) diffKeyed(out, key, b.rows, a.rows, schema)
      else diffBag(out, b.rows, a.rows)
    }
    const changed = out.inserted.length || out.deleted.length || out.updated.length || schema.size || b.count !== a.count
    if (changed) out.status = 'changed'
    collections[name] = out
  }
  return { collections }
}

function changeOf(status, b, a) {
  return {
    status,
    key: (a ?? b).key,
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
    for (const field of [...new Set([...Object.keys(row), ...Object.keys(next)])].sort()) {
      if (schema.has(field)) continue
      const x = row[field] ?? null
      const y = next[field] ?? null
      if (canon(x) !== canon(y)) fields.push({ field, before: x, after: y })
    }
    if (fields.length) out.updated.push({ key: k, fields })
  }
}

function diffBag(out, beforeRows, afterRows) {
  const bag = rows => {
    const m = new Map()
    for (const row of rows) {
      const c = canon(row)
      m.set(c, [...(m.get(c) ?? []), row])
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
// inserted, updated and deleted rows are compared. A collection's status
// sums its changes up: `same`, `both`, `pr-only`, `base-only` or `differs`.
export function divergence(baseDiff, prDiff) {
  const names = [...new Set([...Object.keys(baseDiff.collections), ...Object.keys(prDiff.collections)])].sort()
  const collections = {}
  for (const name of names) {
    const b = baseDiff.collections[name] ?? null
    const p = prDiff.collections[name] ?? null
    const counts = { base: countsOf(b), pr: countsOf(p) }
    const keyed = b && p && b.key && p.key && canon(b.key) === canon(p.key) && !b.truncated && !p.truncated
    let changes = []
    let status
    if (keyed) {
      changes = [...schemaChanges(b, p), ...keyedChanges(b, p)]
      status = sumUp(changes.map(c => c.status))
    } else {
      status = byCounts(counts)
    }
    const lifecycle = [b?.status, p?.status].some(s => s === 'added' || s === 'dropped')
    if (lifecycle) {
      const life = sideBySide(b?.status === 'added' || b?.status === 'dropped' ? b.status : null, p?.status === 'added' || p?.status === 'dropped' ? p.status : null)
      status = life === 'both' && status === 'differs' ? 'differs' : life
    }
    collections[name] = { status, changes, counts }
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
  const seen = new Set(statuses)
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
// - column-dropped: a declared field gone;
// - mass-change: more than 20 rows updated or deleted, or more than 20% of
//   a collection of at least 5 (or a destructive rule's maxChanged);
// - cleared: a value set before, null, '', [] or {} now (per field).
// Each is red when only the PR did it, and amber when the base did it too
// and the session is trusted. Untrusted (the PR pane may reach the base: its
// isolation verdict isn't `isolated`), the base's changes excuse nothing,
// and each is red. A cleared field is amber at most. A destructive rule's
// allowDeletes lets a collection's deletes go unflagged, not its emptying.
export function flagChanges(baseDiff, prDiff, rules, { trusted }) {
  const base = tally(baseDiff, rules)
  const pr = tally(prDiff, rules)
  const flags = []
  for (const [name, kinds] of pr) {
    for (const [id, { kind, field, n }] of kinds) {
      const baseN = base.get(name)?.get(id)?.n ?? 0
      const severity = kind === 'cleared' || (trusted && baseN > 0) ? 'amber' : 'red'
      flags.push({ collection: name, kind, severity, pr: n, base: baseN, ...(field === null ? {} : { field }) })
    }
  }
  const order = (x, y) => (x.collection < y.collection ? -1 : x.collection > y.collection ? 1 : 0)
    || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind)
    || String(x.field).localeCompare(String(y.field))
  return flags.sort(order)
}

// collection -> `kind` or `kind field` -> { kind, field, n }
function tally(diff, rules) {
  const out = new Map()
  for (const [name, c] of Object.entries(diff.collections)) {
    const rule = rulesFor(rules.destructive, name)[0] ?? { maxChanged: null, allowDeletes: false }
    const soft = new Set(rulesFor(rules.softDelete, name).map(r => r.field))
    const kinds = new Map()
    const add = (kind, n, field = null) => {
      if (!n) return
      const id = field === null ? kind : `${kind} ${field}`
      kinds.set(id, { kind, field, n: (kinds.get(id)?.n ?? 0) + n })
    }
    out.set(name, kinds)
    if (c.status === 'dropped') { add('dropped', 1); continue }
    const hard = c.truncated ? Math.max(0, c.countBefore - c.countAfter) : c.deleted.length
    const softly = c.updated.filter(u => u.fields.some(f => soft.has(f.field) && isUnsetCell(f.before) && !isUnsetCell(f.after))).length
    if (!rule.allowDeletes) add('delete', hard + softly)
    if (c.countBefore > 0 && c.countAfter === 0) add('emptied', 1)
    add('column-dropped', c.fieldsDropped.length)
    const changed = c.updated.length + hard
    const mass = rule.maxChanged !== null
      ? changed > rule.maxChanged
      : changed > MASS_ROWS || (c.countBefore >= MASS_MIN_ROWS && changed > c.countBefore * MASS_SHARE)
    if (mass) add('mass-change', changed)
    for (const u of c.updated) {
      for (const f of u.fields) if (!soft.has(f.field) && !isEmptyCell(f.before) && isEmptyCell(f.after)) add('cleared', 1, f.field)
    }
  }
  return out
}

// Whether a session's base pane can excuse a PR change: only when its
// isolation verdict is `isolated`. Otherwise the comparison is advisory.
export function trustOf(isolation) {
  return isolation?.verdict === 'isolated' ? 'trusted' : 'advisory'
}
