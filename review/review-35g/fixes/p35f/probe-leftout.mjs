// Where a seeded collection's unverified flag sorts at 4a284f9 and 4ed6449
// when the PR's snapshots (a) leave it out of both S1 and Sn (the PR diff
// lacks it), (b) leave it out of S1 only (omitted 'before'), (c) keep it only
// as a count (a stub: 1,000+ bigger PR collections) while the click wipes it
// by UPDATE. Each with S other seeded collections the PR also changes
// (a delete, a key lost, a column dropped, a mass change on each).
import * as R5 from '../old4a/data-diff.mjs'
import * as H from '../head/data-diff.mjs'
const KEY = Buffer.alloc(32, 7)
const col = (rows, fields, count = rows.length) => ({ key: ['id'], fields, rows, count })
const people = (n, email = i => `u${i}@x`) => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: email(i) }))
function run(lib, base, s1, sn, limits) {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  const S = c => lib.sanitizeSnapshot({ collections: c }, { masker, rules, limits })
  const b = S(base)
  const bd = lib.diffSnapshots(b, b)
  const p1 = S(s1)
  const pn = S(sn)
  const pd = lib.diffSnapshots(p1, pn)
  const flags = lib.flagChanges(bd, pd, rules, { trusted: true })
  const iu = flags.findIndex(f => f.collection === 'users')
  return { flags, iu, entry: Object.hasOwn(pd.collections, 'users') ? { status: pd.collections.users.status, omitted: pd.collections.users.omitted, truncated: pd.collections.users.truncated } : 'absent' }
}
const limits = { maxCollections: 20 }
for (const S of [0, 10, 40]) {
  const others = Object.fromEntries(Array.from({ length: S }, (_, i) => [`s${String(i).padStart(3, '0')}`, col([{ id: 0 }], ['id'])]))
  const base = { users: col(people(30), ['id', 'email']), ...others }
  const touched = (state) => Object.fromEntries(Object.keys(others).map(k => [k, state === 1 ? col(Array.from({ length: 22 }, (_, j) => ({ id: j, pad: 1 })), ['id', 'pad']) : { key: ['id'], fields: ['id'], rows: [{ id: 0 }, { id: 0 }], count: 2 }]))
  // padding: 20 collections of 100 rows (fill maxCollections), 220 more of 50 (fill the stubs), 30 empty (left out)
  const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p_big${i}`, col(people(100), ['id', 'email'])]))
  const mid = Object.fromEntries(Array.from({ length: 220 }, (_, i) => [`p_mid${i}`, col(people(50), ['id', 'email'])]))
  const empty = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p_e${i}`, col([], ['id'])]))
  const wiped = col(people(30, () => null), ['id', 'email'])
  const scen = {
    // (a) users has 0 rows in S1 and Sn? no: left out of both by having fewer rows than all padding
    'a: left out of S1 and Sn, wiped by delete': [{ ...base, ...touched(1), ...big, ...mid, ...empty, users: col(people(0), ['id', 'email']) }, { ...touched(2), ...big, ...mid, ...empty, users: col([], ['id', 'email']) }],
    'b: left out of S1 only': [{ ...base, ...touched(1), ...big, ...mid, ...empty, users: col([], ['id', 'email']) }, { ...touched(2), users: col([], ['id', 'email']) }],
    'c: a stub in S1 and Sn, wiped by UPDATE': [{ ...base, ...touched(1), ...big, ...mid }, { ...touched(2), ...big, ...mid, users: wiped }],
    'd: control, no padding, wiped by UPDATE': [{ ...base, ...touched(1) }, { ...touched(2), users: wiped }],
  }
  for (const [label, [s1, sn]] of Object.entries(scen)) {
    for (const [name, lib] of [['4a284f9', R5], ['4ed6449', H]]) {
      const r = run(lib, base, s1, sn, limits)
      const fu = r.flags[r.iu]
      const baseRed = r.flags.filter(f => f.severity === 'red' && f.collection !== null && Object.hasOwn(base, f.collection)).length
      console.log(`S=${S} ${label.padEnd(44)} ${name}: users diff ${JSON.stringify(r.entry)}; users flags ${JSON.stringify(r.flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity]))}; first users flag at ${r.iu} of ${r.flags.length} (${baseRed} red on base collections)`)
    }
  }
}
