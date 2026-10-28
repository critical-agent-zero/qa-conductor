// E1: the round-4 column-dropped medium and the omitted medium, re-run at 4a284f9
// with the review-35d probe-flood / probe-d4 / probe-d6 shapes.
import * as E from './repo/lib/data-diff.mjs'
const rules = E.validateRules({})
const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
const S = collections => E.sanitizeSnapshot({ collections }, { masker, rules })
const show = flags => flags.map((f, i) => `${i}:${f.collection}:${f.kind}/${f.severity}${f.count !== undefined ? `(count ${f.count}, fields ${JSON.stringify(f.fields)})` : ''}`)

console.log('--- probe-flood shape: 1,598 extra columns on accounts, dropped; users 50 -> 1')
{
  const WIDE = 1600
  const extra = Array.from({ length: WIDE - 2 }, (_, i) => `c${String(i).padStart(4, '0')}`)
  const accounts = (cols, n = 10) => ({ key: ['id'], fields: ['id', 'name', ...cols], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `a${i}` })), count: n })
  const users = n => ({ key: ['id'], fields: ['id', 'email', 'role'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role: 'member' })), count: n })
  const seed = { accounts: accounts([]), users: users(50) }
  const baseS = S(seed)
  const base = E.diffSnapshots(baseS, baseS)
  const pr = E.diffSnapshots(S({ accounts: accounts(extra), users: users(50) }), S({ accounts: accounts([]), users: users(1) }))
  for (const trusted of [true, false]) {
    const flags = E.flagChanges(base, pr, rules, { trusted })
    const ud = flags.findIndex(f => f.collection === 'users' && f.kind === 'delete')
    console.log(`trusted=${trusted}: ${flags.length} flags; users delete at ${ud}; within first 10: ${ud >= 0 && ud < 10}; ${JSON.stringify(show(flags))}`)
  }
  // base dropped the same 1,598 too (trusted) -> shared/amber; base dropped all but one -> not shared
  const baseSame = E.diffSnapshots(S({ accounts: accounts(extra), users: users(50) }), S({ accounts: accounts([]), users: users(50) }))
  const baseMost = E.diffSnapshots(S({ accounts: accounts(extra), users: users(50) }), S({ accounts: accounts([extra[0]]), users: users(50) }))
  for (const [label, b] of [['base dropped all the same', baseSame], ['base dropped all but c0000', baseMost]]) {
    const f = E.flagChanges(b, pr, rules, { trusted: true }).find(x => x.kind === 'column-dropped')
    console.log(`  ${label}: column-dropped ${JSON.stringify(f)}`)
  }
}

console.log('--- probe-d4 shapes (engine only)')
{
  const P = 1600
  const pad = Array.from({ length: P }, (_, i) => `zz_pad_${String(i).padStart(4, '0')}`)
  const people = (n, role = 'member') => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role }))
  const accts = [1, 2, 3, 4, 5].map(id => ({ id, name: `a${id}` }))
  const col = (rows, fields) => ({ key: ['id'], fields, rows, count: rows.length })
  const baseState = { accounts: col(accts, ['id', 'name']), users: col(people(50), ['id', 'email', 'role']) }
  const variants = {
    'pad accounts, wipe users': [{ accounts: col(accts, ['id', 'name', ...pad]), users: col(people(50), ['id', 'email', 'role']) }, { accounts: col(accts, ['id', 'name']), users: col([], ['id', 'email', 'role']) }],
    'pad users itself, mass-update users': [{ accounts: col(accts, ['id', 'name']), users: col(people(50), ['id', 'email', 'role', ...pad]) }, { accounts: col(accts, ['id', 'name']), users: col(people(50, 'admin'), ['id', 'email', 'role']) }],
    'real drop of users.email, beside a pad on accounts': [{ accounts: col(accts, ['id', 'name', ...pad]), users: col(people(50), ['id', 'email', 'role']) }, { accounts: col(accts, ['id', 'name']), users: col(people(50).map(({ email, ...r }) => r), ['id', 'role']) }],
    'real drop of users.email only': [baseState, { accounts: col(accts, ['id', 'name']), users: col(people(50).map(({ email, ...r }) => r), ['id', 'role']) }],
  }
  const b = S(baseState)
  for (const [label, [s1, sn]] of Object.entries(variants)) {
    for (const trusted of [true, false]) {
      const flags = E.flagChanges(E.diffSnapshots(b, b), E.diffSnapshots(S(s1), S(sn)), rules, { trusted })
      console.log(`${label} [trusted=${trusted}]: ${flags.length} flags ${JSON.stringify(show(flags))}`)
    }
  }
}

