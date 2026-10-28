// Every string literal in the data-diff tests (the given files), as a cell
// in a neutral field, at 7193877, 4a284f9 and 4ed6449: a word of 6+
// characters hidden at either earlier head and shown at 4ed6449 is a
// candidate un-masking.
import { readFileSync } from 'node:fs'
import { M } from './h.mjs'

const literals = new Set()
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){4,})'|"((?:[^"\\\n]|\\.){4,})"|`((?:[^`\\$]|\\.){4,})`/g)) {
    const raw = m[1] ?? m[2] ?? m[3]
    try { literals.add(m[1] !== undefined ? JSON.parse('"' + raw.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"') : m[2] !== undefined ? JSON.parse('"' + raw + '"') : raw) } catch { literals.add(raw) }
  }
}
let cells = 0
let hits = 0
for (const s of literals) {
  for (const field of ['note', 'data']) {
    cells++
    const o = M['7193877'].cell(s, field)
    const a = M['4a284f9'].cell(s, field)
    const n = M['4ed6449'].cell(s, field)
    if (n === a && n === o) continue
    const words = [...new Set(s.match(/[A-Za-z0-9_+/=.-]{6,}/g) ?? [])]
    const shown = words.filter(w => (!o.includes(w) || !a.includes(w)) && n.includes(w))
    if (shown.length) { hits++; console.log(`CANDIDATE ${JSON.stringify(s).slice(0, 140)}\n  shown now: ${shown.join(', ')}\n  7193877 ${o.slice(0, 140)}\n  4a284f9 ${a.slice(0, 140)}\n  4ed6449 ${n.slice(0, 140)}`) }
  }
}
console.log(`${literals.size} literals, ${cells} cells, ${hits} candidates`)
