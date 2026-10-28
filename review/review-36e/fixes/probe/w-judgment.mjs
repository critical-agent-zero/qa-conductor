// Round 4: the worst case for the author's judgment call (keep the engine's
// order: red, base-pane collections first, non-late kinds before
// unverified/cleared, then by collection NAME, then kind). Within the base
// pane's collections a real delete sorts by its collection's name, not by
// its kind, so red flags the PR raises on other seeded collections that
// sort earlier come first.
//   mode rename: the seed has T tables (a000..) of C columns each; the PR's
//                migration renames every column (fieldsDropped: C red
//                `column-dropped` flags a table), and deletes 15 of 20 users.
//   mode touch:  the seed has T tables of 25 rows; the PR's migration
//                rewrites a column in every row of each (a red mass-change a
//                table), and deletes 15 of 20 users.
// Usage: node w-judgment.mjs MODE T [C]
import { readFileSync } from 'node:fs'
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const cjs = { exports: {} }
new Function('module', 'exports', readFileSync(new URL('../harness37.js', import.meta.url), 'utf8'))(cjs, cjs.exports)
const { dataBadge } = cjs.exports
const rules = validateRules({})
const MODE = process.argv[2] ?? 'rename'
const T = Number(process.argv[3] ?? 20)
const C = Number(process.argv[4] ?? 30)
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const seedTables = migrated => Object.fromEntries(Array.from({ length: T }, (_, t) => {
  const name = `a${String(t).padStart(3, '0')}`
  if (MODE === 'rename') {
    const cols = Array.from({ length: C }, (_, c) => (migrated ? `col_${c}` : `col${c}`))
    return [name, { key: ['id'], fields: ['id', ...cols], rows: Array.from({ length: 3 }, (_, i) => ({ id: i, ...Object.fromEntries(cols.map(c => [c, i])) })) }]
  }
  if (MODE === 'both') {
    // C renamed columns, and 50 rows whose 200-char text the migration rewrites
    const cols = Array.from({ length: C }, (_, c) => (migrated ? `col_${c}` : `col${c}`))
    return [name, { key: ['id'], fields: ['id', 'text', ...cols], rows: Array.from({ length: 50 }, (_, i) => ({ id: i, text: `${migrated ? 'new' : 'old'}-${t}-${i}-`.padEnd(200, 'x'), ...Object.fromEntries(cols.map(c => [c, i])) })) }]
  }
  return [name, { key: ['id'], fields: ['id', 'v'], rows: Array.from({ length: 25 }, (_, i) => ({ id: i, v: migrated ? `${i}!` : `${i}` })) }]
}))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users: users(20), ...seedTables(false) } }
    return { collections: { users: { ...users(20), rows: users(20).rows.slice(15) }, ...seedTables(true) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
const t = performance.now()
const v = JSON.parse(capture.viewJson({ isolation: { verdict: 'isolated' } }))
const b = v.boot
const usersFlags = b.flags.filter(f => f.collection === 'users').map(f => `${f.kind}:${f.severity}`)
console.log(`MODE=${MODE} T=${T} C=${C}: built in ${(performance.now() - t).toFixed(0)} ms; badge ${dataBadge(v)}; boot.flagsCount ${JSON.stringify(b.flagsCount)}; flags listed ${b.flags.length}; kinds listed ${JSON.stringify([...new Set(b.flags.map(f => f.kind))])}`)
console.log(`  users in boot.divergence? ${Object.hasOwn(b.divergence.collections, 'users')} (listed ${Object.keys(b.divergence.collections).length}, cut ${b.divergence.cut}); users in boot.base? ${Object.hasOwn(b.base.collections, 'users')}`)
console.log(`  users' flags listed: ${JSON.stringify(usersFlags)}; users in boot.pr? ${Object.hasOwn(b.pr.collections, 'users')} (deleted ${b.pr.collections.users?.counts.deleted}; listed ${Object.keys(b.pr.collections).length} of ${b.pr.collectionsCount}, cut ${b.pr.cut})`)
