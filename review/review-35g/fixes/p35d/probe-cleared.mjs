// (2)/(5) One flag per cleared field, sorted with localeCompare: many
// distinct row fields cleared at once in one PR snapshot.
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, divergence, flagChanges } from './repo/lib/data-diff.mjs'
const N = Number(process.argv[2] ?? 500_000)
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const row = v => { const r = { id: 1 }; for (let i = 0; i < N; i++) r[`f${i}`] = v; return r }
const time = (label, fn) => { const c0 = process.cpuUsage(); const t = performance.now(); const v = fn(); const c = process.cpuUsage(c0); console.log(`${label}: wall ${(performance.now() - t).toFixed(0)} ms, cpu ${((c.user + c.system) / 1000).toFixed(0)} ms`); return v }
const raw1 = { collections: { users: { key: ['id'], rows: [{ id: 1, email: 'a@x' }], count: 1 }, wide: { key: ['id'], rows: [row(1)], count: 1 } } }
const rawN = { collections: { users: { key: ['id'], rows: [], count: 0 }, wide: { key: ['id'], rows: [row(null)], count: 1 } } }
console.log(`raw Sn JSON ${(JSON.stringify(rawN).length / 1048576).toFixed(1)} MB`)
const baseS = sanitizeSnapshot({ collections: { users: raw1.collections.users, wide: { key: ['id'], rows: [{ id: 1 }], count: 1 } } }, { masker, rules })
const base = diffSnapshots(baseS, baseS)
const s1 = time('sanitize S1', () => sanitizeSnapshot(raw1, { masker, rules }))
const sn = time('sanitize Sn', () => sanitizeSnapshot(rawN, { masker, rules }))
const pr = time('diffSnapshots', () => diffSnapshots(s1, sn))
time('divergence', () => divergence(base, pr))
const flags = time('flagChanges', () => flagChanges(base, pr, rules, { trusted: false }))
console.log(`flags ${flags.length}; first ${JSON.stringify(flags.slice(0, 3).map(f => `${f.collection}:${f.kind}/${f.severity}${f.field ? ' ' + f.field : ''}`))}`)
