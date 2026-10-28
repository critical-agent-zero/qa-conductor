// C1b: one cell at the 256 KB scan cap, and 4 rows of it, through
// sanitizeSnapshot (and diff/flags) at 2ec0bba; event-loop blocked time.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const n = Number(process.argv[2] ?? 262144)
const rowsN = Number(process.argv[3] ?? 1)
const cellText = '\\'.repeat(n - 1) + '='
let ticks = 0
const iv = setInterval(() => ticks++, 10)
const t0 = performance.now()
const out = sanitizeSnapshot({ collections: { notes: { key: ['id'], rows: Array.from({ length: rowsN }, (_, i) => ({ id: i, body: cellText })) } } }, { masker, rules })
const ms = performance.now() - t0
console.log(`sanitizeSnapshot: ${rowsN} row(s) x ${n}-char cell of backslashes + '=': ${(ms / 1000).toFixed(1)} s, timer ticks during it ${ticks}, shown ${JSON.stringify(out.collections.notes.rows[0].body).slice(0, 80)}`)
// a nested string inside JSON is scanned too
const t1 = performance.now()
sanitizeSnapshot({ collections: { notes: { key: ['id'], rows: [{ id: 1, meta: { log: '\\'.repeat(65535) + '=' } }] } } }, { masker, rules })
console.log(`nested JSON string of 64 KB backslashes + '=': ${(performance.now() - t1).toFixed(0)} ms`)
clearInterval(iv)
