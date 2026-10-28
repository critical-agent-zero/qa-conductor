// Round 4, lens 3: chosen() ranks collections by "red flag" then by name,
// with no regard for whether the base pane has the collection. A PR-only
// collection with a red flag (one the PR's migration created, then dropped
// or deleted from in the session) ranks with a seeded collection's red
// flag, by name. So N PR-only collections named before `users` can push
// users (whose rows the PR deleted) out of session.pr and
// session.divergence.
// Usage: node s1-flagged-padding.mjs N MODE KEYW PREFIX
//   MODE: drop (the session drops the PR's tables) or delete (deletes a row
//   from each); KEYW: key width (fields of 200-char names, 1 = small);
//   PREFIX: name prefix of the padding
import { createDataCapture } from '../repo/lib/data-capture.mjs'
import { validateRules } from '../repo/lib/data-diff.mjs'
const rules = validateRules({})
const N = Number(process.argv[2] ?? 1000)
const MODE = process.argv[3] ?? 'drop'
const KEYW = Number(process.argv[4] ?? 1)
const PREFIX = process.argv[5] ?? 'a'
const keyNames = KEYW === 1 ? ['id'] : Array.from({ length: KEYW }, (_, i) => `k${i}_`.padEnd(200, 'k'))
const rowOf = i => Object.fromEntries(keyNames.map((k, j) => [k, j === 0 ? i : 0]))
const users = n => ({ key: ['id'], fields: ['id', 'name'], rows: Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}` })) })
const pad = rows => Object.fromEntries(Array.from({ length: N }, (_, t) => [`${PREFIX}${String(t).padStart(5, '0')}`, { key: keyNames, fields: keyNames, rows: Array.from({ length: rows }, (_, i) => rowOf(i)) }]))
let phase = 'seed'
const capture = createDataCapture({
  rules,
  inspector: { open: ({ paneRef }) => ({ snapshot: () => {
    if (paneRef.role === 'base' || phase === 'seed') return { collections: { users: users(20) } }
    if (phase === 'ready') return { collections: { users: users(20), ...pad(2) } }
    // session: the PR deletes 15 of 20 users, and drops its own tables or
    // deletes a row from each
    return { collections: { users: users(5), ...(MODE === 'drop' ? {} : pad(MODE === 'same' ? 2 : 1)) } }
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
const ms = performance.now() - t
const v = JSON.parse(body)
const s = v.session
const usersFlags = s.flags.filter(f => f.collection === 'users').map(f => `${f.kind}:${f.severity}`)
console.log(`N=${N} mode=${MODE} keyW=${KEYW} prefix=${PREFIX}: ${(body.length / 1e6).toFixed(2)}M chars in ${ms.toFixed(0)} ms`)
console.log(`  session.flagsCount ${JSON.stringify(s.flagsCount)}; flags listed ${s.flags.length}; first 3: ${JSON.stringify(s.flags.slice(0, 3).map(f => `${f.collection}:${f.kind}:${f.severity}`))}; users flags listed: ${JSON.stringify(usersFlags)}`)
for (const part of ['pr', 'divergence', 'base']) {
  const d = s[part]
  const names = Object.keys(d.collections)
  console.log(`  session.${part}: listed ${names.length} of collectionsCount ${d.collectionsCount}, cut=${d.cut ?? false}; users listed? ${names.includes('users')}${names.includes('users') && part === 'pr' ? ` (deleted ${d.collections.users.deleted.length} of ${d.collections.users.counts.deleted})` : ''}`)
}
