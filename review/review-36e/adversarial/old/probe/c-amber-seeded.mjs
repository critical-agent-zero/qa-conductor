// Round 5, lens: hiding, base pane present. A seeded collection whose only
// flags are amber (#35: a `cleared` field is amber at most; a few rows, so
// no mass change) ranks 1 (changed rows) or 2, after every red-flagged
// collection, the PR's own included. The flags list every red flag before
// any amber one. So the PR's own tables, made by its migration and dropped
// (or emptied) by its app in the session, push the seeded collection's
// cleared values out of the flags and out of the PR diff and divergence.
//
// Usage: node c-amber-seeded.mjs N PAD CLEARED PREFIX
//   N: the PR's own tables; PAD: drop or fat (50 bulky rows each, all
//   deleted); CLEARED: users whose email the PR's app sets to null (4 of 20
//   is at the 20% mass-change line); PREFIX: the padding's names
import { createDataCapture } from '../lib/data-capture.mjs'
import { validateRules } from '../lib/data-diff.mjs'

const rules = validateRules({})
const N = Number(process.argv[2] ?? 1000)
const PAD = process.argv[3] ?? 'drop'
const CLEARED = Number(process.argv[4] ?? 4)
const PREFIX = process.argv[5] ?? 'a'
const users = cleared => ({ key: ['id'], fields: ['id', 'name', 'email'], rows: Array.from({ length: 20 }, (_, i) => ({ id: i, name: `user${i}`, email: i < cleared ? null : `u${i}@example.com` })) })
const fat = i => ({ id: i, a: 'x'.repeat(190), b: 'y'.repeat(190), c: 'z'.repeat(190), d: 'w'.repeat(190) })
const pad = rows => Object.fromEntries(Array.from({ length: N }, (_, t) => [`${PREFIX}${String(t).padStart(5, '0')}`, { key: ['id'], fields: ['id', 'a', 'b', 'c', 'd'], rows: Array.from({ length: rows }, (_, i) => (PAD === 'fat' ? fat(i) : { id: i })) }]))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users: users(0) } }
    if (phase === 'ready') return { collections: { users: users(0), ...pad(PAD === 'fat' ? 50 : 2) } }
    return { collections: { users: users(CLEARED), ...(PAD === 'drop' ? {} : pad(0)) } }
  } }) },
})
const signal = new AbortController().signal
for (const role of ['base', 'pr']) await capture.seeded({ paneRef: { role }, db: null, databases: [], signal })
phase = 'ready'
await capture.ready({ signal })
phase = 'now'
await capture.snapshot()
for (const verdict of ['isolated', 'shared-host']) {
  const v = JSON.parse(capture.viewJson({ isolation: { verdict } }))
  const s = v.session
  const usersFlags = s.flags.filter(f => f.collection === 'users').map(f => `${f.kind}${f.field ? ` ${f.field}` : ''}:${f.severity}`)
  console.log(`N=${N} pad=${PAD} cleared=${CLEARED} prefix=${PREFIX} ${verdict}: complete=${s.complete}; flagsCount ${JSON.stringify(s.flagsCount)}; flags listed ${s.flags.length}; users flags listed: ${JSON.stringify(usersFlags)}`)
  for (const part of ['pr', 'divergence', 'base']) {
    const d = s[part]
    const names = Object.keys(d.collections)
    const u = d.collections.users
    const what = !u ? '' : part === 'pr' ? ` (updated ${u.updated.length} of ${u.counts.updated})` : part === 'divergence' ? ` (status ${u.status}, ${u.changesCount} changes)` : ` (status ${u.status})`
    console.log(`  session.${part}: listed ${names.length} of ${d.collectionsCount}, cut=${d.cut ?? false}; users listed? ${Boolean(u)}${what}`)
  }
  const found = usersFlags.length > 0 || ['pr', 'divergence'].some(p => Object.hasOwn(s[p].collections, 'users'))
  console.log(`  => the PR's cleared emails findable in the answer: ${found}`)
}
