// Round 4: chosen() ranks a red-flagged collection first, then by name. In
// the session span the PR's own collections (made by its migration, so in
// its baseline but not the base pane's) can carry red flags too: its app
// code deletes their rows or drops them during the session. They then rank
// with `users` (red) and sort before it by name.
//   mode cap:    P empty-ish padding tables (1 row each), dropped in the
//                session: P red `dropped` flags, rank 0, past the 1,000 cap.
//   mode budget: P padding tables with 50 bulky rows each, all deleted in
//                the session: their deleted rows eat the span's 2 MB first.
// The PR also deletes 15 of 20 users during the session (its real change).
// Usage: node v-session-flood.mjs MODE P [PREFIX]
import { readFileSync } from 'node:fs'
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const cjs = { exports: {} }
new Function('module', 'exports', readFileSync(new URL('../harness37.js', import.meta.url), 'utf8'))(cjs, cjs.exports)
const { dataBadge } = cjs.exports
const rules = validateRules({})
const MODE = process.argv[2] ?? 'cap'
const P = Number(process.argv[3] ?? 1200)
const PREFIX = process.argv[4] ?? 'a'
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const padRows = MODE === 'budget' ? 50 : 1
const padding = () => Object.fromEntries(Array.from({ length: P }, (_, t) => [`${PREFIX}${String(t).padStart(5, '0')}`, {
  key: ['id'], fields: ['id', 'blob'], rows: Array.from({ length: padRows }, (_, i) => ({ id: i, blob: `${t}-${i}-`.padEnd(MODE === 'budget' ? 1000 : 4, 'x') })),
}]))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users: users(20) } }
    if (phase === 'ready') return { collections: { users: users(20), ...padding() } }
    // the session: the PR deletes 15 users, and drops (cap) or empties (budget) its padding
    if (MODE === 'cap') return { collections: { users: { ...users(20), rows: users(20).rows.slice(15) } } }
    return { collections: { users: { ...users(20), rows: users(20).rows.slice(15) }, ...Object.fromEntries(Object.entries(padding()).map(([n, c]) => [n, { ...c, rows: [] }])) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
await capture.snapshot()
const t = performance.now()
const body = capture.viewJson({ isolation: { verdict: 'isolated' } })
const v = JSON.parse(body)
const s = v.session
console.log(`MODE=${MODE} P=${P} prefix=${PREFIX}: ${(body.length / 1e6).toFixed(2)}M chars in ${(performance.now() - t).toFixed(0)} ms; badge ${dataBadge(v)}; session.flagsCount ${JSON.stringify(s.flagsCount)}; flags listed ${s.flags.length}`)
console.log(`  first flags: ${JSON.stringify(s.flags.slice(0, 3).map(f => `${f.collection}:${f.kind}:${f.severity}`))}`)
console.log(`  users in session.pr? ${Object.hasOwn(s.pr.collections, 'users')} (listed ${Object.keys(s.pr.collections).length} of ${s.pr.collectionsCount}, cut ${s.pr.cut}); users in session.divergence? ${Object.hasOwn(s.divergence.collections, 'users')} (listed ${Object.keys(s.divergence.collections).length} of ${s.divergence.collectionsCount}, cut ${s.divergence.cut}); first listed in pr: ${Object.keys(s.pr.collections).slice(0, 2)}`)
