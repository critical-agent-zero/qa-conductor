// D1: the round-3 high at 7193877. The regexes are read from the source
// itself (lib/data-diff.mjs), not copied, then timed alone on backslash runs
// and other shapes, and checked for the keys that must still count.
import { readFileSync } from 'node:fs'
import { createMasker, sanitizeSnapshot, validateRules } from './repo/lib/data-diff.mjs'

const src = readFileSync(new URL('./repo/lib/data-diff.mjs', import.meta.url), 'utf8')
const grab = name => src.split('\n').find(l => l.startsWith(`const ${name} =`)).replace(/^const \w+ = /, '')
// QUOTE first, as KEY_IN_TEXT's template uses it
const QUOTE = eval(grab('QUOTE'))
const KEY_IN_TEXT = eval(grab('KEY_IN_TEXT'))
const TAG_IN_TEXT = eval(grab('TAG_IN_TEXT'))
const URL_USERINFO = eval(grab('URL_USERINFO'))
const AUTH_VALUE = eval(grab('AUTH_VALUE'))
console.log('KEY_IN_TEXT =', KEY_IN_TEXT.source)
const scan = (r, s) => { let n = 0; for (const m of s.matchAll(r)) n++; return n }
const keys = (r, s) => [...s.matchAll(r)].map(m => m[1])
const ms = f => { const t = performance.now(); f(); return (performance.now() - t).toFixed(1) }

const K = 256 * 1024
const shapes = {
  "256 KB of '\\\\' then '='": '\\'.repeat(K - 1) + '=',
  "256 KB of '\\\\' then '\"'": '\\'.repeat(K - 1) + '"',
  "256 KB of '\\\\' then '\"='": '\\'.repeat(K - 2) + '"=',
  "('\\\\'x4096 + '\"') x 64": ('\\'.repeat(4096) + '"').repeat(64),
  "('a' + '\\\\'x1000) x 262": ('a' + '\\'.repeat(1000)).repeat(262) + '=',
  "('\\\\'x1000 + '\"') x 262": ('\\'.repeat(1000) + '"').repeat(262) + '=',
  "'\\\\a' x 128 K": '\\a'.repeat(128 * 1024) + '=',
  "'\\\\\"' x 128 K": '\\"'.repeat(128 * 1024) + '=',
  "('&quot;' + '\\\\'x1000) x 200": ('&quot;' + '\\'.repeat(1000)).repeat(200) + '=',
  "('x\\\\\\\\' ) x 64 K (2-runs)": 'x\\\\'.repeat(64 * 1024) + '=',
  "('-' x 256 K) then '='": '-'.repeat(K - 1) + '=',
  "word+space x": 'abcdefgh '.repeat(K / 9) + '=',
}
for (const [label, s] of Object.entries(shapes)) {
  console.log(`KEY_IN_TEXT ${label.padEnd(36)} ${String(s.length).padStart(7)} chars: ${ms(() => scan(KEY_IN_TEXT, s))} ms`)
}
const tags = {
  "'<a ' x 87 K (no '>')": '<a '.repeat(Math.floor(K / 3)),
  "'<a:b ' x 52 K": '<a:b '.repeat(Math.floor(K / 5)),
  "'<' x 256 K": '<'.repeat(K),
  "'<a\\t' x": '<a\t'.repeat(Math.floor(K / 3)),
  "('<' + 'a'x64 + ':' + 'b'x128 + ' ') x": ('<' + 'a'.repeat(64) + ':' + 'b'.repeat(128) + ' ').repeat(Math.floor(K / 195)),
}
for (const [label, s] of Object.entries(tags)) {
  console.log(`TAG_IN_TEXT ${label.padEnd(36)} ${String(s.length).padStart(7)} chars: ${ms(() => scan(TAG_IN_TEXT, s))} ms`)
}
const others = {
  "URL: 'a://' + ':' + 'x'x250 + ' ' x": ('a://:' + 'x'.repeat(250) + ' ').repeat(Math.floor(K / 256)),
  "URL: '_a://' + 'x'x300 x": ('_a://' + 'x'.repeat(300)).repeat(Math.floor(K / 305)),
  "URL: 'a://@' x": 'a://@'.repeat(Math.floor(K / 5)),
  "URL: ':' x 256K after a://": 'a://' + ':'.repeat(K),
  "URL: '@' x 256K after a://x:": 'a://x:' + '@'.repeat(K),
  "AUTH: ('bearer ' + 'a'x1023 + ' ') x": ('bearer ' + 'a'.repeat(1023) + ' ').repeat(Math.floor(K / 1031)),
  "AUTH: 'token ' x": 'token '.repeat(Math.floor(K / 6)),
  "AUTH: ('Token ' + 'a'x15 + ' ') x": ('Token ' + 'a'.repeat(15) + ' ').repeat(Math.floor(K / 22)),
  "AUTH: 'basic ' + 'a'x256K": 'basic ' + 'a'.repeat(K),
}
for (const [label, s] of Object.entries(others)) {
  const r = label.startsWith('URL') ? URL_USERINFO : AUTH_VALUE
  console.log(`${label.padEnd(48)} ${String(s.length).padStart(7)} chars: ${ms(() => s.replace(r, 'X'))} ms`)
}

console.log('\n--- keys that must still count (regex alone)')
for (const s of ['log line\\npassword=hunter2', 'C:\\Users\\x\\api_key=abc', 'C:\\\\Users\\\\x\\\\api_key=abc', 'x=\\"password\\": 1', 'abc\\\\"password\\\\":1',
  'x="\\\\\\\\\\\\\\\\\\\\"password\\\\\\\\\\\\\\\\\\\\": 1', '{&quot;password&quot;: 1}', '&#39;token&#39;: 1', '&#x27;token&#x27;: 1', '&#00034;secret&#00034;:1',
  'password : x', 'user[password]=x', 'a\\\\\\password=1', '\\\\password=1', '\\password=1', 'body="{\\"password\\":\\"x\\"}"']) {
  console.log(JSON.stringify(s).padEnd(50), JSON.stringify(keys(KEY_IN_TEXT, s)))
}

console.log('\n--- through sanitizeSnapshot (one cell each)')
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const one = v => sanitizeSnapshot({ collections: { t: { key: ['id'], rows: [{ id: 1, note: v }] } } }, { masker, rules }).collections.t.rows[0].note
for (const [label, s] of Object.entries({ ...shapes, ...tags })) {
  let out
  const t = ms(() => { out = one(s) })
  console.log(`sanitize ${label.padEnd(40)} ${t} ms -> ${JSON.stringify(out).slice(0, 70)}`)
}
for (const s of ['log line\\npassword=hunter2', 'C:\\Users\\x\\api_key=abc123', 'x=\\"password\\": 1', 'abc\\\\"password\\\\":1']) {
  console.log('masked?', JSON.stringify(s).padEnd(36), JSON.stringify(one(s)))
}
// nested JSON string of a 64 KB run, and 256 KB
for (const n of [64 * 1024, 255 * 1024]) {
  const v = JSON.stringify({ msg: '\\'.repeat(n) + '=x' })
  console.log(`nested JSON string of ${n} backslashes + '=': ${ms(() => one(v))} ms`)
  const o = { msg: '\\'.repeat(n) + '=x' }
  console.log(`object holding ${n} backslashes + '=': ${ms(() => one(o))} ms`)
}
