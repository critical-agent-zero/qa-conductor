// Deletes hidden by a PR-made count stub: the PR adds collections with more
// rows than seeded `users` (maxCollections 5 here, standing for 1,000), so
// users is kept as its count alone in the PR pane only. The click deletes
// every seeded user and inserts as many padding rows. Padding flags on S
// other seeded collections (rows the PR inserted at boot, deleted at the
// click). Where is users' only flag?
import { LIBS, KEY } from './h.mjs'

const col = (rows, fields) => ({ key: ['id'], fields, rows, count: rows.length })
const people = (n, base = 1) => Array.from({ length: n }, (_, i) => ({ id: base + i, email: `u${i}@x` }))
for (const S of [3, 50]) {
  for (const h of ['4a284f9', '4ed6449']) {
    const lib = LIBS[h]
    const rules = lib.validateRules({})
    const masker = lib.createMasker({ key: KEY, rules })
    const limits = { maxCollections: 5 }
    const snap = c => lib.sanitizeSnapshot({ collections: c }, { masker, rules, limits })
    const extra = Object.fromEntries(Array.from({ length: S }, (_, i) => [`s${String(i).padStart(3, '0')}`, col([{ id: 0 }], ['id'])]))
    const base = { users: col(people(20), ['id', 'email']), ...extra }
    const big = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`zbig${i}`, col(people(30), ['id', 'email'])]))
    const pad1 = Object.fromEntries(Object.keys(extra).map(k => [k, col(Array.from({ length: 22 }, (_, j) => ({ id: j })), ['id'])]))
    const padN = Object.fromEntries(Object.keys(extra).map(k => [k, col([{ id: 0 }], ['id'])]))
    const s1 = { ...base, ...big, ...pad1 }
    const sn = { ...base, users: col(people(20, 1000), ['id', 'email']), ...big, ...padN }
    const b0 = snap(base)
    const bd = lib.diffSnapshots(b0, b0)
    const pd = lib.diffSnapshots(snap(s1), snap(sn))
    const flags = lib.flagChanges(bd, pd, rules, { trusted: true })
    const iu = flags.findIndex(f => f.collection === 'users')
    console.log(`${h} S=${S}: users ${JSON.stringify({ st: pd.collections.users.status, tr: pd.collections.users.truncated, om: pd.collections.users.omitted })}; its flags ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity]))} at ${iu} of ${flags.length}`)
  }
}
