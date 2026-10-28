// Differential harness: loads lib/data-diff.mjs at each head and masks the
// same values through sanitizeSnapshot.
const D = new URL('.', import.meta.url).pathname
export const HEAD_NAMES = (process.env.HEADS ?? '2ec0bba,7193877,4a284f9,4ed6449,4033285').split(',')
export const NEW = process.env.NEW ?? '4033285'
export const OLD = HEAD_NAMES.filter(h => h !== NEW)
const KEY = Buffer.alloc(32, 7)

export const heads = {}
export const uncut = {}
for (const name of HEAD_NAMES) {
  for (const [dir, into] of [['heads', heads], ['uncut', uncut]]) {
    const mod = await import(`${D}${dir}/${name}/lib/data-diff.mjs`)
    const rules = mod.validateRules({})
    into[name] = { name, mod, rules, masker: mod.createMasker({ key: KEY, rules }) }
  }
}
// MAX_TEXT raised to 1e9: what masking alone shows, without the 200-character cut
export function maskUncut(values, opts = {}) { return maskValues(values, { ...opts, set: uncut }) }

// values in field `field` of collection `c` (no key), one row each; returns
// the JSON of each row's cell, per head
export function maskValues(values, opts = {}) {
  if (values.length > 4000) {
    const out = {}
    for (let i = 0; i < values.length; i += 4000) {
      const part = maskValues(values.slice(i, i + 4000), opts)
      for (const [h, list] of Object.entries(part)) (out[h] ??= []).push(...list)
    }
    return out
  }
  return maskBatch(values, opts)
}
function maskBatch(values, { field = 'note', collection = 'c', heads: which = HEAD_NAMES, set = heads } = {}) {
  const out = {}
  for (const h of which) {
    const { mod, rules, masker } = set[h]
    const rows = values.map((v, i) => ({ id: i, [field]: v }))
    const snap = mod.sanitizeSnapshot({ collections: { [collection]: { key: ['id'], rows } } }, { masker, rules })
    const kept = snap.collections[collection]?.rows ?? []
    if (kept.length !== values.length) throw new Error(`${h}: kept ${kept.length} of ${values.length} rows: ${snap.problems.join('; ')}`)
    out[h] = kept.map(r => JSON.stringify(r[field]))
  }
  return out
}

// whole rows, collection key `key`; returns JSON of each kept row per head
export function maskRows(rowsIn, { key = null, collection = 'c', heads: which = HEAD_NAMES, set = heads } = {}) {
  const out = {}
  for (const h of which) {
    const { mod, rules, masker } = set[h]
    const snap = mod.sanitizeSnapshot({ collections: { [collection]: { key, rows: rowsIn } } }, { masker, rules })
    out[h] = (snap.collections[collection]?.rows ?? []).map(r => JSON.stringify(r))
  }
  return out
}

// Which fragments show in an output.
export const leaked = (out, frags) => frags.filter(f => out.includes(f))
