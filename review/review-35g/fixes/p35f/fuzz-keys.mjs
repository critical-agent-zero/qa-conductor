// Key and tag detection alone: short strings from a dense alphabet of key
// pieces. A REGRESSION is text 4a284f9 or 7193877 masks whole and 4ed6449
// doesn't (the whole-mask marker, not the secret, is compared, so value
// rules can't hide a lost key).
import { M } from './h.mjs'

const N = Number(process.argv[2] ?? 100000)
let seed = Number(process.argv[3] ?? 1)
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const toks = ['%', '%3d', '%3D', '%3a', '%22', '%27', '%26', '%0A', '%41', '3d', 'a', 'x', 'pw', 'pin', 'psk', 'auth', '_auth', 'password', 'token', 'Password', '=', ':', ' ', '  ', '"', "'", '`', '\\', '\\\\', '\\n', '\\"', '&quot;', '&#34;', '[', ']', '-', '--', '.', '_', '<', '>', '/', '/>', '<password', '<wsse:Password', '<a', ' x="<"', '\n', '\t', 'k', 'id']
const whole = s => s.startsWith('"[text with a secret-looking key')
let reg = 0
let fixed = 0
const found = new Map()
for (let i = 0; i < N; i++) {
  const n = 1 + Math.floor(rnd() * 7)
  let s = ''
  for (let j = 0; j < n; j++) s += pick(toks)
  const o = whole(M['7193877'].cell(s))
  const a = whole(M['4a284f9'].cell(s))
  const e = whole(M['4ed6449'].cell(s))
  if (!e && (o || a)) { reg++; if (found.size < 30) found.set(s, [o, a]) }
  else if (e && !a) fixed++
}
console.log(`N=${N} seed=${process.argv[3] ?? 1}: lost whole-masking ${reg}, newly masked whole ${fixed}`)
for (const [s, [o, a]] of found) console.log(`${JSON.stringify(s)}  7193877 ${o ? 'whole' : '-'} 4a284f9 ${a ? 'whole' : '-'} 4ed6449 -`)
