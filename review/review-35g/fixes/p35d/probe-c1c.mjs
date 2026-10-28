// C1c: the backslash run through #36's real capture (pull/36/head a2bbc7c,
// data-diff identical to #35's 2ec0bba): how long is the event loop blocked
// when the PR pane's store holds one text cell of backslashes?
import { createDataCapture } from './pr36lib/data-capture.mjs'
import { validateRules } from './pr36lib/data-diff.mjs'

const n = Number(process.argv[2] ?? 131072)
const users = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, email: `u${i}@x` }))
const state = {
  base: { users: { key: ['id'], rows: users, count: 5 } },
  pr: { users: { key: ['id'], rows: users, count: 5 }, notes: { key: ['id'], rows: [{ id: 1, body: '\\'.repeat(n - 1) + '=' }], count: 1 } },
}
const inspector = { open: async ({ paneRef }) => ({ snapshot: () => new Promise(r => setTimeout(() => r({ collections: state[paneRef.role] }), 20)) }) }
const cap = createDataCapture({ inspector, rules: validateRules({}) })
let maxGap = 0
let last = performance.now()
const iv = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t }, 5)
const t0 = performance.now()
await cap.seeded({ paneRef: { role: 'base' } })
await cap.seeded({ paneRef: { role: 'pr' } })
const t1 = performance.now()
await cap.ready({})
const t2 = performance.now()
await cap.snapshot()
const t3 = performance.now()
clearInterval(iv)
const v = cap.view({ isolation: { verdict: 'isolated' } })
console.log(`cell of ${n} chars: seeded(both) ${((t1 - t0) / 1000).toFixed(1)} s, ready ${((t2 - t1) / 1000).toFixed(1)} s, snapshot ${((t3 - t2) / 1000).toFixed(1)} s; longest event-loop stall ${(maxGap / 1000).toFixed(1)} s`)
console.log('problems', JSON.stringify(v.problems))
await cap.close()
