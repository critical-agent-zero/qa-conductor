// The data checks' pure engine (#8): what a pane's snapshot keeps, what
// changed between two snapshots of one pane, where the PR pane's changes
// depart from the base pane's, and which of them are destructive. No I/O:
// the conductor (lib/server.mjs) takes snapshots through the inspector seam
// and keeps them in memory for the session. Exported as ./data-diff, so an
// inspector's author can test their snapshots against it.
//
// Values are shown to the gated harness (owner decision B), masked where
// they may be secret: a field whose name looks secret, or that a rule
// classifies `secret`, keeps only a digest, so the harness can say it
// changed; one classified `pii` keeps a fingerprint, its type and its
// length. Digests and fingerprints are HMACs under a key made for the
// session, the same for both panes, so equal values compare equal across
// them and nothing outlives the session.

import { createHmac } from 'node:crypto'

export const LIMITS = Object.freeze({ maxRows: 10_000, maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000 })
export const SECRET_NAME = /pass|secret|token|salt|hash|otp|api_?key|private|session|card|ssn|iban/i
// The longest a string (or an object's JSON) is kept whole.
const MAX_TEXT = 200

// --- Rules ------------------------------------------------------------------------

const RULE_LISTS = ['exclude', 'volatile', 'classify', 'softDelete', 'destructive']
const isName = v => typeof v === 'string' && v.length > 0 && v.length <= 200
const isNames = v => Array.isArray(v) && v.every(isName)

// The inspector's `rules`, checked and with defaults: plain data, every list
// optional. Collection names match exactly, or with `*` standing for any
// run of characters.
export function validateRules(rules) {
  if (rules === undefined || rules === null) rules = {}
  if (typeof rules !== 'object' || Array.isArray(rules)) throw new Error('rules must be an object')
  for (const key of Object.keys(rules)) if (!RULE_LISTS.includes(key)) throw new Error(`unknown data rule: ${key}`)
  const list = name => {
    const v = rules[name] ?? []
    if (!Array.isArray(v)) throw new Error(`${name} must be an array`)
    return v
  }
  const exclude = rules.exclude ?? []
  if (!isNames(exclude)) throw new Error('exclude must be an array of collection names')
  const entry = (name, i, e, check) => {
    if (!e || typeof e !== 'object' || !isName(e.collection)) throw new Error(`${name}[${i}].collection must be a collection name`)
    check(e)
  }
  const volatile = list('volatile').map((e, i) => {
    entry('volatile', i, e, () => {
      if (!isNames(e.fields)) throw new Error(`volatile[${i}].fields must be an array of field names`)
      if (e.mode !== undefined && e.mode !== 'ignore' && e.mode !== 'presence') throw new Error(`volatile[${i}].mode must be ignore or presence`)
    })
    return { collection: e.collection, fields: [...e.fields], mode: e.mode ?? 'ignore' }
  })
  const classify = list('classify').map((e, i) => {
    entry('classify', i, e, () => {
      if (!isNames(e.fields)) throw new Error(`classify[${i}].fields must be an array of field names`)
      if (e.as !== 'secret' && e.as !== 'pii') throw new Error(`classify[${i}].as must be secret or pii`)
    })
    return { collection: e.collection, fields: [...e.fields], as: e.as }
  })
  const softDelete = list('softDelete').map((e, i) => {
    entry('softDelete', i, e, () => { if (!isName(e.field)) throw new Error(`softDelete[${i}].field must be a field name`) })
    return { collection: e.collection, field: e.field }
  })
  const destructive = list('destructive').map((e, i) => {
    entry('destructive', i, e, () => {
      if (e.maxChanged !== undefined && !(Number.isSafeInteger(e.maxChanged) && e.maxChanged >= 0)) throw new Error(`destructive[${i}].maxChanged must be a non-negative integer`)
      if (e.allowDeletes !== undefined && typeof e.allowDeletes !== 'boolean') throw new Error(`destructive[${i}].allowDeletes must be a boolean`)
    })
    return { collection: e.collection, maxChanged: e.maxChanged ?? null, allowDeletes: e.allowDeletes === true }
  })
  return { exclude: [...exclude], volatile, classify, softDelete, destructive }
}

