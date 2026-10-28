// E7: the surviving mutant 'column-dropped shared by count' on probe-fold (b):
// base drops legacy, PR drops email, trusted. Head says red; the mutant?
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const here = new URL('.', import.meta.url).pathname
const src = readFileSync(`${here}repo/lib/data-diff.mjs`, 'utf8')
const from = 'const shared = theirs !== undefined && (mine.items === null && theirs.items === null'
const to = "const shared = theirs !== undefined && (mine.kind === 'column-dropped' || mine.items === null && theirs.items === null"
if (src.split(from).length !== 2) throw new Error('not found once')
mkdirSync(`${here}mutcols`, { recursive: true })
writeFileSync(`${here}mutcols/data-diff.mjs`, src.replace(from, to))
for (const [label, path] of [['head', './repo/lib/data-diff.mjs'], ['mutant', './mutcols/data-diff.mjs']]) {
  const E = await import(path)
  const rules = E.validateRules({})
  const masker = E.createMasker({ key: Buffer.alloc(32, 7), rules })
  const S = c => E.sanitizeSnapshot({ collections: c }, { masker, rules })
  const users = fields => ({ users: { key: ['id'], fields, rows: [{ id: 1 }] } })
  const c0 = S(users(['id', 'email', 'legacy']))
  const flags = E.flagChanges(E.diffSnapshots(c0, S(users(['id', 'email']))), E.diffSnapshots(c0, S(users(['id', 'legacy']))), rules, { trusted: true })
  console.log(label, JSON.stringify(flags.map(f => [f.collection, f.kind, f.severity, f.shared, f.fields])))
}
