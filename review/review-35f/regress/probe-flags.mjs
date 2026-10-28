// Hiding: the seeded-first column-dropped listing and the left-out
// unverified order, at 7193877, 4a284f9 and 4ed6449.
import { LIBS, KEY } from './h.mjs'

const heads = ['7193877', '4a284f9', '4ed6449']
const people = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role: 'member', ...extra }))
const col = (rows, fields, count = rows.length) => ({ key: ['id'], fields, rows, count })
const pad = (p, n) => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(4, '0')}`)
const show = f => [f.collection, f.kind, f.severity, f.shared, ...(f.field ? [f.field] : []), ...(f.count !== undefined ? [`count=${f.count}`, `seeded=${f.seeded}`, f.fields] : []), ...(f.names ? [`collections=${f.collections}`] : [])]
const omit = (rows, k) => rows.map(r => { const c = { ...r }; delete c[k]; return c })

function run(h, base0, baseN, pr1, prN, { trusted = true, limits } = {}) {
  const lib = LIBS[h]
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  const S = c => lib.sanitizeSnapshot({ collections: c }, { masker, rules, limits })
  const b0 = S(base0); const bn = S(baseN); const p1 = S(pr1); const pn = S(prN)
  const bd = lib.diffSnapshots(b0, bn)
  const pd = lib.diffSnapshots(p1, pn)
  return { flags: lib.flagChanges(bd, pd, rules, { trusted }), pd, bd, p1, pn, div: lib.divergence(bd, pd) }
}
const seeded = { accounts: col([1, 2, 3, 4, 5].map(id => ({ id, name: `a${id}` })), ['id', 'name']), users: col(people(50), ['id', 'email', 'role']) }
const usersFlag = r => r.flags.filter(f => f.collection === 'users').map(show)
const names = r => JSON.stringify(r.flags.filter(f => f.collection === 'users' && f.kind === 'column-dropped').map(f => f.fields))

console.log('=== A. round 5 medium: the PR adds aa_tmp_0000..0004 at boot; the click drops them and seeded email')
for (const h of heads) {
  const s1 = { ...seeded, users: col(people(50, Object.fromEntries(pad('aa_tmp_', 5).map(c => [c, 1]))), ['id', 'email', 'role', ...pad('aa_tmp_', 5)]) }
  const sn = { ...seeded, users: col(omit(people(50), 'email'), ['id', 'role']) }
  for (const trusted of [true, false]) console.log(`${h} trusted=${trusted}: ${JSON.stringify(usersFlag(run(h, seeded, seeded, s1, sn, { trusted })))}`)
}

console.log('\n=== B. rename: the PR boot migration renames email -> aa_email (data kept), adds aa_tmp padding; the click drops all of them')
for (const h of heads) {
  const rows1 = people(50).map(({ email, ...r }) => ({ ...r, aa_email: email }))
  const s1 = { ...seeded, users: col(rows1, ['id', 'aa_email', 'role', ...pad('aa_tmp_', 5)]) }
  const sn = { ...seeded, users: col(omit(rows1, 'aa_email'), ['id', 'role']) }
  const r = run(h, seeded, seeded, s1, sn)
  console.log(`${h}: ${JSON.stringify(usersFlag(r))}; names aa_email: ${names(r).includes('aa_email')}`)
}
console.log('B2. rename case-only: email -> Email, padding Aa_tmp (sorts before)')
for (const h of heads) {
  const rows1 = people(50).map(({ email, ...r }) => ({ ...r, Email: email }))
  const s1 = { ...seeded, users: col(rows1, ['id', 'Email', 'role', ...pad('A_', 5)]) }
  const sn = { ...seeded, users: col(omit(rows1, 'Email'), ['id', 'role']) }
  const r = run(h, seeded, seeded, s1, sn)
  console.log(`${h}: ${JSON.stringify(usersFlag(r))}`)
}

console.log('\n=== C. advisory: the PR (not isolated) also adds aa_tmp padding to the BASE pane at boot, so the base before snapshot declares it')
for (const h of heads) {
  const s1 = { ...seeded, users: col(people(50), ['id', 'email', 'role', ...pad('aa_tmp_', 5)]) }
  const sn = { ...seeded, users: col(omit(people(50), 'email'), ['id', 'role']) }
  for (const trusted of [false]) console.log(`${h} trusted=${trusted}: ${JSON.stringify(usersFlag(run(h, s1, s1, s1, sn, { trusted })))}`)
}

console.log('\n=== D. seeded comes from the base: base declares [id,email,role]; the PR S1 declares more; base diff fields null (schemaless base inspector)')
for (const h of heads) {
  const s1 = { ...seeded, users: col(people(50), ['id', 'email', 'role', ...pad('aa_tmp_', 5)]) }
  const sn = { ...seeded, users: col(omit(people(50), 'email'), ['id', 'role']) }
  const b = { ...seeded, users: { key: ['id'], rows: people(50), count: 50 } }
  console.log(`${h} base without fields: ${JSON.stringify(usersFlag(run(h, b, b, s1, sn)))}`)
}

console.log('\n=== D2. the base pane cut users short (count-only stub in base S1): fieldsBefore null')
for (const h of heads) {
  const s1 = { ...seeded, users: col(people(50), ['id', 'email', 'role', ...pad('aa_tmp_', 5)]) }
  const sn = { ...seeded, users: col(omit(people(50), 'email'), ['id', 'role']) }
  // base pane snapshot over maxRows: kept with fields, truncated
  const r = run(h, seeded, seeded, s1, sn, { limits: { maxRows: 10 } })
  console.log(`${h} base truncated by maxRows (fields kept): ${JSON.stringify(usersFlag(r))}`)
}

console.log('\n=== E. a wipe hidden by 11,000 empty PR tables, plus padding on S other seeded collections')
for (const S of [10, 100]) {
  for (const h of heads) {
    const extraSeeded = Object.fromEntries(Array.from({ length: S }, (_, i) => [`s${String(i).padStart(3, '0')}`, col([{ id: 0 }], ['id'])]))
    const base = { ...seeded, ...extraSeeded }
    const empty = Object.fromEntries(Array.from({ length: 11_000 }, (_, i) => [`t${String(i).padStart(5, '0')}`, col([], ['id'])]))
    const s1 = { ...base, ...empty, ...Object.fromEntries(Object.keys(extraSeeded).map(k => [k, col(Array.from({ length: 22 }, (_, j) => ({ id: j, pad: 1 })), ['id', 'pad'])])) }
    const sn = { accounts: seeded.accounts, users: col([], ['id', 'email', 'role']), ...empty, ...Object.fromEntries(Object.keys(extraSeeded).map(k => [k, { key: ['id'], fields: ['id'], rows: [{ id: 0 }, { id: 0 }], count: 2 }])) }
    const r = run(h, base, base, s1, sn)
    const iu = r.flags.findIndex(f => f.collection === 'users')
    console.log(`${h} S=${S}: users at ${iu} of ${r.flags.length}: ${JSON.stringify(show(r.flags[iu]))}; diff ${JSON.stringify({ st: r.pd.collections.users?.status, om: r.pd.collections.users?.omitted })}`)
  }
}

console.log('\n=== F. deletes hidden by a PR-only cut: the PR inflates seeded users past maxRows (100 here) at boot; the click deletes the 50 seeded users and inserts 50 padding rows; padding on S other seeded collections')
for (const S of [10, 100]) {
  for (const h of heads) {
    const extraSeeded = Object.fromEntries(Array.from({ length: S }, (_, i) => [`s${String(i).padStart(3, '0')}`, col([{ id: 0 }], ['id'])]))
    const base = { ...seeded, ...extraSeeded }
    const inflated = [...people(50), ...Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, email: `p${i}@x`, role: 'pad' }))]
    const afterRows = [...inflated.slice(50), ...Array.from({ length: 50 }, (_, i) => ({ id: 5000 + i, email: `q${i}@x`, role: 'pad' }))]
    const s1 = { ...base, users: col(inflated, ['id', 'email', 'role']), ...Object.fromEntries(Object.keys(extraSeeded).map(k => [k, col(Array.from({ length: 22 }, (_, j) => ({ id: j, pad: 1 })), ['id', 'pad'])])) }
    const sn = { ...base, users: col(afterRows, ['id', 'email', 'role']), ...Object.fromEntries(Object.keys(extraSeeded).map(k => [k, { key: ['id'], fields: ['id'], rows: [{ id: 0 }, { id: 0 }], count: 2 }])) }
    const r = run(h, base, base, s1, sn, { limits: { maxRows: 100 } })
    const iu = r.flags.findIndex(f => f.collection === 'users')
    console.log(`${h} S=${S}: users at ${iu} of ${r.flags.length}: ${JSON.stringify(show(r.flags[iu]))}; users flags ${r.flags.filter(f => f.collection === 'users').length}; diff ${JSON.stringify({ st: r.pd.collections.users?.status, tr: r.pd.collections.users?.truncated, del: r.pd.collections.users?.deleted.length })}`)
  }
}

console.log('\n=== G. column drop shared check unchanged: base drops legacy, PR drops email (trusted)')
for (const h of heads) {
  const c0 = { users: col(people(5, { legacy: 1 }), ['id', 'email', 'role', 'legacy']) }
  const r = run(h, c0, { users: col(omit(people(5), 'email').map(r => ({ ...r, email: undefined })).map(({ email, ...r }) => ({ ...r, email: 'x' })), ['id', 'email', 'role']) }, c0, { users: col(omit(people(5, { legacy: 1 }), 'email'), ['id', 'role', 'legacy']) })
  console.log(`${h}: ${JSON.stringify(r.flags.filter(f => f.kind === 'column-dropped').map(show))}`)
}