function globMatch(pattern, name) {
  if (!pattern.includes('*')) return pattern === name
  const re = new RegExp(`^${pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(name)
}
const rulesFor = (list, collection) => list.filter(r => globMatch(r.collection, collection))

// --- Cells ------------------------------------------------------------------------

// A value as a snapshot keeps it, a "cell": null, a boolean, a finite number,
// a string of at most MAX_TEXT characters, or a tagged object:
// { t: 'json', s } an object or array, as JSON;
// { t: 'long', s, len, d } a longer string (or JSON), cut, with a digest;
// { t: 'secret', d } a secret value: only whether it changed is shown;
// { t: 'pii', fp, type, len } personal data: a fingerprint.
// Cells compare equal exactly when their canonical JSON does.
export function createMasker({ key, rules }) {
  const mac = (text, n) => createHmac('sha256', key).update(text).digest('hex').slice(0, n)
  const classOf = (collection, field) => {
    for (const r of rulesFor(rules.classify, collection)) if (r.fields.includes(field)) return r.as
    return SECRET_NAME.test(field) ? 'secret' : null
  }
  const text = value => (typeof value === 'string' ? value : JSON.stringify(value) ?? 'null')
  function plain(value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    const isString = typeof value === 'string'
    const s = isString ? value : JSON.stringify(value) ?? null
    if (s === null) return null
    if (s.length <= MAX_TEXT) return isString ? s : { t: 'json', s }
    return { t: 'long', s: s.slice(0, MAX_TEXT), len: s.length, d: mac(s, 16) }
  }
  function cell(collection, field, value) {
    const as = classOf(collection, field)
    if (as === 'secret') return { t: 'secret', d: mac(`s:${text(value)}`, 16) }
    if (as === 'pii') {
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
      return { t: 'pii', fp: mac(`p:${text(value)}`, 8), type, len: text(value).length }
    }
    return plain(value)
  }
  return { cell }
}

const canon = value => JSON.stringify(value)
const sizeOf = value => Buffer.byteLength(canon(value))

// --- Snapshots --------------------------------------------------------------------

// What a probe returned, as the conductor keeps it: excluded collections
// gone, every value a cell, volatile fields dropped (or kept as whether
// they are set), at most limits.maxRows rows a collection and maxBytes in
// all, with each collection's true count. Anything malformed becomes a
// problem, never a throw.
export function sanitizeSnapshot(raw, { masker, rules, limits = {} }) {
  const { maxRows = LIMITS.maxRows, maxBytes = LIMITS.maxBytes } = limits
  const problems = []
  const collections = {}
  const given = raw && typeof raw === 'object' && raw.collections && typeof raw.collections === 'object' && !Array.isArray(raw.collections) ? raw.collections : null
  if (given === null) return { collections, problems: ['the snapshot has no collections object'] }
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
    for (const r of c.rows.slice(0, maxRows)) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) { problems.push(`${name}: a row isn't an object`); continue }
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
    const declaredKey = isNames(c.key) && c.key.length > 0 ? c.key.filter(f => !drop.has(f)) : null
    const key = declaredKey && declaredKey.length > 0 && rows.every(row => declaredKey.every(f => Object.hasOwn(row, f))) ? declaredKey : null
    const fields = isNames(c.fields) ? c.fields.filter(f => !drop.has(f)) : null
    const count = Math.max(Number.isSafeInteger(c.count) && c.count >= 0 ? c.count : 0, c.rows.length)
    collections[name] = { key, fields, rows, count, truncated }
  }
  return { collections, problems }
}

// Whether a value counts as set: not null, '', [] or {}.
function isSet(value) {
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}
const cellIsEmpty = cell => cell === null || cell === '' || cell === false && false || (cell && cell.t === 'json' && (cell.s === '[]' || cell.s === '{}'))

// --- Diff -------------------------------------------------------------------------

const keyOf = (key, row) => canon(key.map(f => row[f] ?? null))

