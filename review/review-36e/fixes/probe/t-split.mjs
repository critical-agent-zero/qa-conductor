// Round 4, lens 6: where view()'s time goes at t-cost's shape: the engine's
// diffSnapshots (the session spans, computed in view() for each build),
// flagChanges and divergence, against what the capture adds (its lists).
// Usage: node t-split.mjs C R
import { randomBytes } from 'node:crypto'
import { createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, validateRules, LIMITS } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const C = Number(process.argv[2] ?? 100)
const R = Number(process.argv[3] ?? 10_000)
const users = { key: ['id'], fields: ['id'], rows: Array.from({ length: 20 }, (_, i) => ({ id: i })) }
const table = v => ({ key: ['i'], fields: ['i', 'v'], rows: Array.from({ length: R }, (_, i) => ({ i, v })) })
const tables = v => Object.fromEntries(Array.from({ length: C }, (_, t) => [`t${String(t).padStart(4, '0')}`, table(v)]))
const masker = createMasker({ key: randomBytes(32), rules })
const san = raw => sanitizeSnapshot({ collections: raw }, { masker, rules, limits: LIMITS })
const time = (label, fn) => { const t = performance.now(); const out = fn(); console.log(`${label}: ${(performance.now() - t).toFixed(0)} ms`); return out }
const base0 = san({ users })
const pr1 = time('sanitizeSnapshot (PR, ready)', () => san({ users, ...tables(0) }))
const pr2 = time('sanitizeSnapshot (PR, now)', () => san({ users, ...tables(1) }))
time('diffSnapshots (PR boot: seed -> ready)', () => diffSnapshots(base0, pr1))
const sb = time('diffSnapshots (base session)', () => diffSnapshots(base0, base0))
const sp = time('diffSnapshots (PR session)', () => diffSnapshots(pr1, pr2))
time('flagChanges (session)', () => flagChanges(sb, sp, rules, { trusted: true }))
time('divergence (session)', () => divergence(sb, sp))
