// Over-masking at 4ed6449 against 4a284f9: masks that land on keys or ids,
// and whether the diffs still match rows.
import { LIBS, KEY } from './h.mjs'

const heads = ['4a284f9', '4ed6449']
function run(h, s1, sn, base = null) {
  const lib = LIBS[h]
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  const S = c => lib.sanitizeSnapshot({ collections: c }, { masker, rules })
  const a = S(s1); const b = S(sn)
  const pd = lib.diffSnapshots(a, b)
  const bd = base ? lib.diffSnapshots(S(base[0]), S(base[1])) : lib.diffSnapshots(a, a)
  return { a, pd, flags: lib.flagChanges(bd, pd, rules, { trusted: true }) }
}
const sum = (r, c) => { const d = r.pd.collections[c]; return JSON.stringify({ st: d.status, ins: d.inserted.length, upd: d.updated.length, del: d.deleted.length, key: d.key, flags: r.flags.map(f => [f.collection, f.kind, f.severity]) }) }

console.log('=== O1. versioned rows keyed [id, v]; a row whose name looks secret; the click renames it (v unchanged)')
for (const h of heads) {
  const rows = n => [{ id: 1, v: 3, name: n, body: 'x' }, { id: 2, v: 1, name: 'Home', body: 'y' }]
  const r = run(h, { pages: { key: ['id', 'v'], fields: ['id', 'v', 'name', 'body'], rows: rows('Session expired page') } }, { pages: { key: ['id', 'v'], fields: ['id', 'v', 'name', 'body'], rows: rows('Expired page') } })
  console.log(`${h}: S1 row ${JSON.stringify(r.a.collections.pages.rows[0])}\n   diff ${sum(r, 'pages')}`)
}

console.log('\n=== O2. a lookup table keyed [value]; names that look secret; the click renames one')
for (const h of heads) {
  const rows = n => [{ value: 'opt_reset', name: n }, { value: 'opt_home', name: 'Home' }]
  const r = run(h, { options: { key: ['value'], fields: ['value', 'name'], rows: rows('Password reset') } }, { options: { key: ['value'], fields: ['value', 'name'], rows: rows('Reset') } })
  console.log(`${h}: S1 rows ${JSON.stringify(r.a.collections.options.rows)}\n   diff ${sum(r, 'options')}`)
}

console.log('\n=== O3. settings keyed [key]: the click renames a key from secret-looking to not, value unchanged')
for (const h of heads) {
  const r = run(h, { settings: { key: ['id'], fields: ['id', 'key', 'value'], rows: [{ id: 1, key: 'session_timeout', value: '30' }] } }, { settings: { key: ['id'], fields: ['id', 'key', 'value'], rows: [{ id: 1, key: 'idle_timeout', value: '30' }] } })
  console.log(`${h}: S1 ${JSON.stringify(r.a.collections.settings.rows)}\n   diff ${sum(r, 'settings')} updated ${JSON.stringify(r.pd.collections.settings.updated)}`)
}

console.log('\n=== O4. settings rows whose values are ordinary config under secret-looking names')
for (const h of heads) {
  const r = run(h, { settings: { key: ['id'], rows: [{ id: 1, key: 'session_timeout', value: '30' }, { id: 2, key: 'card_layout', value: 'grid' }, { id: 3, key: 'hash_algorithm', value: 'bcrypt' }, { id: 4, name: 'Passport photo', value: 'https://x/p.png' }] } }, { settings: { key: ['id'], rows: [] } })
  console.log(`${h}: ${JSON.stringify(r.a.collections.settings.rows)}`)
}

console.log('\n=== O5. ids in text: percent-escaped paths and DSN-like ids as a key')
for (const h of heads) {
  const ids = ['/a%2Fsession=1', '/a%2Fsession=2', 'acct:42@/org', 'acct:43@/org', 'ns:x@(y)', 'x%3dpw=1']
  const r = run(h, { r: { key: ['path'], fields: ['path', 'n'], rows: ids.map((p, i) => ({ path: p, n: i })) } }, { r: { key: ['path'], fields: ['path', 'n'], rows: ids.map((p, i) => ({ path: p, n: i + (i === 0 ? 1 : 0) })) } })
  console.log(`${h}: keys ${JSON.stringify(r.a.collections.r.rows.map(x => x.path))}\n   key kept ${JSON.stringify(r.a.collections.r.key)}; diff ${sum(r, 'r')}`)
}