// What changed in each collection between two sanitized snapshots of one
// pane. A row is matched by its key; with no key, the collection is a bag
// of rows. A collection truncated on either side reports only its count.
export function diffSnapshots(before, after) {
  const names = [...new Set([...Object.keys(before.collections), ...Object.keys(after.collections)])].sort()
  const collections = {}
  for (const name of names) {
    const b = before.collections[name]
    const a = after.collections[name]
    if (!a) { collections[name] = changeOf('dropped', b, null); continue }
    if (!b) {
      collections[name] = { ...changeOf('added', null, a), inserted: a.truncated ? [] : a.rows.map(row => ({ key: a.key ? keyOf(a.key, row) : null, row })) }
      continue
    }
    const fieldsDropped = b.fields && a.fields ? b.fields.filter(f => !a.fields.includes(f)) : []
    const out = { ...changeOf('same', b, a), fieldsDropped }
    if (b.truncated || a.truncated) {
      out.truncated = true
      if (b.count !== a.count || fieldsDropped.length) out.status = 'changed'
      collections[name] = out
      continue
    }
    const key = b.key && a.key && canon(b.key) === canon(a.key) ? b.key : null
    if (key) {
      const was = new Map(b.rows.map(row => [keyOf(key, row), row]))
      const now = new Map(a.rows.map(row => [keyOf(key, row), row]))
      for (const [k, row] of now) if (!was.has(k)) out.inserted.push({ key: k, row })
      for (const [k, row] of was) if (!now.has(k)) out.deleted.push({ key: k, row })
      for (const [k, row] of was) {
        const next = now.get(k)
        if (!next) continue
        const fields = []
        for (const field of [...new Set([...Object.keys(row), ...Object.keys(next)])].sort()) {
          if (fieldsDropped.includes(field)) continue
          const x = row[field] ?? null
          const y = next[field] ?? null
          if (canon(x) !== canon(y)) fields.push({ field, before: x, after: y })
        }
        if (fields.length) out.updated.push({ key: k, fields })
      }
    } else {
      const bag = rows => {
        const m = new Map()
        for (const row of rows) { const c = canon(row); m.set(c, [...(m.get(c) ?? []), row]) }
        return m
      }
      const was = bag(b.rows)
      const now = bag(a.rows)
      for (const [c, rows] of now) for (const row of rows.slice((was.get(c) ?? []).length)) out.inserted.push({ key: null, row })
      for (const [c, rows] of was) for (const row of rows.slice((now.get(c) ?? []).length)) out.deleted.push({ key: null, row })
    }
    if (out.inserted.length || out.deleted.length || out.updated.length || fieldsDropped.length || b.count !== a.count) out.status = 'changed'
    collections[name] = out
  }
  return { collections }
}

function changeOf(status, b, a) {
  return {
    status, key: (a ?? b).key, inserted: [], updated: [], deleted: [], fieldsDropped: [],
    countBefore: b ? b.count : 0, countAfter: a ? a.count : 0, truncated: Boolean(b?.truncated || a?.truncated),
  }
}

// --- Divergence ---------------------------------------------------------------------

const ORDER = ['same', 'both', 'base-only', 'pr-only', 'differs']

// Where the PR pane's changes depart from the base pane's, collection by
// collection: each change, by key, is in both panes alike, the PR's only,
// the base's only, or differs between them. Without a key, the inserted
// and deleted counts are compared.
export function divergence(baseDiff, prDiff) {
  const names = [...new Set([...Object.keys(baseDiff.collections), ...Object.keys(prDiff.collections)])].sort()
  const collections = {}
  for (const name of names) {
    const b = baseDiff.collections[name] ?? null
    const p = prDiff.collections[name] ?? null
    const counts = { base: countsOf(b), pr: countsOf(p) }
    const keyed = (b?.key ?? p?.key) && !(b?.truncated || p?.truncated)
    if (!keyed) {
      const status = b?.status === 'dropped' || p?.status === 'dropped' || b?.status === 'added' || p?.status === 'added'
        ? statusOf(b?.status ?? 'same', p?.status ?? 'same')
        : canon(counts.base) === canon(counts.pr) ? (counts.pr.inserted + counts.pr.deleted ? 'both' : 'same') : 'differs'
      collections[name] = { status, changes: [], counts }
      continue
    }
    const changesOf = d => {
      const m = new Map()
      if (!d) return m
      for (const r of d.deleted) m.set(r.key, { kind: 'delete', key: r.key, value: null })
      for (const r of d.inserted) m.set(r.key, { kind: 'insert', key: r.key, value: r.row })
      for (const u of d.updated) m.set(u.key, { kind: 'update', key: u.key, value: u.fields })
      return m
    }
    const bm = changesOf(b)
    const pm = changesOf(p)
    const changes = []
    for (const k of [...new Set([...bm.keys(), ...pm.keys()])].sort()) {
      const x = bm.get(k)
      const y = pm.get(k)
      const status = !x ? 'pr-only' : !y ? 'base-only' : x.kind === y.kind && canon(x.value) === canon(y.value) ? 'both' : 'differs'
      changes.push({ kind: (y ?? x).kind, key: k, status, base: x ? x.value : null, pr: y ? y.value : null })
    }
    let status = changes.length ? 'both' : 'same'
    const seen = new Set(changes.map(c => c.status))
    if (seen.has('differs') || (seen.has('pr-only') && seen.has('base-only'))) status = 'differs'
    else if (seen.has('pr-only')) status = 'pr-only'
    else if (seen.has('base-only')) status = 'base-only'
    if (b?.status === 'dropped' || p?.status === 'dropped') status = statusOf(b?.status ?? 'same', p?.status ?? 'same')
    collections[name] = { status, changes, counts }
  }
  return { collections }
}

