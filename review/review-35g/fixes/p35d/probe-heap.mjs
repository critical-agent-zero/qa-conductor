// (5) Retained heap of one sanitized PR snapshot, and of the diff, when the
// rows are as small as JSON allows: 1,000 collections x 10,000 rows of {}
// (30 MB as JSON, under the 32 MB limit). The raw rows are one shared
// object, so the heap measured is the engine's own.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const C = Number(process.argv[2] ?? 1000)
const R = Number(process.argv[3] ?? 10000)
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const mb = n => (n / 1048576).toFixed(0) + ' MB'
const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed }
const empty = {}
const one = { a: 1 }
const rowsE = Array(R).fill(empty)
const rowsA = Array(R).fill(one)
const raw = rows => ({ collections: Object.fromEntries(Array.from({ length: C }, (_, i) => [`c${String(i).padStart(4, '0')}`, { key: null, rows, count: R }])) })
const r1 = raw(rowsE)
const rn = raw(rowsA)
console.log(`raw S1 as JSON ${mb(JSON.stringify(r1).length)}, raw Sn ${mb(JSON.stringify(rn).length)}`)
const time = (label, fn) => { const c0 = process.cpuUsage(); const t = performance.now(); const v = fn(); const c = process.cpuUsage(c0); console.log(`${label}: wall ${(performance.now() - t).toFixed(0)} ms, cpu ${((c.user + c.system) / 1000).toFixed(0)} ms`); return v }
const h0 = heap()
const s1 = time('sanitize S1', () => sanitizeSnapshot(r1, { masker, rules }))
const h1 = heap()
console.log(`  S1 retained ${mb(h1 - h0)}; kept rows ${Object.values(s1.collections).reduce((n, c) => n + c.rows.length, 0)}; problems ${JSON.stringify(s1.problems).slice(0, 120)}`)
const sn = time('sanitize Sn (every row now {a:1})', () => sanitizeSnapshot(rn, { masker, rules }))
const h2 = heap()
console.log(`  Sn retained ${mb(h2 - h1)}; kept rows ${Object.values(sn.collections).reduce((n, c) => n + c.rows.length, 0)}`)
const pr = time('diffSnapshots', () => diffSnapshots(s1, sn))
const h3 = heap()
console.log(`  PR diff retained ${mb(h3 - h2)}`)
const base = diffSnapshots(s1, s1)
const div = time('divergence', () => divergence(base, pr))
const flags = time('flagChanges', () => flagChanges(base, pr, rules, { trusted: false }))
const h4 = heap()
console.log(`  base diff + divergence + flags retained ${mb(h4 - h3)}; flags ${flags.length}; total retained over raw ${mb(h4 - h0)}; rss ${mb(process.memoryUsage().rss)}`)
void div
