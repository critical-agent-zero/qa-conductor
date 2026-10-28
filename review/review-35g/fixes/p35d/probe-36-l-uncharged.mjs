// Round 3: what the view lists without charging it to the per-span byte
// budget: each listed collection entry's name and `key` array (spread by
// listed() via ...c), and `problems`. The PR controls its schema: here its
// migration adds M tables named with NAME-char names, each with a K-column
// primary key of 63-char column names and 0 rows, and its session drops
// them. Usage: node l-uncharged.mjs M K NAME
import { createDataCapture } from './pr36lib/data-capture.mjs'
import { validateRules } from './pr36lib/data-diff.mjs'
const rules = validateRules({})
const M = Number(process.argv[2] ?? 1000)
const K = Number(process.argv[3] ?? 32)
const NAME = Number(process.argv[4] ?? 63)
const keyOf = t => Array.from({ length: K }, (_, i) => `k${t}_${i}_`.padEnd(Number(process.argv[5] ?? 63), 'k'))
const tname = t => `t${String(t).padStart(5, '0')}_`.padEnd(NAME, 'n')
const tables = () => Object.fromEntries(Array.from({ length: M }, (_, t) => [tname(t), { key: keyOf(t), fields: keyOf(t), rows: [] }]))
const baseStore = { users: { key: ['id'], fields: ['id'], rows: [{ id: 1 }] } }
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base') return { collections: structuredClone(baseStore) }
    return { collections: { ...structuredClone(baseStore), ...(phase === 'ready' ? tables() : {}) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
await capture.snapshot()
const t = performance.now()
let body
try {
  body = capture.viewJson({ isolation: { verdict: 'isolated' } })
} catch (err) {
  console.log(`M=${M} K=${K} NAME=${NAME}: viewJson threw after ${(performance.now() - t).toFixed(0)} ms: ${err.name}: ${err.message}`)
  process.exit(0)
}
const ms = performance.now() - t
const v = JSON.parse(body)
const mb = x => (Buffer.byteLength(JSON.stringify(x)) / 1e6).toFixed(2)
const keys = d => Object.values(d?.collections ?? {}).map(c => c.key)
console.log(`M=${M} K=${K} NAME=${NAME}: viewJson ${(Buffer.byteLength(body) / 1e6).toFixed(2)} MB in ${ms.toFixed(0)} ms (budget ${4 * 1024 * 1024 / 1e6} MB of lists)`)
console.log(`  boot.pr: ${Object.keys(v.boot.pr.collections).length} entries, ${mb(v.boot.pr)} MB, of which key arrays ${mb(keys(v.boot.pr))} MB; session.pr ${mb(v.session.pr)} MB, key arrays ${mb(keys(v.session.pr))} MB`)
console.log(`  boot.divergence ${mb(v.boot.divergence)} MB; session.divergence ${mb(v.session.divergence)} MB; flags boot ${mb(v.boot.flags)} session ${mb(v.session.flags)} MB; problems ${mb(v.problems)} MB`)
