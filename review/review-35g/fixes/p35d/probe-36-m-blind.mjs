// Round 3: can the PR's schema alone make the whole answer fail to build,
// so GET /api/data has nothing (for the base pane too) and #37's badge reads
// 0? The `key` arrays are spread into each listed collection uncharged. A
// store that allows wide composite keys (SQLite: up to 2,000 columns) and
// long column names (isName allows 200 chars) gives one key of ~406 KB.
// Usage: node --max-old-space-size=6000 m-blind.mjs M K COLLEN
import { createDataCapture } from './pr36lib/data-capture.mjs'
import { validateRules } from './pr36lib/data-diff.mjs'
const rules = validateRules({})
const M = Number(process.argv[2] ?? 700)
const K = Number(process.argv[3] ?? 2000)
const COLLEN = Number(process.argv[4] ?? 200)
// one key shared by every table would be one string in memory; give each
// table its own so the heap holds what a real store's answer would
const keyOf = t => Array.from({ length: K }, (_, i) => `k${t}_${i}_`.padEnd(COLLEN, 'k'))
const tables = () => Object.fromEntries(Array.from({ length: M }, (_, t) => [`t${t}`, { key: keyOf(t), rows: [] }]))
const baseStore = { users: { key: ['id'], fields: ['id'], rows: [{ id: 1 }, { id: 2 }] } }
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base') return { collections: structuredClone(baseStore) }
    // the PR's migration also deletes a user: a real destructive change
    const users = phase === 'seed' ? baseStore.users : { key: ['id'], fields: ['id'], rows: [{ id: 1 }] }
    return { collections: { users: structuredClone(users), ...(phase === 'seed' ? {} : tables()) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
// the reviewer takes a snapshot: the tables are still there, so each
// session entry carries its key again
if (process.argv[5] === 'now') { phase = 'now'; await capture.snapshot() }
for (const label of ['first read', 'read again']) {
  const t = performance.now()
  try {
    const body = capture.viewJson({ isolation: { verdict: 'isolated' } })
    console.log(`${label}: ${(body.length / 1e6).toFixed(1)}M chars in ${(performance.now() - t).toFixed(0)} ms`)
  } catch (err) {
    console.log(`${label}: viewJson threw after ${(performance.now() - t).toFixed(0)} ms: ${err.name}: ${err.message}`)
  }
}
const v = capture.view({ isolation: { verdict: 'isolated' } })
console.log('the view itself (not JSON) still has boot flags:', JSON.stringify(v.boot.flags.slice(0, 3)), 'flagsCount', JSON.stringify(v.boot.flagsCount))
console.log('rss MB', (process.memoryUsage().rss / 1e6).toFixed(0))
