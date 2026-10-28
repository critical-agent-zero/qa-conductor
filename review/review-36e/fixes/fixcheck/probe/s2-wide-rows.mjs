// Round 4, lens 2/3: s1's ranking gap with few tables. The PR's migration
// creates T tables of 50 wide rows (40 fields of 200 characters: a real
// Postgres table), and in the session deletes their rows and 15 of 20 users.
// Each table's red `delete` ranks it with users, by name, and its rows use
// the span's budget first.
// K more small tables of one row each, dropped in the session.
// Usage: node s2-wide-rows.mjs T PREFIX K
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const T = Number(process.argv[2] ?? 6)
const PREFIX = process.argv[3] ?? 'a'
const K = Number(process.argv[4] ?? 0)
const small = () => Object.fromEntries(Array.from({ length: K }, (_, k) => [`${PREFIX}_tmp_${String(k).padStart(3, '0')}`, { key: ['id'], rows: [{ id: 1 }] }]))
const wide = i => { const r = { id: i }; for (let f = 0; f < 40; f++) r[`c${f}`] = `${i}-${f}-`.padEnd(200, 'w'); return r }
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const pad = n => Object.fromEntries(Array.from({ length: T }, (_, t) => [`${PREFIX}_audit_${t}`, { key: ['id'], rows: Array.from({ length: n }, (_, i) => wide(i)) }]))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users: users(20) } }
    if (phase === 'ready') return { collections: { users: users(20), ...pad(50), ...small() } }
    return { collections: { users: users(5), ...pad(0) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
await capture.snapshot()
const v = JSON.parse(capture.viewJson({ isolation: { verdict: 'isolated' } }))
const s = v.session
console.log(`T=${T} prefix=${PREFIX}: session.flagsCount ${JSON.stringify(s.flagsCount)}; first flags ${JSON.stringify(s.flags.slice(0, 3).map(f => `${f.collection}:${f.kind}`))}`)
console.log("  answer chars", capture.viewJson({ isolation: { verdict: "isolated" } }).length, "session.pr chars", JSON.stringify(s.pr).length, "a_audit_0 deleted listed", s.pr.collections[Object.keys(s.pr.collections)[0]].deleted.length, "cut", s.pr.collections[Object.keys(s.pr.collections)[0]].cut)
for (const [n, c] of Object.entries(s.pr.collections)) console.log("   ", n, "deleted listed", c.deleted.length, "of", c.counts.deleted, "cut", c.cut ?? false, "truncated", c.truncated, "chars", JSON.stringify(c).length)
for (const part of ['pr', 'divergence', 'base']) {
  const d = s[part]
  const names = Object.keys(d.collections)
  const u = d.collections.users
  console.log(`  session.${part}: listed ${JSON.stringify(names)} of ${d.collectionsCount}, cut=${d.cut ?? false}; users: ${u ? (part === 'divergence' ? `${u.changes.length} of ${u.changesCount} changes` : `${u.deleted.length} of ${u.counts.deleted} deleted rows`) : 'not listed'}`)
}
