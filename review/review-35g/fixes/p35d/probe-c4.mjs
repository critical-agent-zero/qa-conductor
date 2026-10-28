// C4: CPU and heap of sanitizeSnapshot / diffSnapshots / divergence /
// flagChanges at the collection limits after the fix: 1,000 kept whole,
// 10,000 as counts, the rest left out.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const mb = n => (n / 1048576).toFixed(0) + ' MB'
const heap = () => { global.gc?.(); return process.memoryUsage().heapUsed }
const N = Number(process.argv[2] ?? 12000)
const ROWS = Number(process.argv[3] ?? 2)
const NAMELEN = Number(process.argv[4] ?? 12)
const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, role: 'member' })), count: n })
const pad = () => { const o = {}; for (let i = 0; i < N; i++) o[`p${String(i).padStart(6, '0')}`.padEnd(NAMELEN, 'x')] = { key: ['id'], rows: Array.from({ length: ROWS }, (_, j) => ({ id: j + 1 })), count: ROWS }; return o }
const time = (label, fn) => { const t = performance.now(); const v = fn(); console.log(`${label}: ${(performance.now() - t).toFixed(0)} ms`); return v }
const h0 = heap()
const seed = time('sanitize base seed', () => sanitizeSnapshot({ collections: { users: users(50) } }, { masker, rules }))
const s1 = time(`sanitize PR S1 (${N} padding x ${ROWS} rows + users 50)`, () => sanitizeSnapshot({ collections: { ...pad(), users: users(50) } }, { masker, rules }))
const sn = time('sanitize PR Sn (users wiped)', () => sanitizeSnapshot({ collections: { ...pad(), users: users(0) } }, { masker, rules }))
console.log('  problems', JSON.stringify(s1.problems).slice(0, 300))
console.log('  users in S1', JSON.stringify(s1.collections.users && { trunc: s1.collections.users.truncated, rows: s1.collections.users.rows.length }), 'in Sn', JSON.stringify(sn.collections.users && { trunc: sn.collections.users.truncated, count: sn.collections.users.count }))
const base = time('diff base', () => diffSnapshots(seed, seed))
const pr = time('diff PR', () => diffSnapshots(s1, sn))
const div = time('divergence', () => divergence(base, pr))
const flags = time('flagChanges', () => flagChanges(base, pr, rules, { trusted: true }))
console.log(`  flags ${flags.length}; users flags ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity]))}; first flag ${JSON.stringify(flags[0])}`)
console.log(`  divergence users ${div.collections.users?.status}; collections in divergence ${Object.keys(div.collections).length}`)
console.log(`  JSON size: S1 ${mb(JSON.stringify(s1).length)}, PR diff ${mb(JSON.stringify(pr).length)}, divergence ${mb(JSON.stringify(div).length)}, flags ${mb(JSON.stringify(flags).length)}`)
console.log(`  heap held (snapshots, diffs, flags) ${mb(heap() - h0)}; rss ${mb(process.memoryUsage().rss)}`)
