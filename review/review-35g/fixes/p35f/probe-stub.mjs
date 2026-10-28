// A seeded `users` (30 rows) that the PR's padding pushes into a count-only
// stub in both PR snapshots (two PR collections of 100 rows, S seeded
// collections of 40 rows, maxCollections S + 2), while the click wipes its
// emails by UPDATE. The S other seeded collections each get a mass change and
// a dropped column. Where does users' only flag sort?
import * as R5 from '../old4a/data-diff.mjs'
import * as H from '../head/data-diff.mjs'
const KEY = Buffer.alloc(32, 7)
const col = (rows, fields) => ({ key: ['id'], fields, rows, count: rows.length })
const rowsOf = (n, f) => Array.from({ length: n }, (_, i) => ({ id: i + 1, ...f(i) }))
for (const S of [5, 50]) {
  const names = Array.from({ length: S }, (_, i) => `s${String(i).padStart(3, '0')}`)
  const base = { users: col(rowsOf(30, i => ({ email: `u${i}@x` })), ['id', 'email']), ...Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'a' })), ['id', 'v'])])) }
  const big = { p_big0: col(rowsOf(100, () => ({ v: 1 })), ['id', 'v']), p_big1: col(rowsOf(100, () => ({ v: 1 })), ['id', 'v']) }
  const s1 = { ...base, ...big, ...Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'a', tmp: 1 })), ['id', 'v', 'tmp'])])) }
  const sn = { ...big, users: col(rowsOf(30, () => ({ email: null })), ['id', 'email']), ...Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'b' })), ['id', 'v'])])) }
  for (const [label, lib] of [['4a284f9', R5], ['4ed6449', H]]) {
    const rules = lib.validateRules({})
    const masker = lib.createMasker({ key: KEY, rules })
    const snap = (c, limits) => lib.sanitizeSnapshot({ collections: c }, { masker, rules, limits })
    const b = snap(base)
    const limits = { maxCollections: S + 2 }
    const pd = lib.diffSnapshots(snap(s1, limits), snap(sn, limits))
    const flags = lib.flagChanges(lib.diffSnapshots(b, b), pd, rules, { trusted: true })
    const iu = flags.findIndex(f => f.collection === 'users')
    const u = pd.collections.users
    console.log(`S=${S} ${label}: users diff ${JSON.stringify({ status: u.status, truncated: u.truncated, omitted: u.omitted, countBefore: u.countBefore, countAfter: u.countAfter })}; users flags ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity]))} at ${iu} of ${flags.length}; before it: ${JSON.stringify([...new Set(flags.slice(0, iu).map(f => `${f.kind}/${f.severity}`))])}`)
  }
}
