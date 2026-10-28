// Round-6 lows at 4ed6449 vs 4033285:
// (1) row pair rule vs the collection's key fields (O1/O2 of probe-over),
//     and the flip side: a secret pair value that is a declared key field;
// (2) a seeded collection pushed into a count stub (probe-stub) and a
//     collection the PR alone cut short (inflated past maxRows);
// (3) seeded matched by name (README claim).
import { LIBS, KEY } from './h.mjs'
const heads = ['4a284f9', '4ed6449', '4033285']
const S = 'Zq9SeCr3tVal'
const mk = h => {
  const lib = LIBS[h]
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  return { lib, rules, snap: (c, limits) => lib.sanitizeSnapshot({ collections: c }, { masker, rules, limits }) }
}
console.log('== (1) row pairs and key fields')
const kcases = {
  'O2 options keyed [value], renamed': [{ options: { key: ['value'], fields: ['value', 'name'], rows: [{ value: 'opt_reset', name: 'Password reset' }] } }, { options: { key: ['value'], fields: ['value', 'name'], rows: [{ value: 'opt_reset', name: 'Reset' }] } }],
}
for (const h of heads) {
  const { lib, rules, snap } = mk(h)
  for (const [label, [a, b]] of Object.entries(kcases)) {
    const pd = lib.diffSnapshots(snap(a), snap(b))
    const d = pd.collections.options
    console.log(`${h} ${label}: ins ${d.inserted?.length} upd ${d.updated?.length} del ${d.deleted?.length} flags ${JSON.stringify(lib.flagChanges(lib.diffSnapshots(snap(a), snap(a)), pd, rules, { trusted: true }).map(f => f.kind))}`)
  }
  const secretKeyed = [
    ['tokens keyed [value]', { tokens: { key: ['value'], rows: [{ name: 'deploy_token', value: S }] } }],
    ['settings keyed [key, value]', { settings: { key: ['key', 'value'], rows: [{ key: 'smtp_password', value: S }] } }],
    ['kv keyed [k, v]', { kv: { key: ['k', 'v'], rows: [{ k: 'api_token', v: S }] } }],
    ['settings keyed [id] (control)', { settings: { key: ['id'], rows: [{ id: 1, key: 'smtp_password', value: S }] } }],
    ['sessions keyed [token] (named secret, control)', { sessions: { key: ['token'], rows: [{ token: S, user: 1 }] } }],
  ]
  for (const [label, c] of secretKeyed) {
    const out = JSON.stringify(snap(c).collections)
    console.log(`${h} ${label}: ${out.includes(S) ? 'CLEAR' : 'masked'}  ${out.slice(0, 140)}`)
  }
}

console.log('\n== (2) cut short in the PR pane only: where users\' unverified sorts')
const col = (rows, fields) => ({ key: ['id'], fields, rows, count: rows.length })
const rowsOf = (n, f) => Array.from({ length: n }, (_, i) => ({ id: i + 1, ...f(i) }))
for (const N of [5, 50]) {
  const names = Array.from({ length: N }, (_, i) => `s${String(i).padStart(3, '0')}`)
  const base = { users: col(rowsOf(30, i => ({ email: `u${i}@x` })), ['id', 'email']), ...Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'a' })), ['id', 'v'])])) }
  const big = { p_big0: col(rowsOf(100, () => ({ v: 1 })), ['id', 'v']), p_big1: col(rowsOf(100, () => ({ v: 1 })), ['id', 'v']) }
  const s1 = { ...base, ...big, ...Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'a', tmp: 1 })), ['id', 'v', 'tmp'])])) }
  const sn = { ...big, users: col(rowsOf(30, () => ({ email: null })), ['id', 'email']), ...Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'b' })), ['id', 'v'])])) }
  for (const h of heads) {
    const { lib, rules, snap } = mk(h)
    const b = snap(base)
    const limits = { maxCollections: N + 2 }
    const pd = lib.diffSnapshots(snap(s1, limits), snap(sn, limits))
    const flags = lib.flagChanges(lib.diffSnapshots(b, b), pd, rules, { trusted: true })
    const iu = flags.findIndex(f => f.collection === 'users')
    console.log(`stub S=${N} ${h}: users ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity]))} at ${iu} of ${flags.length}; before it: ${JSON.stringify([...new Set(flags.slice(0, iu).map(f => `${f.kind}`))])}`)
  }
  // inflated past maxRows in the PR pane only, seeded rows replaced by as many padding rows
  for (const h of heads) {
    const { lib, rules, snap } = mk(h)
    const limits = { maxRows: 100 }
    const baseU = col(rowsOf(30, i => ({ email: `u${i}@x` })), ['id', 'email'])
    const others = Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'a', tmp: 1 })), ['id', 'v', 'tmp'])]))
    const othersAfter = Object.fromEntries(names.map(n => [n, col(rowsOf(40, () => ({ v: 'b' })), ['id', 'v'])]))
    const b0 = snap({ users: baseU, ...others }, limits)
    const pr1 = snap({ users: col(rowsOf(150, i => ({ email: `u${i}@x` })), ['id', 'email']), ...others }, limits)
    const prN = snap({ users: col(rowsOf(150, i => ({ email: i < 30 ? null : `p${i}@x` })).map((r, i) => (i < 30 ? { ...r, id: 1000 + i } : r)), ['id', 'email']), ...othersAfter }, limits)
    const flags = lib.flagChanges(lib.diffSnapshots(b0, b0), lib.diffSnapshots(pr1, prN), rules, { trusted: true })
    const iu = flags.findIndex(f => f.collection === 'users')
    console.log(`maxRows S=${N} ${h}: users ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => [f.kind, f.severity]))} at ${iu} of ${flags.length}`)
  }
}
