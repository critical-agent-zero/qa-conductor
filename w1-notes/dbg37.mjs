import { readFileSync } from 'node:fs'
import { createMasker, diffSnapshots, divergence, flagChanges, sanitizeSnapshot, validateRules } from '../repo/lib/data-diff.mjs'
const m = { exports: {} }
new Function('module', 'exports', readFileSync(new URL('../repo/public/harness.js', import.meta.url), 'utf8'))(m, m.exports)
const { dataNodes } = m.exports
const rules = validateRules({ classify: [{ collection: 'members', fields: ['email'], as: 'pii' }] })
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const snap = collections => sanitizeSnapshot({ collections }, { masker, rules })
const at = (sessions, members) => snap({
  sessions: { key: ['session_id'], fields: ['session_id', 'n'], rows: sessions },
  members: { key: ['email'], fields: ['email', 'n'], rows: members },
})
const before = at([{ session_id: 'sess-0123456789', n: 1 }, { session_id: 'sess-9876543210', n: 1 }], [{ email: 'jane@example.org', n: 1 }, { email: 'li@example.org', n: 1 }])
const after = at([{ session_id: 'sess-9876543210', n: 2 }], [{ email: 'li@example.org', n: 2 }])
console.log(JSON.stringify(before.collections.sessions, null, 1).slice(0, 600))
const pr = diffSnapshots(before, after)
console.log(JSON.stringify(pr.collections.sessions, null, 1).slice(0, 900))
const plain = s => String(s).replace(/[⁨⁩]/g, '')
const textsOf = nodes => nodes.flatMap(n => [...(n.text === undefined ? [] : [plain(n.text)]), ...textsOf(n.children || [])])
const data = { available: true, active: true, trust: 'trusted', errors: {}, problems: { base: [], pr: [] }, boot: null, session: { complete: true, base: pr, pr, divergence: divergence(pr, pr), flags: flagChanges(pr, pr, rules, { trusted: true }) } }
console.log(textsOf(dataNodes(data, { span: 'session', view: 'pr', open: 1 })).join('\n'))
