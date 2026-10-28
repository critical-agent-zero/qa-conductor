// Round 4: the build time at a wide-row shape within the documented limits
// (f-wide-max's `wide`: 4 tables x 10,000 rows x 96 short fields, ~30 MB a
// snapshot, not truncated). Everything is the PR's own: its migration makes
// the tables (boot: inserted rows), and its app rewrites every field of every
// row during the session (MODE=own). MODE=seeded: the same tables are in the
// seed, and the PR rewrites them at boot and again in the session (f-wide-max).
// Where does viewJson's time go, and how long is the event loop blocked by a
// Snapshot now (take + sanitize) and the next GET (viewJson)?
// Usage: node x-wide-cost.mjs MODE [ROWS] [F]
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const MODE = process.argv[2] ?? 'own'
const ROWS = Number(process.argv[3] ?? 10_000)
const F = Number(process.argv[4] ?? 95)
const make = tag => Object.fromEntries(Array.from({ length: 4 }, (_, c) => [`t${c}`, {
  key: ['id'], fields: ['id', ...Array.from({ length: F }, (_, f) => `f${f}`)],
  rows: Array.from({ length: ROWS }, (_, i) => {
    const r = { id: i }
    for (let f = 0; f < F; f++) r[`f${f}`] = tag
    return r
  }),
}]))
const users = { users: { key: ['id'], fields: ['id'], rows: Array.from({ length: 20 }, (_, i) => ({ id: i })) } }
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    const pr = paneRef.role === 'pr'
    if (MODE === 'own') {
      if (!pr || phase === 'seed') return { collections: users }
      return { collections: { ...users, ...make(phase === 'ready' ? 1 : 2) } }
    }
    if (phase === 'seed' || !pr) return { collections: { ...users, ...make(1) } }
    return { collections: { ...users, ...make(phase === 'ready' ? 2 : 3) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
let t = performance.now()
await capture.ready({ signal })
console.log(`MODE=${MODE} ${ROWS}x${F}: ready (two takes + boot diffs): ${(performance.now() - t).toFixed(0)} ms`)
phase = 'now'
t = performance.now()
await capture.snapshot()
console.log(`  Snapshot now (two takes): ${(performance.now() - t).toFixed(0)} ms`)
t = performance.now()
const body = capture.viewJson({ isolation: { verdict: 'isolated' } })
console.log(`  first viewJson after it: ${(performance.now() - t).toFixed(0)} ms, ${(body.length / 1e6).toFixed(2)}M chars; badge red ${JSON.parse(body).session.flagsCount.red}`)
// the parts, by hand
const masker = createMasker({ key: Buffer.alloc(32), rules })
const snap = tag => sanitizeSnapshot({ collections: { ...users, ...make(tag) } }, { masker, rules, limits: {} })
t = performance.now(); const a = snap(2); console.log(`  sanitizeSnapshot one pane: ${(performance.now() - t).toFixed(0)} ms`)
const b2 = snap(3)
const base = sanitizeSnapshot({ collections: users }, { masker, rules, limits: {} })
t = performance.now(); const prDiff = diffSnapshots(a, b2); console.log(`  diffSnapshots PR session: ${(performance.now() - t).toFixed(0)} ms`)
const baseDiff = diffSnapshots(base, base)
t = performance.now(); flagChanges(baseDiff, prDiff, rules, { trusted: true }); console.log(`  flagChanges session: ${(performance.now() - t).toFixed(0)} ms`)
t = performance.now(); divergence(baseDiff, prDiff); console.log(`  divergence session: ${(performance.now() - t).toFixed(0)} ms`)
