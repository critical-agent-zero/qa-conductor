// Differential flags fuzz: random base and PR spans over a few collections
// (deletes, updates, clears, column drops and adds, collection drops and
// adds, truncation, a long name, key loss, a dropped key), flags at 7193877
// and 4a284f9. Old column-dropped flags are folded per collection (red if
// any is red). Reports any red flag at the old head that is missing, or
// amber, at the new head, and any divergence status that changed.
import * as NEW from './new/data-diff.mjs'
import * as OLD from './old/data-diff.mjs'

const N = Number(process.argv[2] ?? 3000)
let seed = Number(process.argv[3] ?? 5)
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const chance = p => rnd() < p
const KEY = Buffer.alloc(32, 7)
const LONG = 'L'.repeat(201)

function genState(names) {
  const st = {}
  for (const name of names) {
    const n = Math.floor(rnd() * 8)
    const fields = ['id', 'email', 'role', ...(chance(0.5) ? ['tmp_a', 'tmp_b'] : [])]
    st[name] = { key: ['id'], fields, rows: Array.from({ length: n }, (_, i) => Object.fromEntries(fields.map(f => [f, f === 'id' ? i + 1 : `${f}${i}`]))), count: n }
  }
  return st
}
const clone = x => JSON.parse(JSON.stringify(x))
function mutate(st) {
  const out = clone(st)
  for (const name of Object.keys(out)) {
    const c = out[name]
    const r = rnd()
    if (r < 0.08) { delete out[name]; continue }
    if (chance(0.3)) { const k = Math.floor(rnd() * c.rows.length); c.rows.splice(k, Math.floor(rnd() * 3)) }
    if (chance(0.3)) for (const row of c.rows) if (chance(0.5)) row.role = chance(0.5) ? '' : 'admin'
    if (chance(0.2)) { const f = pick(c.fields.filter(x => x !== 'id')); if (f) { c.fields = c.fields.filter(x => x !== f); for (const row of c.rows) delete row[f] } }
    if (chance(0.1)) { c.fields.push('added'); for (const row of c.rows) row.added = 1 }
    if (chance(0.1) && c.rows.length > 1) c.rows[1].id = c.rows[0].id
    if (chance(0.1)) c.count = c.rows.length + 5
    if (chance(0.05)) c.key = null
    c.count = Math.max(c.count ?? 0, c.rows.length)
    if (!c.truncated && c.count === c.rows.length) c.count = c.rows.length
  }
  if (chance(0.15)) out.added_coll = { key: ['id'], fields: ['id'], rows: [{ id: 1 }], count: 1 }
  if (chance(0.15)) out[LONG] = { key: ['id'], fields: ['id'], rows: [{ id: 1 }], count: 1 }
  return out
}
const norm = flags => {
  const m = new Map()
  for (const f of flags) {
    const id = `${f.collection}|${f.kind}`
    const was = m.get(id)
    if (!was || f.severity === 'red') m.set(id, f.severity)
  }
  return m
}
function flagsOf(lib, b0, bn, p1, pn, trusted, limits) {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  const S = c => lib.sanitizeSnapshot({ collections: c }, { masker, rules, limits })
  const bd = lib.diffSnapshots(S(b0), S(bn))
  const pd = lib.diffSnapshots(S(p1), S(pn))
  return { flags: lib.flagChanges(bd, pd, rules, { trusted }), div: lib.divergence(bd, pd) }
}
let bad = 0
let divChanged = 0
const shown = new Set()
for (let i = 0; i < N; i++) {
  const names = ['accounts', 'users', ...(chance(0.5) ? ['orders'] : [])]
  const seedState = genState(names)
  const b0 = seedState
  const bn = chance(0.5) ? mutate(seedState) : clone(seedState)
  const p1 = chance(0.3) ? mutate(seedState) : clone(seedState)
  const pn = mutate(p1)
  const trusted = chance(0.5)
  const limits = chance(0.2) ? { maxCollections: 1 } : chance(0.2) ? { maxBytes: 600 } : undefined
  const anyLong = [b0, bn, p1, pn].some(x => LONG in x)
  if (process.argv[4] === 'nolong' && anyLong) continue
  const o = flagsOf(OLD, b0, bn, p1, pn, trusted, limits)
  const n = flagsOf(NEW, b0, bn, p1, pn, trusted, limits)
  const on = norm(o.flags)
  const nn = norm(n.flags)
  const lost = [...on].filter(([id, sev]) => sev === 'red' && nn.get(id) !== 'red')
  for (const name of Object.keys(o.div.collections)) {
    const a = o.div.collections[name].status
    const b = n.div.collections[name]?.status
    if (a !== b) {
      divChanged++
      const sig = `${name === LONG ? 'LONG' : name}:${a}->${b}`
      if (!shown.has(sig)) { shown.add(sig); console.log(`DIV ${sig} (long in p1 ${LONG in p1}, pn ${LONG in pn}, limits ${JSON.stringify(limits)})`) }
    }
  }
  const unexplained = lost.filter(([id]) => {
    const coll = id.split('|')[0]
    const sameColl = n.flags.filter(f => String(f.collection) === coll)
    if (sameColl.some(f => f.severity === 'red')) return false // still red, another kind (unverified -> dropped)
    if (sameColl.some(f => f.shared === true && f.severity === 'amber' && trusted === true)) return false // the base made the same change, now seen
    return true
  })
  if (process.argv[5] === 'explain') { if (!unexplained.length) continue; console.log('UNEXPLAINED', JSON.stringify(unexplained)) }
  if (lost.length) {
    bad++
    if (bad <= 15) console.log(`LOST red at old, not red at new: ${JSON.stringify(lost)} trusted=${trusted} limits=${JSON.stringify(limits)} long p1 ${LONG in p1} pn ${LONG in pn}\n  old ${JSON.stringify(o.flags.map(f => [f.collection?.slice(0, 8), f.kind, f.severity]))}\n  new ${JSON.stringify(n.flags.map(f => [f.collection?.slice(0, 8), f.kind, f.severity]))}`)
  }
}
console.log(`N=${N}: red flags lost ${bad}, divergence statuses changed ${divChanged}`)
