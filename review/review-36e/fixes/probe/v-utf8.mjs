// Round 4, lens 2: the budget counts JSON characters (UTF-16 code units),
// the README/CHANGELOG say "about 4 MB". The PR's own rows hold text of
// 3-byte UTF-8 characters (CJK), each cell at MAX_TEXT (200 characters).
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const T = 12
const F = 40
const cjk = (seed, n) => Array.from({ length: n }, (_, i) => String.fromCharCode(0x4e00 + ((seed * 31 + i * 7) % 20000))).join('')
const rowOf = (i, v) => { const r = { id: i }; for (let f = 0; f < F; f++) r[`c${f}`] = cjk(i * F + f + v, 200); return r }
const tables = v => Object.fromEntries(Array.from({ length: T }, (_, t) => [`t${t}`, { key: ['id'], rows: Array.from({ length: 50 }, (_, i) => rowOf(t * 1000 + i, v)) }]))
const users = { key: ['id'], rows: [{ id: 1 }, { id: 2 }] }
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users } }
    return { collections: { users, ...tables(phase === 'ready' ? 0 : 1) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
await capture.snapshot()
const body = capture.viewJson({ isolation: { verdict: 'isolated' } })
console.log(`answer: ${(body.length / 1e6).toFixed(2)}M characters, ${(Buffer.byteLength(body) / 1e6).toFixed(2)} MB as UTF-8 (the README's bound: about 4 MB)`)
