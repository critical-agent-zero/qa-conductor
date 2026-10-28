// Round 5: the round-4 cost shapes with main-thread CPU time beside wall time
// (the host is shared and loaded, so wall time overstates). Raw snapshots are
// built before timing; the inspector returns them.
// Usage: node cpu-cost.mjs wide-seeded | wide-own | cleared F | rows C
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const [MODE, ARG] = process.argv.slice(2)
const users = { key: ['id'], fields: ['id'], rows: Array.from({ length: 20 }, (_, i) => ({ id: i })) }
const wide = tag => Object.fromEntries(Array.from({ length: 4 }, (_, c) => [`t${c}`, {
  key: ['id'], fields: ['id', ...Array.from({ length: 95 }, (_, f) => `f${f}`)],
  rows: Array.from({ length: 10_000 }, (_, i) => { const r = { id: i }; for (let f = 0; f < 95; f++) r[`f${f}`] = tag; return r }),
}]))
let raw
const TAG = { seed: { base: 1, pr: 1 }, ready: { base: 1, pr: 2 }, now: { base: 1, pr: 3 } }
if (MODE === 'wide-own') raw = { seed: { base: { users }, pr: { users } }, ready: { base: { users }, pr: { users, ...wide(1) } }, now: { base: { users }, pr: { users, ...wide(2) } } }
else if (MODE === 'cleared') {
  const F = Number(ARG ?? 100)
  const fields = ['id', ...Array.from({ length: F }, (_, f) => `f${f}`)]
  const rows = v => Array.from({ length: 10_000 }, (_, i) => { const r = { id: i }; for (let f = 0; f < F; f++) r[`f${f}`] = v; return r })
  raw = { seed: { base: { users }, pr: { users } }, ready: { base: { users }, pr: { users, t: { key: ['id'], fields, rows: rows('x') } } }, now: { base: { users }, pr: { users, t: { key: ['id'], fields, rows: rows('') } } } }
} else if (MODE === 'rows') {
  const C = Number(ARG ?? 200)
  const tables = v => Object.fromEntries(Array.from({ length: C }, (_, t) => [`t${String(t).padStart(4, '0')}`, { key: ['i'], fields: ['i', 'v'], rows: Array.from({ length: 10_000 }, (_, i) => ({ i, v })) }]))
  raw = { seed: { base: { users }, pr: { users } }, ready: { base: { users }, pr: { users, ...tables(0) } }, now: { base: { users }, pr: { users, ...tables(1) } } }
}
let phase = 'seed'
let peak = 0; setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed) }, 5).unref()
const capture = createDataCapture({ rules, inspector: { open: ({ paneRef }) => ({ snapshot: () => ({ collections: { users, ...wide(TAG[phase][paneRef.role]) } }) }) } })
const cpu = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000 }
const step = async (label, fn) => {
  const c = cpu(); const t = performance.now()
  const out = await fn()
  console.log(`  ${label}: wall ${(performance.now() - t).toFixed(0)} ms, main-thread CPU ${(cpu() - c).toFixed(0)} ms`)
  return out
}
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
console.log(`${MODE} ${ARG ?? ''}`)
phase = 'ready'
await step('ready', () => capture.ready({ signal }))
await step('answer after ready', async () => capture.viewJson({ isolation: { verdict: 'isolated' } }).length)
phase = 'now'
await step('Snapshot now', () => capture.snapshot())
const len = await step('answer after Snapshot now', async () => capture.viewJson({ isolation: { verdict: 'isolated' } }).length)
await step('answer for the other trust', async () => capture.viewJson({ isolation: { verdict: 'shared-host' } }).length)
const v = JSON.parse(capture.viewJson({ isolation: { verdict: 'isolated' } }))
console.log(`  answer ${(len / 1e6).toFixed(2)}M chars; session flagsCount ${JSON.stringify(v.session.flagsCount)}; heapUsed ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB, peak sampled ${(peak / 1e6).toFixed(0)} MB, limit ${(require("v8").getHeapStatistics().heap_size_limit / 1e6).toFixed(0)} MB`)
