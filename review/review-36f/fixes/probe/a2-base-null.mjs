// Round 6 re-check of round 5's MEDIUM 2 (a span with no base diff), with
// more shapes than review-36e's a-base-null.mjs:
//   now-fail:  the base pane's Snapshot now read fails
//   late-base: the base pane's ready read fails (this snapshot is its late baseline)
//   never:     every base read fails (seed, ready, now): no base snapshot at all
//   open-fail: the base pane's inspector open fails (no base probe)
//   control:   all reads work
// OLDER=1: the PR's own tables are already in its seeded snapshot (S0), so
// its boot span doesn't show them `added`.
// Usage: node a2-base-null.mjs N MODE PAD PREFIX OLDER
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'

const rules = validateRules({})
const N = Number(process.argv[2] ?? 1000)
const MODE = process.argv[3] ?? 'now-fail'
const PAD = process.argv[4] ?? 'drop'
const PREFIX = process.argv[5] ?? 'a'
const OLDER = process.argv[6] === '1'
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const fat = i => ({ id: i, a: 'x'.repeat(190), b: 'y'.repeat(190), c: 'z'.repeat(190), d: 'w'.repeat(190) })
const pad = rows => Object.fromEntries(Array.from({ length: N }, (_, t) => [`${PREFIX}${String(t).padStart(5, '0')}`, { key: ['id'], fields: ['id', 'a', 'b', 'c', 'd'], rows: Array.from({ length: rows }, (_, i) => (PAD === 'fat' ? fat(i) : { id: i })) }]))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  limits: { maxCollections: 2_000 },
  inspector: { open: ({ paneRef }) => {
    if (paneRef.role === 'base' && MODE === 'open-fail') throw new Error('base open failed')
    return { snapshot: () => {
      if (paneRef.role === 'base') {
        if (MODE === 'never') throw new Error('base read failed')
        if (MODE === 'late-base' && phase === 'ready') throw new Error('base ready read failed')
        if (MODE === 'now-fail' && phase === 'now') throw new Error('timed out after 30000 ms')
        return { collections: { users: users(20) } }
      }
      if (phase === 'seed') return { collections: { users: users(20), ...(OLDER ? pad(PAD === 'fat' ? 50 : 2) : {}) } }
      if (phase === 'ready') return { collections: { users: users(20), ...pad(PAD === 'fat' ? 50 : 2) } }
      return { collections: { users: users(5), ...(PAD === 'drop' ? {} : pad(0)) } }
    } }
  } },
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
console.log(`N=${N} mode=${MODE} pad=${PAD} prefix=${PREFIX} older=${OLDER}: ${(Buffer.byteLength(body) / 1e6).toFixed(2)} MB; complete=${s.complete} aligned=${s.aligned}; errors.session=${JSON.stringify(v.errors.session)}`)
console.log(`  session.flagsCount ${JSON.stringify(s.flagsCount)}; flags listed ${s.flags.length}; first 3: ${JSON.stringify(s.flags.slice(0, 3).map(f => `${f.collection}:${f.kind}:${f.severity}`))}; users flags listed: ${JSON.stringify(usersFlags)}`)
for (const part of ['pr', 'divergence', 'base']) {
  const d = s[part]
  if (d === null) { console.log(`  session.${part}: null`); continue }
  const names = Object.keys(d.collections)
  console.log(`  session.${part}: listed ${names.length} of collectionsCount ${d.collectionsCount}, cut=${d.cut ?? false}; users at ${names.indexOf('users')}${names.includes('users') && part === 'pr' ? ` (deleted ${d.collections.users.deleted.length} of ${d.collections.users.counts.deleted})` : ''}`)
}
const fb = capture.view({ isolation: { verdict: 'isolated' } }, { lists: false }).session
console.log(`  fallback: users:delete at ${fb.flags.findIndex(f => f.collection === 'users' && f.kind === 'delete')}; first 3 ${JSON.stringify(fb.flags.slice(0, 3).map(f => `${f.collection}:${f.kind}`))}`)
const found = usersFlags.length > 0 || ['pr', 'divergence', 'base'].some(p => s[p] && Object.hasOwn(s[p].collections, 'users'))
console.log(`  => users' delete findable in the answer: ${found}`)
