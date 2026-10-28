// Round 5, lens: hiding, base pane present, many seeded tables. #35 counts
// key-lost as losing data, so it sorts with deletes, by name. A PR whose
// migration changes the primary key of seeded tables named before `users`
// (id to uuid, say: no row lost) raises one red key-lost flag each; with
// bulky inserts into a few of them (no flag), the budget runs out before
// `users` in the PR diff. Its migration also deletes 15 of 20 users.
//
// Usage: node d-key-lost-cover.mjs S FATTABLES
//   S: seeded tables named t0000.. whose key the PR changes; FATTABLES: how
//   many of them get 50 bulky inserted rows
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'

const rules = validateRules({})
const S = Number(process.argv[2] ?? 600)
const FAT = Number(process.argv[3] ?? 12)
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const fat = i => ({ id: 1000 + i, uuid: `u-${i}`, a: 'x'.repeat(190), b: 'y'.repeat(190), c: 'z'.repeat(190), d: 'w'.repeat(190) })
const seededTables = after => Object.fromEntries(Array.from({ length: S }, (_, t) => {
  const rows = [{ id: 1, a: 'a', b: 'b', c: 'c', d: 'd' }, { id: 2, a: 'a', b: 'b', c: 'c', d: 'd' }]
  if (!after) return [`t${String(t).padStart(4, '0')}`, { key: ['id'], fields: ['id', 'a', 'b', 'c', 'd'], rows }]
  const moved = rows.map((r, i) => ({ ...r, uuid: `k-${t}-${i}` }))
  if (t < FAT) for (let i = 0; i < 50; i++) moved.push(fat(i))
  return [`t${String(t).padStart(4, '0')}`, { key: ['uuid'], fields: ['id', 'uuid', 'a', 'b', 'c', 'd'], rows: moved }]
}))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users: users(20), ...seededTables(false) } }
    return { collections: { users: users(5), ...seededTables(true) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
const v = JSON.parse(capture.viewJson({ isolation: { verdict: 'isolated' } }))
const s = v.boot
const kinds = {}
for (const f of s.flags) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1
const usersFlags = s.flags.filter(f => f.collection === 'users').map(f => `${f.kind}:${f.severity}`)
console.log(`S=${S} fat=${FAT}: boot flagsCount ${JSON.stringify(s.flagsCount)}; listed ${s.flags.length} ${JSON.stringify(kinds)}; users flags listed: ${JSON.stringify(usersFlags)}`)
for (const part of ['pr', 'divergence', 'base']) {
  const d = s[part]
  const names = Object.keys(d.collections)
  console.log(`  boot.${part}: listed ${names.length} of ${d.collectionsCount}, cut=${d.cut ?? false}; users listed? ${names.includes('users')}`)
}
const found = usersFlags.length > 0 || ['pr', 'divergence', 'base'].some(p => Object.hasOwn(s[p].collections, 'users'))
console.log(`  => users' delete findable in the answer: ${found}`)
