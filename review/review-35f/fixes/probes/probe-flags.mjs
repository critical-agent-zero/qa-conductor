// Flags: the round-4 fold of column-dropped, the new order, and the
// long-name omission change, at 4a284f9 (new) beside 7193877 (old).
const NEW = await import('../head/data-diff.mjs')
const OLD = await import(process.env.BASE === '4a' ? '../old4a/data-diff.mjs' : '../old79/data-diff.mjs')

const KEY = Buffer.alloc(32, 7)
const people = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i}@x`, role: 'member', ...extra }))
const col = (rows, fields, count = rows.length) => ({ key: ['id'], fields, rows, count })
const show = f => [f.collection, f.kind, f.severity, f.shared, ...(f.field ? [f.field] : []), ...(f.fields ? [`count=${f.count}`, `seeded=${f.seeded}`, f.fields] : []), ...(f.names ? [`collections=${f.collections}`] : [])]

function run(lib, label, base0, baseN, pr1, prN, { trusted = true, top = 6 } = {}) {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  const S = c => lib.sanitizeSnapshot({ collections: c }, { masker, rules })
  const b0 = S(base0)
  const bn = S(baseN)
  const p1 = S(pr1)
  const pn = S(prN)
  const bd = lib.diffSnapshots(b0, bn)
  const pd = lib.diffSnapshots(p1, pn)
  const flags = lib.flagChanges(bd, pd, rules, { trusted })
  const div = lib.divergence(bd, pd)
  return { flags, pd, div, p1, pn, out: `${label}: ${flags.length} flags; first ${top}: ${JSON.stringify(flags.slice(0, top).map(show))}` }
}

const seeded = { accounts: col([1, 2, 3, 4, 5].map(id => ({ id, name: `a${id}` })), ['id', 'name']), users: col(people(50), ['id', 'email', 'role']) }
const pad = (p, n) => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(4, '0')}`)

console.log('=== A. fold: the PR adds 5 padding columns to users at boot, the click drops them and the seeded `email`')
for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
  const padCols = pad('aa_tmp_', 5)
  const s1 = { ...seeded, users: col(people(50), ['id', 'email', 'role', ...padCols]) }
  const sn = { ...seeded, users: col(people(50).map(({ email, ...r }) => r), ['id', 'role']) }
  const r = run(lib, label, seeded, seeded, s1, sn, { top: 10 })
  console.log(r.out)
  console.log(`  ${label} users fieldsDropped in the diff: ${JSON.stringify(r.pd.collections.users.fieldsDropped)}; divergence users ${r.div.collections.users.status}, email change ${JSON.stringify(r.div.collections.users.changes.find(c => c.field === 'email'))}`)
}

console.log('\n=== A2. same with 1,600 padding columns that sort after (zz_) and before (aa_) `email`')
for (const p of ['zz_', 'aa_']) {
  const padCols = pad(p, 1600)
  const s1 = { ...seeded, users: col(people(50), ['id', 'email', 'role', ...padCols]) }
  const sn = { ...seeded, users: col(people(50).map(({ email, ...r }) => r), ['id', 'role']) }
  const r = run(NEW, `new ${p}`, seeded, seeded, s1, sn, { top: 4 })
  console.log(r.out)
}

console.log('\n=== B. fold and shared: base drops x, PR drops x and email (trusted)')
for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
  const b0 = { ...seeded, users: col(people(5, { x: 1 }), ['id', 'email', 'role', 'x']) }
  const bn = { ...seeded, users: col(people(5), ['id', 'email', 'role']) }
  const p1 = b0
  const pn = { ...seeded, users: col(people(5).map(({ email, ...r }) => r), ['id', 'role']) }
  console.log(run(lib, label, b0, bn, p1, pn).out)
}
console.log('B2. base drops x and email, PR drops email only (trusted): shared amber expected')
for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
  const b0 = { ...seeded, users: col(people(5, { x: 1 }), ['id', 'email', 'role', 'x']) }
  const bn = { ...seeded, users: col(people(5).map(({ email, ...r }) => r), ['id', 'role']) }
  const p1 = b0
  const pn = { ...seeded, users: col(people(5, { x: 1 }).map(({ email, ...r }) => r), ['id', 'role', 'x']) }
  console.log(run(lib, label, b0, bn, p1, pn).out)
}

