// Over-masking: non-secret ids and keys that 4033285 masks and 4ed6449 kept,
// and whether keyed diffs of them still match (same rows -> same; a changed
// id -> one insert and one delete).
import { maskValues, heads, NEW } from './h.mjs'
import { rng, ID_TEMPLATES } from './gen.mjs'

const seed = Number(process.argv[2] ?? 1)
const total = Number(process.argv[3] ?? 50000)
const r = rng(seed)
const NAMES = Object.keys(ID_TEMPLATES)
const JOINS = ['', ' ', ';', ',', ':', '/', '|']
const seen = new Map()
let cases = 0
const BATCH = 500
for (let done = 0; done < total; done += BATCH) {
  const vals = []
  for (let i = 0; i < BATCH; i++) {
    const k = 1 + r.int(3)
    let t = ''
    for (let j = 0; j < k; j++) t += (j ? r.pick(JOINS) : '') + ID_TEMPLATES[r.pick(NAMES)](r)
    vals.push(t)
  }
  const out = maskValues(vals, { heads: ['4ed6449', '4a284f9', NEW] })
  vals.forEach((v, i) => {
    const vis = s => (s.includes('[text with a secret') ? 0 : s.replace(/\[secret [0-9a-f]{8}\]/g, '').length)
    if (vis(out[NEW][i]) < vis(out['4ed6449'][i])) {
      const sig = v.replace(/\d+/g, 'N').replace(/[0-9a-f]{16,}/g, 'H').slice(0, 60)
      if (!seen.has(sig)) seen.set(sig, { v, head: out[NEW][i], old: out['4ed6449'][i], a: out['4a284f9'][i] })
    }
  })
  cases += BATCH
}
console.log('cases', cases, 'distinct newly masked shapes', seen.size)
for (const [, x] of [...seen].slice(0, 25)) console.log(JSON.stringify(x))

// keyed diffs over newly masked ids still match
const { mod, rules, masker } = heads[NEW]
const ids = [...seen.values()].map(x => x.v).slice(0, 5000)
if (ids.length) {
  const rows = ids.map((id, i) => ({ id, n: i }))
  const snap = rs => mod.sanitizeSnapshot({ collections: { t: { key: ['id'], rows: rs } } }, { masker, rules })
  const a = snap(rows)
  const b = snap(rows.map((row, i) => (i === 0 ? { ...row, id: `${row.id}x` } : row)))
  const same = mod.diffSnapshots(a, snap(rows)).collections.t
  const ch = mod.diffSnapshots(a, b).collections.t
  console.log('key kept:', JSON.stringify(a.collections.t.key), 'same ->', same.status, '| one id changed ->', ch.status, 'ins', ch.inserted.length, 'del', ch.deleted.length, 'upd', ch.updated.length)
}
