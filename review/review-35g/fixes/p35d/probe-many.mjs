// (1)/(5) A huge number of PR collections: the omitted count and the
// sorts behind it. N empty collections (about 24 bytes each as JSON, so
// 1,000,000 fit in 32 MB), plus a seeded users that the click wipes.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const N = Number(process.argv[2] ?? 1_000_000)
const ROWS = Number(process.argv[3] ?? 0)
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const mb = n => (n / 1048576).toFixed(0) + ' MB'
const heap = () => { global.gc?.(); return process.memoryUsage().heapUsed }
const users = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })), count: n })
const padRows = Array.from({ length: ROWS }, (_, j) => ({ id: j }))
const pad = () => { const o = {}; for (let i = 0; i < N; i++) o[`c${String(i).padStart(7, '0')}`] = { key: ['id'], rows: padRows, count: ROWS }; return o }
let worst = 0
let last = performance.now()
const timer = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now }, 5)
const step = async (label, fn) => {
  await new Promise(r => setTimeout(r, 20))
  worst = 0; last = performance.now()
  const t = performance.now(); const v = fn(); const took = performance.now() - t
  await new Promise(r => setTimeout(r, 20))
  console.log(`${label}: ${took.toFixed(0)} ms (longest gap between 5 ms ticks ${worst.toFixed(0)} ms)`)
  return v
}
const rawS1 = { collections: { ...pad(), users: users(50) } }
const rawSn = { collections: { ...pad(), users: users(0) } }
console.log(`raw S1 as JSON: ${mb(JSON.stringify(rawS1).length)}`)
const h0 = heap()
const baseS = sanitizeSnapshot({ collections: { users: users(50) } }, { masker, rules })
const base = diffSnapshots(baseS, baseS)
const s1 = await step(`sanitize S1 (${N} collections of ${ROWS} rows + users)`, () => sanitizeSnapshot(rawS1, { masker, rules }))
const sn = await step('sanitize Sn (users wiped)', () => sanitizeSnapshot(rawSn, { masker, rules }))
console.log(`  S1.omitted ${s1.omitted}; problems ${JSON.stringify(s1.problems).slice(0, 240)}`)
const pr = await step('diffSnapshots', () => diffSnapshots(s1, sn))
const div = await step('divergence', () => divergence(base, pr))
const flags = await step('flagChanges', () => flagChanges(base, pr, rules, { trusted: false }))
console.log(`  users flags ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => f.kind + '/' + f.severity))}, index ${flags.findIndex(f => f.collection === 'users')} of ${flags.length}; divergence users ${div.collections.users?.status}`)
console.log(`  heap held over the raw (snapshots, diffs, flags): ${mb(heap() - h0)}; rss ${mb(process.memoryUsage().rss)}`)
clearInterval(timer)
