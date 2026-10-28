// E5: the folded column-dropped flag. (a) A real drop's name behind five
// PR-added columns that sort first. (b) Same number of different columns
// dropped by base and PR (the count-based sharing mutant's case). (c) The
// cleared flag's `shared` across rows (the merge mutants' case).
import * as E from '../head/data-diff.mjs'
const rules = E.validateRules({})
const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
const S = collections => E.sanitizeSnapshot({ collections }, { masker, rules })
const users = (fields, n = 3) => ({ users: { key: ['id'], fields, rows: Array.from({ length: n }, (_, i) => Object.fromEntries(fields.map(f => [f, f === 'id' ? i + 1 : `${f}${i}`]))) } })
const seed = users(['id', 'email', 'role'])
const s0 = S(seed)
const baseDiff = E.diffSnapshots(s0, s0)
// (a) the PR's migration adds a0..a4; the click drops them and email
const pad = ['a0', 'a1', 'a2', 'a3', 'a4']
const s1 = S(users(['id', 'email', 'role', ...pad]))
const sn = S(users(['id', 'role']))
const pr = E.diffSnapshots(s1, sn)
for (const trusted of [true, false]) {
  const flags = E.flagChanges(baseDiff, pr, rules, { trusted })
  console.log(`(a) trusted=${trusted}: flags ${JSON.stringify(flags)}; any flag names email: ${JSON.stringify(flags).includes('email')}`)
}
const div = E.divergence(baseDiff, pr).collections.users
console.log(`(a) divergence users ${div.status}; field changes ${JSON.stringify(div.changes.filter(c => c.kind === 'field-dropped').map(c => [c.field, c.status]))}`)
// at 7193877, per field
const OLD = await import('../old79/data-diff.mjs')
{
  const r = OLD.validateRules({})
  const m = OLD.createMasker({ key: Buffer.alloc(32, 7), rules: r })
  const So = c => OLD.sanitizeSnapshot({ collections: c }, { masker: m, rules: r })
  const b = So(seed)
  const f = OLD.flagChanges(OLD.diffSnapshots(b, b), OLD.diffSnapshots(So(users(['id', 'email', 'role', ...pad])), So(users(['id', 'role']))), r, { trusted: true })
  console.log(`(a) at 7193877: ${JSON.stringify(f.map(x => [x.kind, x.field, x.severity]))}`)
}
// (b) base drops legacy, PR drops email: same count, other columns
{
  const c0 = S(users(['id', 'email', 'legacy']))
  const flags = E.flagChanges(E.diffSnapshots(c0, S(users(['id', 'email']))), E.diffSnapshots(c0, S(users(['id', 'legacy']))), rules, { trusted: true })
  console.log(`(b) base dropped legacy, PR dropped email, trusted: ${JSON.stringify(flags)}`)
}
// (c) base clears row 1's role, PR clears rows 1..3
{
  const rows = cleared => ({ t: { key: ['id'], rows: [1, 2, 3].map(id => ({ id, role: cleared.includes(id) ? '' : 'r' })) } })
  const c0 = S(rows([]))
  const flags = E.flagChanges(E.diffSnapshots(c0, S(rows([3]))), E.diffSnapshots(c0, S(rows([1, 2, 3]))), rules, { trusted: true })
  console.log(`(c) base cleared row 3, PR rows 1-3: ${JSON.stringify(flags)}`)
}
