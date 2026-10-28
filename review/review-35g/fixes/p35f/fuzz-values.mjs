// Value rules alone (URL, scheme, DSN, JWT, element value): pieces with no
// secret-looking key, so text is never masked whole. A REGRESSION is the
// marker hidden at 4a284f9 and shown at 4ed6449. Grouped by a signature.
import { M } from './h.mjs'

const N = Number(process.argv[2] ?? 50000)
let seed = Number(process.argv[3] ?? 1)
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const SEC = 'Zq9SeCr3tVal'
const toks = [SEC, SEC, SEC, 'root:', 'u:', 'a:', ':', '::', '@', '@tcp(h)', '@tcp6(h)', '@unix(s)', '@x(', '@(', '@/', '@/db', '/', '(', ')', ' ', '"', "'", '>', '<', '<b>', '</b>', '<add key="DbPassword" value="', '<input type=password value=', "<x id='secret' value='", '" style="a:b">', '" class="sm:x">', '"/>', '">', "'>", ' />', 'https://', 'mysql://u:', 'https://u:', 'Bearer ', 'Basic ', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.', '.sig', 'mailto:', 'x', '1', '-', '.', ';', ',', '=', '?', '#', '%', '!', '\n']
let reg = 0
let fixed = 0
const found = new Map()
for (let i = 0; i < N; i++) {
  const n = 2 + Math.floor(rnd() * 8)
  const parts = []
  for (let j = 0; j < n; j++) parts.push(pick(toks))
  if (!parts.includes(SEC)) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, SEC)
  const s = parts.join('')
  const a = M['4a284f9'].cell(s)
  const e = M['4ed6449'].cell(s)
  if (a.startsWith('"[text with') || e.startsWith('"[text with')) continue
  const al = a.includes(SEC)
  const el = e.includes(SEC)
  if (el && !al) {
    reg++
    // signature: the 4ed6449 output with digests and the marker generalized
    const sig = (/@[a-z0-9]*\(|@\//i.test(s) ? 'dsn-net ' : '') + (/</.test(s) ? 'elem ' : '') + (/:[^\s/:@]*:/.test(s) ? 'colon2 ' : '')
    const list = found.get(sig) ?? []
    if (list.length < 4) list.push([s, a, e])
    found.set(sig, list)
  } else if (al && !el) fixed++
}
console.log(`N=${N} seed=${process.argv[3] ?? 1}: regressions ${reg}, fixed ${fixed}`)
for (const [sig, list] of found) {
  console.log(`=== ${sig || '(other)'}`)
  for (const [s, a, e] of list) console.log(`in      ${JSON.stringify(s).slice(0, 200)}\n4a284f9 ${a.slice(0, 200)}\n4ed6449 ${e.slice(0, 200)}`)
}
