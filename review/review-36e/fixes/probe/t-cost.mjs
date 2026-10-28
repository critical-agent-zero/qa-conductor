// Round 4, lens 6: event-loop time and heap of the capture at the worst
// shapes the limits allow, on the event loop. The PR's migration fills C
// tables of R tiny keyed rows each (within maxRows 10,000 and maxBytes 32 MB,
// so nothing is cut short and every row is diffed); in the session the PR
// changes every row (MODE update), deletes every row (delete) or leaves them
// (same). The base pane stays at the seed (20 users).
// Usage: node --max-old-space-size=8000 t-cost.mjs C R MODE
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const C = Number(process.argv[2] ?? 330)
const R = Number(process.argv[3] ?? 10_000)
const MODE = process.argv[4] ?? 'update'
const users = { key: ['id'], fields: ['id'], rows: Array.from({ length: 20 }, (_, i) => ({ id: i })) }
const table = v => ({ key: ['i'], fields: ['i', 'v'], rows: Array.from({ length: R }, (_, i) => ({ i, v })) })
const tables = v => Object.fromEntries(Array.from({ length: C }, (_, t) => [`t${String(t).padStart(4, '0')}`, table(v)]))
// built once, before any timing: the inspector's own cost isn't counted
const raw = { ready: { users, ...tables(0) }, now: MODE === 'delete' ? { users, ...Object.fromEntries(Object.keys(tables(0)).map(n => [n, { key: ['i'], fields: ['i', 'v'], rows: [] }])) } : { users, ...tables(MODE === 'update' ? 1 : 0) } }
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users } }
    return { collections: raw[phase] }
  } }) },
})
const h = monitorEventLoopDelay({ resolution: 10 })
const mb = n => (n / 1e6).toFixed(0)
const mem = () => `heapUsed ${mb(process.memoryUsage().heapUsed)} MB, rss ${mb(process.memoryUsage().rss)} MB`
const step = async (label, fn) => {
  let last = performance.now()
  let max = 0
  const tick = setInterval(() => { const t = performance.now(); max = Math.max(max, t - last); last = t }, 1)
  const t = performance.now()
  const out = await fn()
  const ms = performance.now() - t
  await new Promise(r => setTimeout(r, 5))
  clearInterval(tick)
  max = Math.max(max, performance.now() - last)
  console.log(`${label}: ${ms.toFixed(0)} ms wall, longest event-loop block ${max.toFixed(0)} ms; ${mem()}`)
  return out
}
const signal = new AbortController().signal
await step('seeded (both)', async () => { for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal }) })
phase = 'ready'
await step('ready (sanitize + boot diff)', () => capture.ready({ signal }))
await step('viewJson after ready', async () => capture.viewJson({ isolation: { verdict: 'isolated' } }).length)
phase = 'now'
await step('Snapshot now', () => capture.snapshot())
const len = await step('viewJson after now (isolated)', async () => capture.viewJson({ isolation: { verdict: 'isolated' } }).length)
await step('viewJson after now (advisory: another build)', async () => capture.viewJson({ isolation: { verdict: 'shared-host' } }).length)
const v = JSON.parse(capture.viewJson({ isolation: { verdict: 'isolated' } }))
console.log(`C=${C} R=${R} MODE=${MODE}: answer ${(len / 1e6).toFixed(2)}M chars; session flagsCount ${JSON.stringify(v.session.flagsCount)}; problems.pr ${JSON.stringify(v.problems.pr).slice(0, 160)}`)
const kept = Object.values(v.session.pr.collections).filter(c => !c.truncated).length
console.log(`  session.pr listed ${Object.keys(v.session.pr.collections).length} of ${v.session.pr.collectionsCount}, not truncated among listed: ${kept}`)
