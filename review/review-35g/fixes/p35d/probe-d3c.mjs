// D3c: D3 through #36's real capture (pull/36/head a2bbc7c's
// data-capture.mjs, with 7193877's data-diff.mjs beside it, and with
// 2ec0bba's for comparison): the PR pane's store holds one row whose F
// fields each hold 256 KB of '<a:b ' text. How long is the event loop held?
const which = process.argv[2] ?? 'new'
const F = Number(process.argv[3] ?? 16)
const shape = process.argv[4] ?? '<a:b '
const dir = which === 'new' ? './pr36lib' : which === 'old' ? './pr36old' : './pr36fix'
const { createDataCapture } = await import(`${dir}/data-capture.mjs`)
const { validateRules } = await import(`${dir}/data-diff.mjs`)

const K = 256 * 1024
const cell = i => `${i} ${shape.repeat(Math.floor(K / shape.length))}`
const users = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, email: `u${i}@x` }))
const row = { id: 1, ...Object.fromEntries(Array.from({ length: F }, (_, i) => [`f${i}`, cell(i)])) }
const state = {
  base: { users: { key: ['id'], rows: users, count: 5 } },
  pr: { users: { key: ['id'], rows: users, count: 5 }, notes: { key: ['id'], rows: [row], count: 1 } },
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
console.log(`${which}: one PR row of ${F} cells x 256 KB of ${JSON.stringify(shape)} (${(F / 4).toFixed(0)} MB): seeded(both) ${((t1 - t0) / 1000).toFixed(1)} s, ready ${((t2 - t1) / 1000).toFixed(1)} s, snapshot ${((t3 - t2) / 1000).toFixed(1)} s; longest event-loop stall ${(maxGap / 1000).toFixed(1)} s`)
console.log('  problems', JSON.stringify(v.problems), 'pr notes kept', JSON.stringify(Object.keys(v.session?.pr?.collections ?? {})))
await cap.close()
