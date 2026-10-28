p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo/lib/data-diff.mjs'
s = open(p).read()

old_name = s[s.index("export const SECRET_NAME = "):s.index("\n", s.index("export const SECRET_NAME = "))]
new_name = ("export const SECRET_NAME = /pass|pwd|secret|token|salt|hash|otp|api[-_]?key|access[-_]?key|signing[-_]?key|client[-_]?key|"
            "encryption[-_]?key|master[-_]?key|private|session|card|cvv|cvc|ssn|iban|authori[sz]ation|bearer|jwt|cookie|credential|"
            "signature|dsn|database[-_]?ur[il]|mongo[-_]?ur[il]|connection[-_]?string|mnemonic|seed[-_]?phrase|recovery[-_]?code|"
            "pin[-_]?code|(?:^|[-_])pin(?:[-_]|$)/i")
s = s.replace(old_name, new_name, 1)

a = "// The longest a string, or an object's JSON, is kept whole.\nconst MAX_TEXT = 200"
b = ("// The longest a string, or an object's JSON, is kept whole.\nconst MAX_TEXT = 200\n"
     "// The longest string read as JSON, and how deep JSON held in strings is\n"
     "// read: past either, a string is kept as text, masked whole if a\n"
     "// secret-looking key shows in it.\nconst HELD_JSON_MAX = 256 * 1024\nconst HELD_JSON_DEPTH = 3\n"
     "// How many collections' classes the masker remembers before it starts again.\nconst CLASS_CACHE = 1_000")
assert a in s
s = s.replace(a, b, 1)

start = s.index("export function createMasker({ key, rules }) {")
end = s.index("  return { cell }\n}", start) + len("  return { cell }\n}")
new = r'''export function createMasker({ key, rules }) {
  const mac = (text, n) => createHmac('sha256', key).update(text).digest('hex').slice(0, n)
  // collection -> field -> class, for at most CLASS_CACHE collections:
  // collection and field names are the store's, and a PR's can be many
  const classes = new Map()
  // 'secret', 'pii', 'plain' (a softDelete field) or null. A secret-looking
  // name, or any `secret` rule, wins over `pii`.
  function classOf(collection, field) {
    let fields = classes.get(collection)
    if (!fields) {
      if (classes.size >= CLASS_CACHE) classes.clear()
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
    if (fields.known.size < 10_000) fields.known.set(field, as)
    return as
  }
  // A secret-looking key somewhere in text that isn't (or can't be read as)
  // JSON: `"password": …`, `api_key=…`.
  const secretKeyIn = s => {
    for (const m of s.matchAll(/["']?([A-Za-z0-9_.-]{1,64})["']?\s*[:=]/g)) if (SECRET_NAME.test(m[1])) return true
    return false
  }
  // A string as kept inside JSON (or as a cell): JSON it holds is read and
  // masked too, up to HELD_JSON_DEPTH deep and HELD_JSON_MAX long, line by
  // line for NDJSON; text that can't be read so, but shows a secret-looking
  // key, is masked whole.
  function maskText(s, where, depth) {
    if (s.length <= HELD_JSON_MAX && depth < HELD_JSON_DEPTH) {
      const held = heldJson(s)
      if (held !== undefined) return toJson(held, where, depth + 1)
      if (s.includes('\n')) {
        const lines = s.split('\n')
        if (lines.some(line => heldJson(line) !== undefined)) return lines.map(line => maskText(line, where, depth)).join('\n')
      }
    }
    return secretKeyIn(s) ? `[text with a secret-looking key, ${s.length} characters, ${mac(`t:${where}\u0000${s}`, 8)}]` : s
  }
  // JSON that never throws: values under secret-looking keys masked (their
  // digests the field's), JSON held in strings read and masked, bytes as
  // their length, a bigint as its digits, a Set or a Map as its entries, and
  // anything unserializable said to be so.
  function toJson(value, where = '', depth = 0) {
    const replacer = function (k, v) {
      const raw = k === '' ? value : this[k]
      if (k !== '' && SECRET_NAME.test(k) && v !== null && v !== undefined) return `[secret ${mac(`j:${where}\u0000${k}\u0000${toJson(raw, where, HELD_JSON_DEPTH)}`, 8)}]`
      if (isBytes(raw)) return `[${raw.byteLength} bytes]`
      if (raw instanceof Set || raw instanceof Map) return [...raw]
      if (typeof v === 'bigint') return v.toString()
      if (typeof v === 'string' && k !== '') return maskText(v, where, depth)
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
    if (s.length > HELD_JSON_MAX || !/^\s*[[{]/.test(s)) return undefined
    try {
      const v = JSON.parse(s)
      return v !== null && typeof v === 'object' ? v : undefined
    } catch {
      return undefined
    }
  }
  function plain(value, where) {
    if (value === null || value === undefined) return null
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'function' || typeof value === 'symbol') return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
    if (isBytes(value)) return { t: 'blob', len: value.byteLength, d: mac(`b:${text(value)}`, 16) }
    if (typeof value === 'string') {
      const held = heldJson(value)
      if (held === undefined) {
        const shown = maskText(value, where, 0)
        if (shown !== value && !shown.startsWith('[text with')) return cellOfJsonText(shown)
        return shown.length <= MAX_TEXT ? shown : { t: 'long', s: shown.slice(0, MAX_TEXT), len: shown.length, d: mac(`l:${value}`, 16) }
      }
      value = held
    }
    return cellOfJsonText(toJson(value, where, 0))
  }
  const cellOfJsonText = s => (s.length <= MAX_TEXT ? { t: 'json', s } : { t: 'long', s: s.slice(0, MAX_TEXT), len: s.length, d: mac(`l:${s}`, 16) })
  function cell(collection, field, value) {
    const as = classOf(collection, field)
    if (as === null || as === 'plain' || !isSet(value)) return plain(value, `${collection}\u0000${field}`)
    if (as === 'secret') return { t: 'secret', d: mac(`s:${collection}\u0000${field}\u0000${text(value)}`, 16) }
    const type = Array.isArray(value) ? 'array' : typeof value
    return { t: 'pii', fp: mac(`p:${text(value)}`, 8), type, len: text(value).length }
  }
  return { cell }
}'''
s = s[:start] + new + s[end:]
open(p, 'w').write(s)
print('ok')
