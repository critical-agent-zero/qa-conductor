// Hand mutants of 4a284f9's round-4 code in lib/data-diff.mjs; each
// non-equivalent one must fail test/data-diff.test.mjs at 4a284f9. Each run
// is its own process group (detached), killed whole on timeout. Up to PAR
// mutants run at once, each in its own directory. Failing tests are listed
// with their messages, so a timing flake under load can be told apart.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { spawn } from 'node:child_process'
const DIR = new URL('.', import.meta.url).pathname
const ORIG = readFileSync(DIR + 'repo/lib/data-diff.mjs', 'utf8')
const arg = process.argv[2]?.startsWith('@') ? readFileSync(DIR + process.argv[2].slice(1), 'utf8').trim() : process.argv[2]
const only = arg ? new RegExp(arg) : null
const PAR = Number(process.env.PAR ?? 2)
const TIMEOUT = 300_000
const NODE = process.env.NODE_BIN ?? process.execPath

const R = String.raw
const mutants = [
  // SECRET_NAME
  ['name: no pw', '(?:pin|pw|psk)', '(?:pin|psk)'],
  ['name: no psk', '(?:pin|pw|psk)', '(?:pin|pw)'],
  ['name: no _auth', '|^_?auth$/i', '|^auth$/i'],
  ['name: auth unanchored', '|^_?auth$/i', '|_?auth/i'],
  ['name: no auth at all', '|^_?auth$/i', '/i'],
  // the key scan gate and pattern
  ['gate: no percent', R`if (/[:=]|%3[ad]/i.test(head))`, R`if (/[:=]/.test(head))`],
  ['gate: percent case-sensitive', R`if (/[:=]|%3[ad]/i.test(head))`, R`if (/[:=]|%3[ad]/.test(head))`],
  ['quote: no backtick', R`(?:\\*["'\x60]|&`, R`(?:\\*["']|&`],
  ['quote: no percent quote', R`;|%2[27])`, R`;)`],
  ['quote: percent only %22', R`;|%2[27])`, R`;|%22)`],
  ['quote: run cut to one', R`(?:\\*["'\x60]|&`, R`(?:\\?["'\x60]|&`],
  ['key: 8 spaces', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,8}(?:[:=]|%3[ad])`],
  ['key: 31 spaces', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,31}(?:[:=]|%3[ad])`],
  ['key: no percent separator', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,32}[:=]`],
  ['key: percent : only', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,32}(?:[:=]|%3a)`],
  ['key: percent = only', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,32}(?:[:=]|%3d)`],
  ['key: case-sensitive flag', "(?:[:=]|%3[ad])`, 'gi')", "(?:[:=]|%3[ad])`, 'g')"],
  // tags
  ['tag: attributes cross < (round-4 regression)', R`(?:\s[^<>]{0,256})?>/g`, R`(?:\s[^>]{0,256})?>/g`],
  ['tag: no attributes', R`(?:\s[^<>]{0,256})?>/g`, '>/g'],
  ['tag: no namespace', R`const TAG_IN_TEXT = /<(?:[\w.-]{1,64}:)?`, R`const TAG_IN_TEXT = /<`],
  // flags, mysql -p, PEM
  ['flag: gate never', "if (head.includes('-')) {", 'if (false) {'],
  ['flag: no flag loop', 'for (const m of head.matchAll(FLAG_IN_TEXT)) if (SECRET_NAME.test(m[1])) return true\n', ''],
  ['flag: no mysql -p', 'if (MYSQL_P.test(head) || PEM_KEY.test(head)) return true', 'if (PEM_KEY.test(head)) return true'],
  ['flag: no PEM', 'if (MYSQL_P.test(head) || PEM_KEY.test(head)) return true', 'if (MYSQL_P.test(head)) return true'],
  ['flag: double dash only', R`/(?<!\S)--?([a-z]`, R`/(?<!\S)--([a-z]`],
  ['flag: no start guard', R`/(?<!\S)--?([a-z]`, R`/--?([a-z]`],
  ['flag: = only', R`{0,63})(?=[ =])/gi`, R`{0,63})(?==)/gi`],
  ['flag: space only', R`{0,63})(?=[ =])/gi`, R`{0,63})(?= )/gi`],
  ['mysql: mysql only', '(?:mysql|mysqldump|mysqladmin|mariadb)', '(?:mysql)'],
  ['mysql: no client needed', R`/\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]{0,256}?\s-p[^\s-]/i`, R`/\s-p[^\s-]/i`],
  ['mysql: -p then anything', R`\s-p[^\s-]/i`, R`\s-p\S/i`],
  ['mysql: case-sensitive', R`\s-p[^\s-]/i`, R`\s-p[^\s-]/`],
  ['pem: RSA only', 'BEGIN [A-Z ]{0,64}PRIVATE KEY', 'BEGIN RSA PRIVATE KEY'],
  ['pem: any BEGIN', '/-----BEGIN [A-Z ]{0,64}PRIVATE KEY-----/', '/-----BEGIN /'],
  // URL userinfo
  ['url: password needs a char', R`:([^\s/]{0,256})|`, R`:([^\s/]{1,256})|`],
  ['url: oauth never', 'const oauth = /^x-oauth-basic$/i.test(pw)', 'const oauth = false'],
  ['url: oauth case-sensitive', 'const oauth = /^x-oauth-basic$/i.test(pw)', 'const oauth = /^x-oauth-basic$/.test(pw)'],
  ['url: user not masked for tokenLike', "(tokenLike(user) || pw === '' || oauth)", "(pw === '' || oauth)"],
  ['url: user not masked for empty pw', "(tokenLike(user) || pw === '' || oauth)", '(tokenLike(user) || oauth)'],
  ['url: user not masked for oauth', "(tokenLike(user) || pw === '' || oauth)", "(tokenLike(user) || pw === '')"],
  ['url: empty user masked', "const userShown = user !== '' &&", 'const userShown = true &&'],
  ['url: password always hidden', "${pw === '' || oauth ? pw : hidden('u', pw)}", "${hidden('u', pw)}"],
  ['url: oauth password hidden', "${pw === '' || oauth ? pw : hidden('u', pw)}", "${pw === '' ? pw : hidden('u', pw)}"],
  ['tokenLike: no gh prefix', R`/^(?:gh[pousr]_|github_pat_|`, R`/^(?:github_pat_|`],
  ['tokenLike: no github_pat', R`gh[pousr]_|github_pat_|glpat-`, R`gh[pousr]_|glpat-`],
  ['tokenLike: no glpat', R`github_pat_|glpat-|xox`, R`github_pat_|xox`],
  ['tokenLike: no slack', R`|xox[abpr]-|`, '|'],
  ['tokenLike: no sk', R`|sk_live_|sk-)/`, ')/'],
  ['tokenLike: from 17', '(s.length >= 16 && /\\d/.test(s))', '(s.length >= 17 && /\\d/.test(s))'],
  ['tokenLike: no digit needed', '(s.length >= 16 && /\\d/.test(s))', '(s.length >= 16)'],
  ['tokenLike: never', 'const tokenLike = s =>', 'const tokenLike = s => false &&'],
  // Authorization values
  ['auth: from 12', R`\s{1,4}([A-Za-z0-9._~+/=-]{8,})/gi`, R`\s{1,4}([A-Za-z0-9._~+/=-]{12,})/gi`],
  ['auth: case-sensitive', R`\s{1,4}([A-Za-z0-9._~+/=-]{8,})/gi`, R`\s{1,4}([A-Za-z0-9._~+/=-]{8,})/g`],
  ['auth: always a token', '.replace(AUTH_VALUE, (match, scheme, value) => (authToken(scheme, value) ?', '.replace(AUTH_VALUE, (match, scheme, value) => (true ?'],
  ['authToken: no digit rule', R`const authToken = (scheme, value) => /\d/.test(value) || value.length >= 16`, 'const authToken = (scheme, value) => value.length >= 16'],
  ['authToken: no 16 rule', R`const authToken = (scheme, value) => /\d/.test(value) || value.length >= 16`, R`const authToken = (scheme, value) => /\d/.test(value)`],
  ['authToken: 17 rule', R`/\d/.test(value) || value.length >= 16`, R`/\d/.test(value) || value.length >= 17`],
  ['authToken: no base64 rule', R`  || (/^basic$/i.test(scheme) && value.length % 4 === 0`, R`  || (false && value.length % 4 === 0`],
  ['authToken: base64 for every scheme', R`  || (/^basic$/i.test(scheme) && value.length % 4 === 0`, R`  || (value.length % 4 === 0`],
  ['authToken: basic case-sensitive', R`  || (/^basic$/i.test(scheme) &&`, R`  || (/^Basic$/.test(scheme) &&`],
  ['authToken: any length', 'value.length % 4 === 0 &&', ''],
  ['authToken: no shape check', R`&& /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&`, '&&'],
  ['authToken: any letter', R`&& /[0-9+/=]|.[A-Z]/.test(value))`, '&& true)'],
  ['authToken: capital anywhere', R`/[0-9+/=]|.[A-Z]/.test(value)`, R`/[0-9+/=]|[A-Z]/.test(value)`],
  // Go DSN, JWT, attributes
  ['dsn: none', ".replace(DSN_USERINFO, (_, user, pw, proto) => `${user}:${hidden('d', pw)}@${proto}(`)\n", ''],
  ['dsn: tcp only', '@(tcp|udp|unix)\\(', '@(tcp)\\('],
  ['dsn: password shown', "`${user}:${hidden('d', pw)}@${proto}(`", "`${user}:${pw}@${proto}(`"],
  ['jwt: none', ".replace(JWT, value => hidden('j', value))\n", ''],
  ['jwt: payload any', R`eyJ[\w-]{4,}\.eyJ[\w-]{4,}\.`, R`eyJ[\w-]{4,}\.[\w-]{4,}\.`],
  ['attr: none', ".replace(ATTR_TAG, tag =>", '.replace(/(?!)/g, tag =>'],
  ['attr: key and name only', R`/\b(key|name|id|type)\s*=`, R`/\b(key|name)\s*=`],
  ['attr: no id', R`/\b(key|name|id|type)\s*=`, R`/\b(key|name|type)\s*=`],
  ['attr: no key', R`/\b(key|name|id|type)\s*=`, R`/\b(name|id|type)\s*=`],
  ['attr: name case-sensitive', R`["']([^"'<>]{1,128})["']/gi`, R`["']([^"'<>]{1,128})["']/g`],
  ['attr: value case-sensitive', R`(["'])([^"'<>]*)\2/gi`, R`(["'])([^"'<>]*)\2/g`],
  ['attr: double quotes only', R`/\bvalue(\s*=\s*)(["'])([^"'<>]*)\2/gi`, R`/\bvalue(\s*=\s*)(")([^"'<>]*)\2/gi`],
  ['attr: value shown', "`value${eq}${q}${hidden('x', value)}${q}`", '`value${eq}${q}${value}${q}`'],
  ['attr: tag needs a space-free name', R`const ATTR_TAG = /<[\w:.-]{1,64}\s`, R`const ATTR_TAG = /<[\w.-]{1,64}\s`],
  // pairs
  ['pair: no capitalized strict', "    || ((isText(obj, 'Name') || isText(obj, 'Key')) && Object.hasOwn(obj, 'Value'))\n", '\n'],
  ['pair: strict needs name (not key)', "((isText(obj, 'name') || isText(obj, 'key')) && Object.hasOwn(obj, 'value'))", "(isText(obj, 'name') && Object.hasOwn(obj, 'value'))"],
  ['pair: strict needs Name (not Key)', "((isText(obj, 'Name') || isText(obj, 'Key')) && Object.hasOwn(obj, 'Value'))", "(isText(obj, 'Name') && Object.hasOwn(obj, 'Value'))"],
  ['pair: strict without value', "&& Object.hasOwn(obj, 'value'))\n", ')\n'],
  ['pair: strict name need not be text', "const isText = (obj, k) => Object.hasOwn(obj, k) && typeof obj[k] === 'string'", 'const isText = (obj, k) => Object.hasOwn(obj, k)'],
  ['pair: never strict', '  if (!strict && keys.length > 6) return null', '  if (keys.length > 6) return null'],
  ['pair: loose up to 7', '  if (!strict && keys.length > 6) return null', '  if (!strict && keys.length > 7) return null'],
  ['pair: loose up to 5', '  if (!strict && keys.length > 6) return null', '  if (!strict && keys.length > 5) return null'],
  ['pair: first value key only', 'else if (PAIR_VALUES.has(lower) &&', 'else if (values.length === 0 && PAIR_VALUES.has(lower) &&'],
  ['pair: null values masked', "else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)", 'else if (PAIR_VALUES.has(lower)) values.push(k)'],
  ['pair: only the first masked in toJson', 'pair.values.map(k =>', 'pair.values.slice(0, 1).map(k =>'],
  // omitted
  ['omitted: long counted again', 'omitted: total - long - n }', 'omitted: total - n }'],
  // column-dropped fold
  ['cols: per field again', "add('column-dropped', null, c.fieldsDropped.length, [...c.fieldsDropped])", "for (const field of c.fieldsDropped) add('column-dropped', field, 1, [field])"],
  ['cols: count 1', "add('column-dropped', null, c.fieldsDropped.length, [...c.fieldsDropped])", "add('column-dropped', null, c.fieldsDropped.length ? 1 : 0, [...c.fieldsDropped])"],
  ['cols: fields unsorted', 'fields: [...mine.items].sort().slice(0, 5)', 'fields: [...mine.items].slice(0, 5)'],
  ['cols: first six', 'fields: [...mine.items].sort().slice(0, 5)', 'fields: [...mine.items].sort().slice(0, 6)'],
  ['cols: all fields', 'fields: [...mine.items].sort().slice(0, 5)', 'fields: [...mine.items].sort()'],
  ['cols: no count', "{ count: mine.n, fields:", '{ fields:'],
  ['cols: shared when base dropped any', "const shared = theirs !== undefined && (mine.items === null && theirs.items === null", "const shared = theirs !== undefined && (mine.kind === 'column-dropped' || mine.items === null && theirs.items === null"],
  // the order
  ['order: losses not first (old order)', "const late = f => (LOSES_DATA.has(f.kind) ? 0 : f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)", "const late = f => (f.kind === 'unverified' || f.kind === 'cleared' ? 1 : 0)"],
  ['order: key-lost not a loss', "new Set(['delete', 'emptied', 'dropped', 'key-lost'])", "new Set(['delete', 'emptied', 'dropped'])"],
  ['order: dropped not a loss', "new Set(['delete', 'emptied', 'dropped', 'key-lost'])", "new Set(['delete', 'emptied', 'key-lost'])"],
  ['order: emptied not a loss', "new Set(['delete', 'emptied', 'dropped', 'key-lost'])", "new Set(['delete', 'dropped', 'key-lost'])"],
  ['order: column-dropped a loss', "new Set(['delete', 'emptied', 'dropped', 'key-lost'])", "new Set(['delete', 'emptied', 'dropped', 'key-lost', 'column-dropped'])"],
  ['order: mass-change a loss', "new Set(['delete', 'emptied', 'dropped', 'key-lost'])", "new Set(['delete', 'emptied', 'dropped', 'key-lost', 'mass-change'])"],
  ['order: unverified with columns', "f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)", "f.kind === 'cleared' ? 2 : 1)"],
  ['order: late before prOwn', '    || prOwn(x) - prOwn(y)\n    || late(x) - late(y)\n', '    || late(x) - late(y)\n    || prOwn(x) - prOwn(y)\n'],
  // tally merge
  ['tally: merge drops earlier items', 'else if (was.items !== null && items !== null) { merged = was.items; for (const item of items) merged.push(item) }', 'else if (was.items !== null && items !== null) { merged = items }'],
  ['tally: merge drops new items', 'else if (was.items !== null && items !== null) { merged = was.items; for (const item of items) merged.push(item) }', 'else if (was.items !== null && items !== null) { merged = was.items }'],
  ['tally: merge null-safe dropped (null kept as items)', 'else if (was.items !== null && items !== null) {', 'else if (was.items !== null) { if (items === null) { merged = was.items } else'],
  ['tally: quadratic spread (perf)', '{ merged = was.items; for (const item of items) merged.push(item) }', '{ merged = [...was.items, ...items] }'],
]

function run(dir) {
  return new Promise(resolve => {
    const child = spawn(NODE, [...(process.env.SKIP ? ['--test-skip-pattern=is linear'] : []), '--test', '--test-force-exit', '--test-reporter=spec', 'test/data-diff.test.mjs'], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, TIMEOUT)
    child.on('close', (code, signal) => { clearTimeout(timer); try { process.kill(-child.pid, 'SIGKILL') } catch {} ; resolve({ code, signal, out }) })
  })
}

const todo = mutants.filter(([name]) => !only || only.test(name))
if (process.env.DRY) {
  for (const [name, from, to] of todo) {
    const n = ORIG.split(from).length - 1
    if (n !== 1) { console.log(`found ${n}x: ${name}`); continue }
    try { await import('data:text/javascript,' + encodeURIComponent(ORIG.replace(from, () => to).replace("import { createHmac } from 'node:crypto'", "import { createHmac } from 'crypto'"))) } catch (e) { console.log(`does not load: ${name}: ${e.message}`) }
  }
  console.log('dry run done', todo.length)
  process.exit(0)
}
const results = new Map()
let next = 0
async function worker(w) {
  const dir = `${DIR}mut/w${w}`
  mkdirSync(dir + '/lib', { recursive: true })
  mkdirSync(dir + '/test', { recursive: true })
  cpSync(DIR + 'repo/test/data-diff.test.mjs', dir + '/test/data-diff.test.mjs')
  cpSync(DIR + 'repo/package.json', dir + '/package.json')
  while (next < todo.length) {
    const [name, from, to] = todo[next++]
    const n = ORIG.split(from).length - 1
    if (n !== 1) { results.set(name, `SKIP (found ${n}x)`); console.log(`SKIP (found ${n}x) | ${name}`); continue }
    writeFileSync(dir + '/lib/data-diff.mjs', ORIG.replace(from, () => to))
    const t = performance.now()
    const r = await run(dir)
    const which = [...r.out.matchAll(/^✖ (.*?) \(\d/gm)].map(m => m[1].slice(0, 50))
    const msgs = [...r.out.matchAll(/AssertionError \[ERR_ASSERTION\]: (.*)/g)].map(m => m[1].slice(0, 40))
    const verdict = r.signal === 'SIGKILL' ? 'killed (timeout)' : r.code === 0 ? 'SURVIVED' : `killed`
    const line = `${verdict} ${JSON.stringify([...new Set(which)].slice(0, 3))} ${JSON.stringify(msgs.slice(0, 3))} ${((performance.now() - t) / 1000).toFixed(0)}s`
    results.set(name, line)
    console.log(`${line.slice(0, 260)} | ${name}`)
  }
}
await Promise.all(Array.from({ length: PAR }, (_, w) => worker(w)))
console.log('---')
for (const [name] of todo) console.log(`${(results.get(name) ?? '').slice(0, 16).padEnd(18)} ${name}`)
console.log('total', todo.length, 'survived', [...results.values()].filter(r => r.startsWith('SURVIVED')).length, 'skipped', [...results.values()].filter(r => r.startsWith('SKIP')).length)
