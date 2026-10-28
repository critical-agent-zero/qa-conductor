// Differential fuzz: random text and JSON built from masking-relevant
// pieces, with a secret marker. Reports inputs where 7193877 (old) hides the
// marker and 4a284f9 (new) shows it. Seeded PRNG so a run is repeatable.
const NEW = await import('../head/data-diff.mjs')
const OLD = await import(process.env.BASE === '4a' ? '../old4a/data-diff.mjs' : '../old79/data-diff.mjs')

const N = Number(process.argv[2] ?? 20000)
let seed = Number(process.argv[3] ?? 1)
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rnd() * a.length)]
const KEY = Buffer.alloc(32, 7)
const mk = lib => {
  const rules = lib.validateRules({})
  const masker = lib.createMasker({ key: KEY, rules })
  return v => JSON.stringify(lib.sanitizeSnapshot({ collections: { c: { key: ['id'], rows: [{ id: 1, note: v }] } } }, { masker, rules }).collections.c.rows[0].note)
}
const o = mk(OLD)
const n = mk(NEW)
const SEC = 'Zq9SeCr3tVal'
const keys = ['password', 'token', 'api_key', 'secret', 'x', 'a', 'id', 'state', 'pw', 'auth', 'name', 'value', 'Password', 'db-token', 'k']
const SEPS_ALL = ['=', ':', ' = ', ': ', '%3D', '%3a', '%3A', '%3d', '  :  ', ' '.repeat(12) + '=', '\t=']
const QUOTES_ALL = ['', '"', "'", '`', '%22', '%27', '&quot;', '&QUOT;', '&#34;', '&#x22;', '\\"', '\\\\"', '[', ']']
const seps = process.argv[5] === 'pct' ? ['%3D', '%3a', '%3A', '%3d', '=', ':', ' '.repeat(20) + '='] : SEPS_ALL
const quotes = process.argv[5] === 'pct' ? ['', '', '%22', '%27', '`', '&QUOT;'] : QUOTES_ALL
const glue = ['', ' ', '&', '%26', '\n', '\\n', ',', ';', '<', '>', '/', '-', '--', '-p', '@', ':', '//', '?', '%3F', '%2F', '"', "'", 'a', '1', '.', '_']
const TAGS_ALL = ['<password>', '<password a="<b">', '<wsse:Password Type="x">', '</password>', '<token kind="a">', '<a ', '<add key="DbPassword" value="', '<input type="password" value="', '<p title="<x>">', '<secret-note t="a<b">']
const tags = process.argv[4] === 'notaglt' ? TAGS_ALL.filter(t => !/="[^"]*</.test(t)) : TAGS_ALL
const urls = ['https://', 'postgres://app:', 'redis://:', 'https://ghp_A1b2C3d4E5f6G7h8I9j0:', 'git@', 'a://', 'mysql://u:']
const schemes = ['Bearer ', 'Basic ', 'Token ', 'bearer  ', 'token ']
const misc = ['mysql -u root -p', '--password ', '--db-token=', '-----BEGIN RSA PRIVATE KEY-----\n', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.', 'root:', '@tcp(h)', 'x-oauth-basic', 'dXNlcjpwYXNz']
function piece() {
  const r = rnd()
  if (r < 0.35) return pick(quotes) + pick(keys) + pick(quotes) + pick(seps)
  if (r < 0.5) return pick(tags)
  if (r < 0.6) return pick(urls)
  if (r < 0.7) return pick(schemes)
  if (r < 0.78) return pick(misc)
  if (r < 0.9) return pick(glue)
  return SEC
}
function text() {
  const parts = []
  const len = 2 + Math.floor(rnd() * 7)
  for (let i = 0; i < len; i++) parts.push(piece())
  if (!parts.includes(SEC)) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, SEC)
  return parts.join('')
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
const found = new Map()
let regress = 0
let fixed = 0
for (let i = 0; i < N; i++) {
  const v = rnd() < 0.75 ? text() : json()
  let a, b
  try { a = o(v); b = n(v) } catch (e) { console.log('THROW', JSON.stringify(v), e.message); continue }
  const ol = a.includes(SEC)
  const nl = b.includes(SEC)
  if (!ol && nl) {
    regress++
    const sig = b.replace(/\[secret [0-9a-f]+\]/g, '[s]').slice(0, 160)
    if (!found.has(sig) && found.size < 60) found.set(sig, { v, old: a, new: b })
  } else if (ol && !nl) fixed++
}
console.log(`N=${N} seed=${process.argv[3] ?? 1}: regressions ${regress}, fixed ${fixed}`)
for (const { v, old, new: nu } of found.values()) {
  console.log('---')
  console.log('in  ', JSON.stringify(v).slice(0, 200))
  console.log('old ', old.slice(0, 200))
  console.log('new ', nu.slice(0, 200))
}
