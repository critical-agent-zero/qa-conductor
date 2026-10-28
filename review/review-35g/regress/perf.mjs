// CPU cost of the fix prototype against the head on hostile 256 KB texts.
import { heads } from './h.mjs'
const K = 256 * 1024
const texts = {
  'a: x256KB': 'a:'.repeat(K / 2),
  '<a b x256KB (no >)': '<a b '.repeat(K / 5),
  '<i type=password value=x a=… (tags)': '<i type=password value=x a=b>'.repeat(Math.floor(K / 29)),
  'Bearer bearer …': 'Bearer '.repeat(Math.floor(K / 7)),
  'u:p@tcp( …': 'u:p@tcp('.repeat(K / 8),
}
for (const h of ['4033285', 'vfix']) {
  const { mod, rules, masker } = heads[h]
  for (const [n, t] of Object.entries(texts)) {
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: i, note: t + i }))
    const c0 = process.cpuUsage()
    mod.sanitizeSnapshot({ collections: { c: { key: ['id'], rows } } }, { masker, rules })
    const c = process.cpuUsage(c0)
    console.log(h.padEnd(8), n.padEnd(40), `${Math.round((c.user + c.system) / 1000)} ms CPU for 8 cells`)
  }
}