console.log('\n=== C. order: users delete beside 1,000 PR-only collections each with a delete, and 1,000 cleared fields on accounts')
for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
  const prOwn = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`a${String(i).padStart(4, '0')}`, col([{ id: 1, v: 1 }, { id: 2, v: 2 }], ['id', 'v'])]))
  const prOwnN = Object.fromEntries(Object.keys(prOwn).map(k => [k, col([{ id: 1, v: 1 }], ['id', 'v'])]))
  const fieldsC = pad('c', 1000)
  const acc1 = col([{ id: 1, ...Object.fromEntries(fieldsC.map(f => [f, 'x'])) }], ['id', ...fieldsC])
  const accN = col([{ id: 1, ...Object.fromEntries(fieldsC.map(f => [f, ''])) }], ['id', ...fieldsC])
  const r = run(lib, label, seeded, seeded, { ...seeded, accounts: acc1, ...prOwn }, { accounts: accN, users: col(people(49), ['id', 'email', 'role']), ...prOwnN })
  console.log(r.out)
  const iu = r.flags.findIndex(f => f.collection === 'users' && f.kind === 'delete')
  const firstPrOwn = r.flags.findIndex(f => f.collection !== null && f.collection.startsWith('a0'))
  console.log(`  ${label} users delete at ${iu}; first PR-only flag at ${firstPrOwn}`)
}

console.log('\n=== D. a drop of users beside one 201-character collection, in S1, Sn or both')
for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
  const long = 'x'.repeat(201)
  for (const where of ['Sn', 'S1', 'both']) {
    const extra = col([{ id: 1 }], ['id'])
    const s1 = { ...seeded, ...(where !== 'Sn' ? { [long]: extra } : {}) }
    const sn = { accounts: seeded.accounts, ...(where !== 'S1' ? { [long]: extra } : {}) }
    const r = run(lib, `${label} long in ${where}`, seeded, seeded, s1, sn)
    console.log(`${r.out}; omitted S1 ${r.p1.omitted} Sn ${r.pn.omitted}; divergence users ${r.div.collections.users.status}`)
  }
}

console.log('\n=== E. a wipe of users beside 11,000 empty PR tables (users ties them at 0 rows in Sn)')
for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
  const empty = Object.fromEntries(Array.from({ length: 11_000 }, (_, i) => [`t${String(i).padStart(5, '0')}`, col([], ['id'])]))
  const s1 = { ...seeded, ...empty }
  const sn = { accounts: seeded.accounts, users: col([], ['id', 'email', 'role']), ...empty }
  for (const trusted of [true, false]) {
    const r = run(lib, `${label} trusted=${trusted}`, seeded, seeded, s1, sn, { trusted, top: 3 })
    const iu = r.flags.findIndex(f => f.collection === 'users')
    console.log(`${r.out}; users at ${iu}: ${JSON.stringify(show(r.flags[iu]))}; diff users ${JSON.stringify({ status: r.pd.collections.users.status, omitted: r.pd.collections.users.omitted })}; divergence ${r.div.collections.users.status}; red ${r.flags.filter(f => f.severity === 'red').length}`)
  }
}

console.log('\n=== F. a wipe of users beside 11,000 empty tables, plus per-seeded-collection padding (S seeded collections, each with a PR row deleted, a column dropped, 21 rows mass-deleted, key lost)')
for (const S of [10, 100]) {
  for (const [label, lib] of [['old', OLD], ['new', NEW]]) {
    const extraSeeded = Object.fromEntries(Array.from({ length: S }, (_, i) => [`s${String(i).padStart(3, '0')}`, col([{ id: 0 }], ['id'])]))
    const base = { ...seeded, ...extraSeeded }
    const empty = Object.fromEntries(Array.from({ length: 11_000 }, (_, i) => [`t${String(i).padStart(5, '0')}`, col([], ['id'])]))
    const s1 = { ...base, ...empty, ...Object.fromEntries(Object.keys(extraSeeded).map(k => [k, col(Array.from({ length: 22 }, (_, j) => ({ id: j, pad: 1 })), ['id', 'pad'])])) }
    const sn = { accounts: seeded.accounts, users: col([], ['id', 'email', 'role']), ...empty, ...Object.fromEntries(Object.keys(extraSeeded).map(k => [k, { key: ['id'], fields: ['id'], rows: [{ id: 0 }, { id: 0 }], count: 2 }])) }
    const r = run(lib, `${label} S=${S}`, base, base, s1, sn, { top: 2 })
    const iu = r.flags.findIndex(f => f.collection === 'users')
    console.log(`${r.out}; users at ${iu} of ${r.flags.length}: ${JSON.stringify(show(r.flags[iu]))}`)
  }
}