console.log('--- probe-d6: a 201-char collection beside a drop of users')
{
  const people = n => ({ key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })), count: n })
  const long = 'x'.repeat(201)
  const orders = { key: ['id'], rows: [1, 2, 3].map(id => ({ id })), count: 3 }
  const base = S({ users: people(50), orders })
  const baseDiff = E.diffSnapshots(base, base)
  for (const [label, s1, sn] of [
    ['drop users (control)', { users: people(50), orders }, { orders }],
    ['drop users, one 201-char collection in Sn', { users: people(50), orders }, { orders, [long]: people(1) }],
    ['drop users, 201-char collection in S1 and Sn', { users: people(50), orders, [long]: people(1) }, { orders, [long]: people(1) }],
    ['drop users and empty orders, 201-char in Sn', { users: people(50), orders }, { orders: people(0), [long]: people(1) }],
    ['drop users, 200-char (kept) collection in Sn', { users: people(50), orders }, { orders, ['y'.repeat(200)]: people(1) }],
  ]) {
    const a = S(s1)
    const b = S(sn)
    const pr = E.diffSnapshots(a, b)
    for (const trusted of [true, false]) {
      const flags = E.flagChanges(baseDiff, pr, rules, { trusted })
      console.log(`${label.padEnd(48)} [t=${trusted}] Sn.omitted ${b.omitted} problems ${JSON.stringify(b.problems)}; users ${JSON.stringify({ status: pr.collections.users.status, omitted: pr.collections.users.omitted })}; flags ${JSON.stringify(flags.map(f => [f.collection, f.kind, f.severity]))}; divergence ${E.divergence(baseDiff, pr).collections.users.status}`)
    }
  }
  // left out for a long name AND for another reason (unreadable): omitted must still be non-zero
  const throwing = { orders, get bad() { throw new Error('boom') } }
  const odd = { orders, [long]: people(1) }
  Object.defineProperty(odd, 'zbad', { enumerable: true, get() { throw new Error('boom') } })
  const sn = S(odd)
  console.log(`long + unreadable: omitted ${sn.omitted}, problems ${JSON.stringify(sn.problems)}`)
  const sn2 = S({ orders, [long]: people(1), zbad: { rows: 'nope' } })
  console.log(`long + malformed: omitted ${sn2.omitted}, problems ${JSON.stringify(sn2.problems)}; users status ${E.diffSnapshots(S({ users: people(50), orders }), sn2).collections.users.status}`)
  // a 201-char name excluded by rule and long: total counts excluded names? (excluded are filtered before total)
}

console.log('--- probe-omit2 (documented: name->count stubs): 11,000 empty PR tables beside a wipe of users')
{
  const users = n => ({ key: ['id'], fields: ['id', 'email'], rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x` })), count: n })
  const pad = Object.fromEntries(Array.from({ length: 11000 }, (_, i) => [`t${String(i).padStart(5, '0')}`, { key: ['id'], fields: ['id'], rows: [], count: 0 }]))
  const baseS = S({ users: users(50) })
  const base = E.diffSnapshots(baseS, baseS)
  const pr = E.diffSnapshots(S({ ...pad, users: users(50) }), S({ ...pad, users: users(0) }))
  for (const trusted of [true, false]) {
    const flags = E.flagChanges(base, pr, rules, { trusted })
    console.log(`[t=${trusted}] users flags ${JSON.stringify(flags.filter(f => f.collection === 'users').map(f => `${f.kind}/${f.severity}`))} at index ${flags.findIndex(f => f.collection === 'users')} of ${flags.length}; divergence ${E.divergence(base, pr).collections.users.status}`)
  }
}
