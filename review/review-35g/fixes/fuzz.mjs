// Differential fuzz: random text and JSON from masking-relevant pieces (the
// round-5 fuzz-mask alphabet plus round 6's: percent-escapes before keys,
// self-closing and split tags, DSN networks and passwords with ':' or '@',
// unquoted and either-quoted attributes, settings rows). A REGRESSION is a
// case where 7193877 or 4a284f9 hides the marker and 4ed6449 shows it.
// usage: node fuzz.mjs N seed [mode]   mode: all | dsnfree | html
import { M } from './h.mjs'

const N = Number(process.argv[2] ?? 20000)
let seed = Number(process.argv[3] ?? 1)
const mode = process.argv[4] ?? 'all'
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const SEC = 'Zq9SeCr3tVal'
const keys = ['password', 'token', 'api_key', 'secret', 'x', 'a', 'id', 'state', 'pw', 'auth', '_auth', 'pin', 'psk', 'name', 'value', 'Password', 'db-token', 'k', 'color', 'class']
const seps = ['=', ':', ' = ', ': ', '%3D', '%3a', '%3A', '%3d', '  :  ', ' '.repeat(12) + '=', '\t=']
const quotes = ['', '"', "'", '`', '%22', '%27', '&quot;', '&QUOT;', '&#34;', '&#x22;', '\\"', '\\\\"', '[', ']']
const pct = ['%26', '%2F', '%3F', '%0A', '%0a', '%20', '%2B', '%41', '%7B', '%2C', '%3B', '%40', '%3C', '%3E']
const glue = ['', ' ', '&', '%26', '\n', '\\n', '\\t', ',', ';', '<', '>', '/', '-', '--', '-p', '@', ':', '//', '?', '%3F', '%2F', '"', "'", 'a', '1', '.', '_', '(', ')', '@/', '@(', '@tcp(', '@x(', '@tcp6(']
const tags = ['<password>', '<password/>', '<password />', '<password a="<b">', '<wsse:Password Type="x">', '</password>', '</wsse:Password>', '<token kind="a">', '<a ', '<password\n', '<add key="DbPassword" value="', '<add key=DbPassword value=', "<add key='DbPassword' value='", '<input type="password" value="', '<input type=password value=', '<p title="<x>">', '<secret-note t="a<b">', '<x style="color:red">', '<td>', '<b>', '" class="a:b">', '" style="color:red">', '"/>', '">', "'>", ' />']
const urls = ['https://', 'postgres://app:', 'redis://:', 'https://ghp_A1b2C3d4E5f6G7h8I9j0:', 'git@', 'a://', 'mysql://u:']
const schemes = ['Bearer ', 'Basic ', 'Token ', 'bearer  ', 'token ']
const misc = ['mysql -u root -p', '--password ', '--password\t', '--db-token=', '-----BEGIN RSA PRIVATE KEY-----\n', '-----BEGIN PGP PRIVATE KEY BLOCK-----', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.', 'root:', 'root:a:', 'u:p@', '@tcp(h)', '@unix(s)', '@/db', '@(h)', 'x-oauth-basic', 'dXNlcjpwYXNz']
function piece() {
  const r = rnd()
  if (r < 0.3) return pick(quotes) + pick(keys) + pick(quotes) + pick(seps)
  if (r < 0.36) return pick(pct) + pick(keys) + pick(seps)
  if (r < 0.5) return pick(tags)
  if (r < 0.56) return pick(urls)
  if (r < 0.62) return pick(schemes)
  if (r < 0.74) return pick(misc)
  if (r < 0.9) return pick(glue)
  return SEC
}
function text() {
  const parts = []
  const len = 2 + Math.floor(rnd() * 8)
  for (let i = 0; i < len; i++) parts.push(piece())
  if (!parts.includes(SEC)) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, SEC)
  return parts.join('')
}
// html: a secret element, then minified content
const attrs = ['class="a:b"', 'style="color:red"', 'style="margin:0"', 'title="x"', 'data-x="1"', 'id="f"', 'autocomplete="off"', 'name="pw"', 'href="mailto:x@y"']
const after = ['', '<td>', '<b>', '<span>', '<style>', '<div>', 'x', '</td>', '<br>', '<i>']
const tail = ['@media(max-width:600px){a{b:c}}', '@/x', 'a@(b)', 'x@y(z)', '@supports(display:grid){}', 'user@example.com', '@import url(x)', 'a@tcp(h)', '']
function html() {
  const open = pick(['<input type="password" value="', '<input type=password value=', '<add key="DbPassword" value="', "<add key='DbPassword' value='", '<property name="password" value="', '<x id="secret" value="'])
  const q = open.endsWith('"') ? '"' : open.endsWith("'") ? "'" : ''
  const extra = Array.from({ length: Math.floor(rnd() * 3) }, () => pick(attrs)).join(' ')
  return `${pick(['', 'x ', '<td>'])}${open}${rnd() < 0.2 ? 'ab:' : ''}${SEC}${q}${extra ? ` ${extra}` : ''}${pick(['>', '/>', ' />', '>'])}${pick(after)}${pick(after)}${pick(tail)}${pick(after)}`
}
function json() {
  const r = rnd()
  const t = text()
  if (r < 0.3) return { [pick(keys)]: pick(keys), [pick(['value', 'Value', 'v', 'val', 'VALUE', 'other'])]: SEC, ...(rnd() < 0.5 ? { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } : {}) }
  if (r < 0.5) return [pick(keys), SEC, pick(keys)]
  if (r < 0.7) return JSON.stringify({ note: t })
  if (r < 0.85) return JSON.stringify(JSON.stringify({ [pick(keys)]: SEC }))
  return { nested: t }
}
const o = M[process.env.O1 ?? '7193877']
const a = M[process.env.O2 ?? '4a284f9']
const n = M['4033285']
const found = new Map()
let regress = 0
let fixed = 0
let vsA = 0
let vsO = 0
for (let i = 0; i < N; i++) {
  const v = mode === 'html' ? html() : rnd() < 0.75 ? text() : json()
  if (mode === 'dsnfree' && typeof v === 'string' && /@/.test(v)) continue
  let so, sa, sn
  try { so = o.cell(v); sa = a.cell(v); sn = n.cell(v) } catch (e) { console.log('THROW', JSON.stringify(v), e.message); continue }
  const ol = so.includes(SEC)
  const al = sa.includes(SEC)
  const nl = sn.includes(SEC)
  if (nl && (!ol || !al)) {
    regress++
    if (!al) vsA++
    if (!ol) vsO++
    const sig = sn.replace(/\[secret [0-9a-f]+\]/g, '[s]').replace(/Zq9SeCr3tVal/g, 'S').slice(0, 120)
    if (!found.has(sig) && found.size < 40) found.set(sig, { v, so, sa, sn })
  } else if (!nl && (ol || al)) fixed++
}
console.log(`N=${N} seed=${process.argv[3] ?? 1} mode=${mode}: regressions ${regress} (vs 4a284f9 ${vsA}, vs 7193877 ${vsO}), fixed ${fixed}`)
for (const { v, so, sa, sn } of found.values()) {
  console.log('---')
  console.log('in      ', JSON.stringify(v).slice(0, 220))
  console.log('7193877 ', so.slice(0, 220))
  console.log('4a284f9 ', sa.slice(0, 220))
  console.log('4ed6449 ', sn.slice(0, 220))
}
