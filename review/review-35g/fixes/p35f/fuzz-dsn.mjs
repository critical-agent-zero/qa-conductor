// Targeted: Go DSNs whose passwords come from a generator's usual symbol
// set. How often does each head show the whole password, or a part of it
// (a run of 4+ of its characters next to the user)?
import { M } from './h.mjs'

let seed = Number(process.argv[3] ?? 1)
const N = Number(process.argv[2] ?? 5000)
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const alnum = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const sym = '!#$%^&*()-_=+[]{};:,.<>?~@'
const gen = () => {
  const len = 12 + Math.floor(rnd() * 12)
  let s = ''
  for (let i = 0; i < len; i++) s += rnd() < 0.25 ? sym[Math.floor(rnd() * sym.length)] : alnum[Math.floor(rnd() * alnum.length)]
  return s
}
const forms = [p => `root:${p}@tcp(db:3306)/app?parseTime=true`, p => `app:${p}@unix(/var/run/mysqld.sock)/app`, p => `DSN=root:${p}@tcp(127.0.0.1:3306)/x`]
const heads = ['4a284f9', '4ed6449']
const stat = Object.fromEntries(heads.map(h => [h, { full: 0, part: 0 }]))
const both = { colon: 0, colonRegressFull: 0, colonRegressPart: 0 }
const samples = []
for (let i = 0; i < N; i++) {
  const p = gen()
  const v = forms[i % forms.length](p)
  const res = {}
  for (const h of heads) {
    const out = M[h].cell(v)
    const full = out.includes(p)
    // a part: any 4-character run of the password, other than one the
    // form itself holds
    let part = false
    for (let j = 0; j + 4 <= p.length && !part; j++) { const w = p.slice(j, j + 4); if (out.includes(w) && !forms.some(f => f('').includes(w))) part = true }
    res[h] = { full, part, out }
    if (full) stat[h].full++
    else if (part) stat[h].part++
  }
  if (p.includes(':')) {
    both.colon++
    if (res['4ed6449'].full && !res['4a284f9'].full && !res['4a284f9'].part) both.colonRegressFull++
    else if (res['4ed6449'].part && !res['4a284f9'].full && !res['4a284f9'].part) both.colonRegressPart++
  }
  if ((res['4ed6449'].full || res['4ed6449'].part) && !res['4a284f9'].full && !res['4a284f9'].part && samples.length < 8) samples.push([v, res['4a284f9'].out, res['4ed6449'].out])
}
console.log(`N=${N}: shown whole / in part:`, JSON.stringify(stat))
console.log(`passwords holding ':': ${both.colon}; masked at 4a284f9 and whole at 4ed6449: ${both.colonRegressFull}; in part: ${both.colonRegressPart}`)
for (const [v, a, n] of samples) console.log(`in ${v}\n  4a284f9 ${a}\n  4ed6449 ${n}`)
