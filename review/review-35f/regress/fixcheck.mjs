// The proposed fix (element rule first; DSN password may hold ':') against
// 4a284f9 and 4ed6449 over the whole corpus, plus the elem probe shapes and
// the value fuzz: nothing hidden at either head may show with the fix.
import { M, mk, leaks } from './h.mjs'
import * as FIX from './vfix/data-diff.mjs'
import { cells, rows } from './corpus-cases.mjs'

const F = mk(FIX)
const heads = ['4a284f9', '4ed6449']
let worse = 0
let better = 0
for (const [kind, set] of [['cell', cells], ['row', rows]]) {
  for (const [label, [v, ...secrets]] of Object.entries(set)) {
    const out = h => (kind === 'cell' ? h.cell(v) : h.row(v))
    const f = leaks(out(F), secrets).length > 0
    const hs = heads.map(h => leaks(out(M[h]), secrets).length > 0)
    if (f && hs.some(x => !x)) { worse++; console.log(`WORSE ${label}: fix ${out(F).slice(0, 150)}`) }
    if (!f && hs[1]) { better++; console.log(`better than 4ed6449: ${label}`) }
  }
}
console.log(`corpus: worse ${worse}, better than 4ed6449 ${better}`)
// fuzz: the value-rule alphabet
let seed = 3
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const SEC = 'Zq9SeCr3tVal'
const toks = [SEC, SEC, SEC, 'root:', 'u:', 'a:', ':', '::', '@', '@tcp(h)', '@tcp6(h)', '@unix(s)', '@x(', '@(', '@/', '@/db', '/', '(', ')', ' ', '"', "'", '>', '<', '<b>', '</b>', '<add key="DbPassword" value="', '<input type=password value=', "<x id='secret' value='", '" style="a:b">', '" class="sm:x">', '"/>', '">', "'>", ' />', 'https://', 'mysql://u:', 'https://u:', 'Bearer ', 'Basic ', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.', '.sig', 'mailto:', 'x', '1', '-', '.', ';', ',', '=', '?', '#', '%', '!', '\n']
let fw = 0
let fb = 0
const ex = []
for (let i = 0; i < 60000; i++) {
  const n = 2 + Math.floor(rnd() * 8)
  const parts = []
  for (let j = 0; j < n; j++) parts.push(pick(toks))
  if (!parts.includes(SEC)) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, SEC)
  const s = parts.join('')
  const f = F.cell(s).includes(SEC)
  const a = M['4a284f9'].cell(s).includes(SEC)
  const e = M['4ed6449'].cell(s).includes(SEC)
  if (f && (!a || !e)) { fw++; if (ex.length < 6) ex.push([s, F.cell(s), M['4a284f9'].cell(s), M['4ed6449'].cell(s)]) }
  if (!f && e) fb++
}
console.log(`fuzz 60000: fix shows what a head hid ${fw}; fix hides what 4ed6449 showed ${fb}`)
for (const [s, f, a, e] of ex) console.log(`in  ${JSON.stringify(s).slice(0, 160)}\nfix ${f.slice(0, 160)}\n4a  ${a.slice(0, 160)}\n4e  ${e.slice(0, 160)}`)
// 'a:' timing, W28=B: recorded only
for (const [label, lib] of [['4ed6449', M['4ed6449']], ['fix', F]]) {
  const t0 = performance.now()
  lib.cell('a:'.repeat(128 * 1024))
  console.log(`${label}: 256 KB of 'a:' in ${Math.round(performance.now() - t0)} ms`)
}
