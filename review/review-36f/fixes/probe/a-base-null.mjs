// Round 5, lens: hiding. The rank (and the engine's flag order it follows)
// tells the base pane's collections from the PR's own only through the
// span's base diff. When the base pane has no session diff (its Snapshot
// now read failed, or its baseline came late from this snapshot), the span
// is flagged against an empty base diff: every collection then looks like
// the PR's own, and collections tie by name. The PR's own tables, made by
// its migration and dropped (or emptied) by its app in the session, then
// precede a seeded collection the PR deleted from.
//
// Usage: node a-base-null.mjs N MODE PAD PREFIX
//   N: the PR's own tables; MODE: now-fail (the base's Snapshot now read
//   fails), late-base (the base's ready read fails, so this snapshot is its
//   baseline), control (all reads work); PAD: drop (the session drops the
//   PR's tables) or fat (it deletes 50 bulky rows from each); PREFIX: their
//   names' prefix
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'

const rules = validateRules({})
const N = Number(process.argv[2] ?? 1000)
const MODE = process.argv[3] ?? 'now-fail'
const PAD = process.argv[4] ?? 'drop'
const PREFIX = process.argv[5] ?? 'a'
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const fat = i => ({ id: i, a: 'x'.repeat(190), b: 'y'.repeat(190), c: 'z'.repeat(190), d: 'w'.repeat(190) })
const pad = rows => Object.fromEntries(Array.from({ length: N }, (_, t) => [`${PREFIX}${String(t).padStart(5, '0')}`, { key: ['id'], fields: ['id', 'a', 'b', 'c', 'd'], rows: Array.from({ length: rows }, (_, i) => (PAD === 'fat' ? fat(i) : { id: i })) }]))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base') {
      if (MODE === 'late-base' && phase === 'ready') throw new Error('base ready read failed')
      if (MODE === 'now-fail' && phase === 'now') throw new Error('timed out after 30000 ms')
      return { collections: { users: users(20) } }
    }
    if (phase === 'seed') return { collections: { users: users(20) } }
    // the PR's migration makes its own tables
    if (phase === 'ready') return { collections: { users: users(20), ...pad(PAD === 'fat' ? 50 : 2) } }
    // session: the PR's app deletes 15 of 20 seeded users, and drops its own
    // tables (or deletes every row of each)
    return { collections: { users: users(5), ...(PAD === 'drop' ? {} : pad(0)) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
await capture.snapshot()
const body = capture.viewJson({ isolation: { verdict: 'isolated' } })
const v = JSON.parse(body)
const s = v.session
const usersFlags = s.flags.filter(f => f.collection === 'users').map(f => `${f.kind}:${f.severity}`)
console.log(`N=${N} mode=${MODE} pad=${PAD} prefix=${PREFIX}: ${(Buffer.byteLength(body) / 1e6).toFixed(2)} MB; complete=${s.complete} aligned=${s.aligned}; errors.session=${JSON.stringify(v.errors.session)}; baselines=${JSON.stringify(v.baselines)}`)
console.log(`  session.flagsCount ${JSON.stringify(s.flagsCount)}; flags listed ${s.flags.length}; first 3: ${JSON.stringify(s.flags.slice(0, 3).map(f => `${f.collection}:${f.kind}:${f.severity}`))}; users flags listed: ${JSON.stringify(usersFlags)}`)
for (const part of ['pr', 'divergence', 'base']) {
  const d = s[part]
  if (d === null) { console.log(`  session.${part}: null`); continue }
  const names = Object.keys(d.collections)
  console.log(`  session.${part}: listed ${names.length} of collectionsCount ${d.collectionsCount}, cut=${d.cut ?? false}; users listed? ${names.includes('users')}${names.includes('users') && part === 'pr' ? ` (deleted ${d.collections.users.deleted.length} of ${d.collections.users.counts.deleted})` : ''}`)
}
const found = usersFlags.length > 0 || ['pr', 'divergence', 'base'].some(p => s[p] && Object.hasOwn(s[p].collections, 'users'))
console.log(`  => users' delete findable in the answer: ${found}`)
