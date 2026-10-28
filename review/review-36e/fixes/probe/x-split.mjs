// Round 4, lens 6: x-cleared's time, split between the engine's parts.
// Usage: node x-split.mjs N F
import { randomBytes } from 'node:crypto'
import { createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, validateRules, LIMITS } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const N = Number(process.argv[2] ?? 10_000)
const F = Number(process.argv[3] ?? 20)
const fields = ['id', ...Array.from({ length: F }, (_, f) => `f${f}`)]
const rows = v => Array.from({ length: N }, (_, i) => { const r = { id: i }; for (let f = 0; f < F; f++) r[`f${f}`] = v; return r })
const masker = createMasker({ key: randomBytes(32), rules })
const san = raw => sanitizeSnapshot({ collections: raw }, { masker, rules, limits: LIMITS })
const time = (label, fn) => { const t = performance.now(); const out = fn(); console.log(`${label}: ${(performance.now() - t).toFixed(0)} ms`); return out }
const users = { key: ['id'], fields: ['id'], rows: [{ id: 1 }] }
const b = san({ users })
const p1 = san({ users, t: { key: ['id'], fields, rows: rows('x') } })
const p2 = san({ users, t: { key: ['id'], fields, rows: rows('') } })
const sb = diffSnapshots(b, b)
const sp = time('diffSnapshots (PR session)', () => diffSnapshots(p1, p2))
time('flagChanges', () => flagChanges(sb, sp, rules, { trusted: true }))
time('divergence', () => divergence(sb, sp))
