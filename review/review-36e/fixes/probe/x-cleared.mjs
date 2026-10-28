// Round 4, lens 6: the worst shape for view()'s time. #35's tally() merges a
// kind's items with [...was.items, ...items] on each add, and adds `cleared`
// once per updated row and field, so a field cleared in N rows costs N^2/2
// copies. The PR's migration fills one table of N rows with F set fields;
// in the session the PR clears every one of them. Through the capture:
// Snapshot now, then GET /api/data's build (viewJson), on the event loop.
// Usage: node x-cleared.mjs N F
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const N = Number(process.argv[2] ?? 10_000)
const F = Number(process.argv[3] ?? 10)
const fields = ['id', ...Array.from({ length: F }, (_, f) => `f${f}`)]
const rows = v => Array.from({ length: N }, (_, i) => { const r = { id: i }; for (let f = 0; f < F; f++) r[`f${f}`] = v; return r })
const users = { key: ['id'], fields: ['id'], rows: [{ id: 1 }, { id: 2 }] }
const raw = { ready: { users, t: { key: ['id'], fields, rows: rows('x') } }, now: { users, t: { key: ['id'], fields, rows: rows('') } } }
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => (paneRef.role === 'base' || phase === 'seed' ? { collections: { users } } : { collections: raw[phase] }) }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
let t = performance.now()
await capture.snapshot()
const snapMs = performance.now() - t
t = performance.now()
const body = capture.viewJson({ isolation: { verdict: 'isolated' } })
const viewMs = performance.now() - t
const v = JSON.parse(body)
console.log(`N=${N} F=${F} (${N * F} cells, ~${((N * F * 8) / 1e6).toFixed(1)} MB of rows): Snapshot now ${snapMs.toFixed(0)} ms; viewJson (one synchronous call) ${viewMs.toFixed(0)} ms; session flagsCount ${JSON.stringify(v.session.flagsCount)}; rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`)
