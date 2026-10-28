// Every string literal in the data-diff tests (both heads), and every
// object literal row that parses, as a cell at 7193877 and at 4a284f9: any
// word of 6+ characters hidden at the old head and shown at the new one is
// a candidate un-masking.
import { readFileSync } from 'node:fs'
import * as NEW from './new/data-diff.mjs'
import * as OLD from './old/data-diff.mjs'

const KEY = Buffer.alloc(32, 7)
const mk = lib => {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  return (field, v) => JSON.stringify(lib.sanitizeSnapshot({ collections: { c: { key: ['id'], rows: [{ id: 1, [field]: v }] } } }, { masker, rules }).collections.c.rows[0][field])
}
const o = mk(OLD)
const n = mk(NEW)
const literals = new Set()
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){4,})'|"((?:[^"\\\n]|\\.){4,})"|`((?:[^`\\$]|\\.){4,})`/g)) {
    const raw = m[1] ?? m[2] ?? m[3]
    try { literals.add(m[1] !== undefined ? JSON.parse('"' + raw.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"') : m[2] !== undefined ? JSON.parse('"' + raw + '"') : raw) } catch { literals.add(raw) }
  }
}
let n1 = 0
let hits = 0
for (const s of literals) {
  for (const field of ['note', 'data']) {
    n1++
    const a = o(field, s)
    const b = n(field, s)
    if (a === b) continue
    const words = [...new Set(s.match(/[A-Za-z0-9_+/=.-]{6,}/g) ?? [])]
    const shown = words.filter(w => !a.includes(w) && b.includes(w))
    if (shown.length) { hits++; console.log(`CANDIDATE ${JSON.stringify(s).slice(0, 120)}\n  shown now: ${shown.join(', ')}\n  old ${a.slice(0, 120)}\n  new ${b.slice(0, 120)}`) }
  }
}
console.log(`${literals.size} literals, ${n1} cells, ${hits} candidates`)
