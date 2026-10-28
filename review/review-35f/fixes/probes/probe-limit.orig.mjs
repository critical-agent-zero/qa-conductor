// E8: the README's "Hostile PR data" numbers, scaled down: CPU for one
// 256 KB cell of '[\n' lines (x128 for 32 MB), and heap retained by 100
// collections of 10,000 {} rows (x10 for the README's 1,000).
import * as E from './repo/lib/data-diff.mjs'
const rules = E.validateRules({})
const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
const cell = '[\n'.repeat(128 * 1024)
let t = process.cpuUsage()
E.sanitizeSnapshot({ collections: { t: { key: null, rows: [{ v: cell }] } } }, { masker, rules })
let d = process.cpuUsage(t)
const per = (d.user + d.system) / 1e6
console.log(`one 256 KB cell of '[\\n': ${per.toFixed(2)} s CPU; x128 cells (32 MB): ~${(per * 128).toFixed(0)} s CPU`)
globalThis.gc()
const before = process.memoryUsage().heapUsed
const row = {}
const collections = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`c${i}`, { key: null, rows: Array(10_000).fill(row) }]))
t = process.cpuUsage()
const snap = E.sanitizeSnapshot({ collections }, { masker, rules })
d = process.cpuUsage(t)
globalThis.gc()
const after = process.memoryUsage().heapUsed
const json = Buffer.byteLength(JSON.stringify(Object.values(snap.collections).map(c => c.rows)))
console.log(`100 x 10,000 {} rows: ${(json / 1e6).toFixed(1)} MB of JSON kept, ${((after - before) / 1e6).toFixed(0)} MB heap retained (x10: ~${((after - before) / 1e5).toFixed(0)} MB), ${((d.user + d.system) / 1e6).toFixed(2)} s CPU; kept rows ${Object.values(snap.collections).reduce((n, c) => n + c.rows.length, 0)}`)