const countsOf = d => ({ inserted: d ? Math.max(d.inserted.length, d.truncated ? Math.max(0, d.countAfter - d.countBefore) : 0) : 0, deleted: d ? Math.max(d.deleted.length, d.truncated ? Math.max(0, d.countBefore - d.countAfter) : 0) : 0 })

function statusOf(base, pr) {
  if (base === pr) return base === 'same' ? 'same' : 'both'
  if (base === 'same') return 'pr-only'
  if (pr === 'same') return 'base-only'
  return 'differs'
}
void ORDER

// --- Flags -----------------------------------------------------------------------

const KINDS = ['delete', 'emptied', 'dropped', 'column-dropped', 'mass-change', 'cleared']

// The PR pane's destructive changes, each red when only the PR did it and
// amber when the base did it too. When the session isn't trusted (the PR
// pane may reach the base: its isolation verdict isn't `isolated`), the
// base's changes excuse nothing, and every destructive one is red. A
// cleared field is amber at most.
export function flagChanges(baseDiff, prDiff, rules, { trusted }) {
  const tally = d => {
    const out = new Map() // collection -> kind -> { n, fields? }
    for (const [name, c] of Object.entries(d.collections)) {
      const rule = rulesFor(rules.destructive, name)[0] ?? { maxChanged: null, allowDeletes: false }
      const soft = rulesFor(rules.softDelete, name).map(r => r.field)
      const kinds = new Map()
      const add = (kind, n, field) => {
        if (!n) return
        const k = field ? `${kind}:${field}` : kind
        kinds.set(k, { kind, field: field ?? null, n: (kinds.get(k)?.n ?? 0) + n })
      }
      if (c.status === 'dropped') { add('dropped', 1); out.set(name, kinds); continue }
      const softDeleted = c.updated.filter(u => u.fields.some(f => soft.includes(f.field) && f.before === null && f.after !== null)).length
      const deletes = (c.truncated ? Math.max(0, c.countBefore - c.countAfter) : c.deleted.length) + softDeleted
      if (!rule.allowDeletes) add('delete', deletes)
      if (c.countBefore > 0 && c.countAfter === 0) add('emptied', 1)
      add('column-dropped', c.fieldsDropped.length)
      const changed = c.updated.length + c.deleted.length
      const mass = rule.maxChanged !== null ? changed > rule.maxChanged : changed > 20 || (c.countBefore >= 5 && changed > c.countBefore * 0.2)
      if (mass) add('mass-change', changed)
      for (const u of c.updated) {
        for (const f of u.fields) if (f.before !== null && !cellIsEmpty(f.before) && cellIsEmpty(f.after) && !soft.includes(f.field)) add('cleared', 1, f.field)
      }
      out.set(name, kinds)
    }
    return out
  }
  const base = tally(baseDiff)
  const pr = tally(prDiff)
  const flags = []
  for (const [name, kinds] of pr) {
    for (const { kind, field, n } of kinds.values()) {
      const baseN = base.get(name)?.get(field ? `${kind}:${field}` : kind)?.n ?? 0
      const severity = kind === 'cleared' ? 'amber' : !trusted || baseN === 0 ? 'red' : 'amber'
      flags.push({ collection: name, kind, severity, pr: n, base: baseN, ...(field ? { field } : {}) })
    }
  }
  return flags.sort((x, y) => (x.collection < y.collection ? -1 : x.collection > y.collection ? 1 : KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind) || String(x.field).localeCompare(String(y.field))))
}

// Whether a session's base-vs-PR comparison can excuse a PR change: only
// when its isolation verdict is `isolated` (#29). Otherwise it is advisory.
export function trustOf(isolation) {
  return isolation?.verdict === 'isolated' ? 'trusted' : 'advisory'
}
