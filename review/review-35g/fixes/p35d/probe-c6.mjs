// C6: update ids now carry new values. The same action in both panes that
// writes a time (read_at = now()) gives other values in each pane: is a
// trusted, genuinely shared mass change now red? And with read_at volatile?
import { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, flagChanges } from './repo/lib/data-diff.mjs'
import * as OLD from './old79/data-diff.mjs'
const KEY = Buffer.alloc(32, 7)
for (const [label, lib] of [['2ec0bba', { createMasker, sanitizeSnapshot, validateRules, diffSnapshots, flagChanges }], ['79e3efc', OLD]]) {
  for (const rulesIn of [{}, { volatile: [{ collection: 'notes', fields: ['read_at'], mode: 'presence' }] }]) {
    let rules
    try { rules = lib.validateRules(rulesIn) } catch (e) { console.log(label, 'rules refused', e.message); continue }
    const masker = lib.createMasker({ key: KEY, rules })
    const s = at => lib.sanitizeSnapshot({ collections: { notes: { key: ['id'], rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, read_at: at })) } } }, { masker, rules })
    const seed = s(null)
    const base = lib.diffSnapshots(seed, s('2026-10-15T17:00:01.123Z'))
    const pr = lib.diffSnapshots(seed, s('2026-10-15T17:00:04.567Z'))
    console.log(label, JSON.stringify(rulesIn), JSON.stringify(lib.flagChanges(base, pr, rules, { trusted: true }).map(f => [f.kind, f.severity, f.shared])))
  }
}
