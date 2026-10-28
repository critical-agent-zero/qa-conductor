// Whole rows and JSON documents: pairs, settings rows with various declared
// keys, rawHeaders, nested JSON. A regression: a secret fragment 4033285
// shows that an earlier head hid.
import { maskRows, HEAD_NAMES, NEW, OLD, leaked } from './h.mjs'
import { rng, secret, fragsOf } from './gen.mjs'

const seed = Number(process.argv[2] ?? 1)
const total = Number(process.argv[3] ?? 20000)
const r = rng(seed)
const NAMEK = ['name', 'key', 'Name', 'Key', 'NAME', 'KEY', 'field', 'k', 'option_name', 'setting']
const VALK = ['value', 'Value', 'VALUE', 'val', 'v', 'option_value']
const SECN = ['smtp_password', 'STRIPE_SECRET_KEY', 'api_token', 'DbPassword', 'session_secret', 'pin', 'db-password', 'Authorization']
const PLAIN = ['site_name', 'theme', 'max_rows', 'timezone']
const sigs = new Map()
let cases = 0
let regress = 0
for (let done = 0; done < total; done++) {
  const s = secret(r)
  const frags = fragsOf(s)
  if (!frags.length) continue
  const nk = r.pick(NAMEK)
  let vk = r.pick(VALK)
  const row = {}
  if (r.chance(0.7)) row.id = r.int(1000)
  row[nk] = r.chance(0.85) ? r.pick(SECN) : r.pick(PLAIN)
  if (vk === nk) vk = 'value'
  row[vk] = r.chance(0.8) ? s : r.pick([{ inner: s }, [s], JSON.stringify({ x: s }), `x ${s}`])
  const extra = r.int(9)
  for (let i = 0; i < extra; i++) row[`f${i}`] = r.pick(['a', 1, true, null])
  // JSON-doc variant: the pair inside a column
  let rowIn = row
  if (r.chance(0.35)) rowIn = { id: r.int(1000), doc: r.pick([[row], { item: row }, JSON.stringify([row]), ['x', row[nk], row[vk]]]) }
  const fields = Object.keys(rowIn)
  const key = r.pick([null, ['id'], fields.slice(0, 2), [vk], [nk, vk], fields])
  const keyOk = key === null ? null : key.filter(f => Object.hasOwn(rowIn, f))
  const out = maskRows([rowIn], { key: keyOk && keyOk.length ? keyOk : null })
  cases++
  const atNew = new Set(leaked(out[NEW][0] ?? '', frags))
  const worse = {}
  for (const h of OLD) {
    const atOld = new Set(leaked(out[h][0] ?? '', frags))
    const w = [...atNew].filter(f => !atOld.has(f))
    if (w.length) worse[h] = w
  }
  if (Object.keys(worse).length) {
    regress++
    const sig = `${Object.keys(worse).join(',')}|nk=${nk}|vk=${vk}|key=${JSON.stringify(keyOk)}|${rowIn === row ? 'row' : 'doc'}`
    if (!sigs.has(sig)) sigs.set(sig, { rowIn, key: keyOk, head: out[NEW][0], old: Object.fromEntries(Object.keys(worse).map(h => [h, out[h][0]])) })
  }
}
console.log(JSON.stringify({ seed, cases, regress, distinct: sigs.size }))
const bucket = new Map()
for (const [sig] of sigs) {
  const [hs, , , k, kind] = sig.split('|')
  const keyHasValue = /value|val|"v"|VALUE|Value/i.test(k)
  const b = `${hs} ${kind} valueFieldInKey=${keyHasValue}`
  bucket.set(b, (bucket.get(b) ?? 0) + 1)
}
console.log([...bucket].map(([b, n]) => `${n}\t${b}`).join('\n'))
for (const [sig, x] of [...sigs].slice(0, 8)) console.log(sig, '\n  ', JSON.stringify(x).slice(0, 500))
