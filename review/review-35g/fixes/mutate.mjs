// Mutants of 4033285's masking rules: each regex, the rule order in
// maskInText, the scheme loop, the JSON/NDJSON decode passes, the escape
// strip, the pair rule. Writes mut/<id>/lib/data-diff.mjs and
// mut/<id>/test/{data-masking-corpus,data-diff}.test.mjs; run-mut.sh runs them.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'

const D = new URL('./', import.meta.url).pathname
const src = readFileSync(`${D}v4033285/data-diff.mjs`, 'utf8')
const corpus = readFileSync(`${D}repo/test/data-masking-corpus.test.mjs`, 'utf8')
const dd = readFileSync(`${D}repo/test/data-diff.test.mjs`, 'utf8')

const ORDER_URL = `    const withUrls = head.replace(URL_USERINFO, (_, scheme, user, pw, token) => {`
const R = String.raw
// [id, find, replace] (find must occur exactly once), or [id, fn]
const M = [
  // ---- rule order
  ['order:dsn-before-element', s => s.replace(`    const masked = authValues(withUrls, value => hidden('a', value))\n`, `    const masked = authValues(withUrls, value => hidden('a', value))\n      .replace(DSN_USERINFO, (_, user, pw, rest) => \`\${user}:\${hidden('d', pw)}@\${rest}\`)\n`).replace(`        : tag))\n      .replace(DSN_USERINFO, (_, user, pw, rest) => \`\${user}:\${hidden('d', pw)}@\${rest}\`)\n`, `        : tag))\n`)],
  ['order:element-first', s => {
    const el = s.slice(s.indexOf('      // an element whose key, name, id or type looks secret: its value\n'), s.indexOf(`        : tag))\n`) + `        : tag))\n`.length)
    let t = s.replace(el, '')
    t = t.replace(ORDER_URL, `    const elFirst = head${el.replace(/\n$/, '')}\n    const withUrls = elFirst.replace(URL_USERINFO, (_, scheme, user, pw, token) => {`)
    return t
  }],
  ['order:scheme-after-element', s => s.replace(`    const masked = authValues(withUrls, value => hidden('a', value))\n`, `    const masked0 = withUrls\n`).replace(`        : tag))\n      .replace(DSN_USERINFO`, `        : tag))\n    const masked = authValues(masked0, value => hidden('a', value))\n      .replace(DSN_USERINFO`)],
  ['order:jwt-before-dsn', s => s.replace(`      .replace(DSN_USERINFO, (_, user, pw, rest) => \`\${user}:\${hidden('d', pw)}@\${rest}\`)\n      .replace(JWT, value => hidden('j', value))\n`, `      .replace(JWT, value => hidden('j', value))\n      .replace(DSN_USERINFO, (_, user, pw, rest) => \`\${user}:\${hidden('d', pw)}@\${rest}\`)\n`)],
  ['order:dsn-first', s => s.replace(ORDER_URL, `    const withUrls = head.replace(DSN_USERINFO, (_, user, pw, rest) => \`\${user}:\${hidden('d', pw)}@\${rest}\`).replace(URL_USERINFO, (_, scheme, user, pw, token) => {`).replace(`        : tag))\n      .replace(DSN_USERINFO, (_, user, pw, rest) => \`\${user}:\${hidden('d', pw)}@\${rest}\`)\n`, `        : tag))\n`)],
  ['order:no-element', s => s.replace(`      .replace(ATTR_TAG, tag =>`, `      .replace(/(?!)/g, tag =>`)],
  ['order:no-dsn', s => s.replace(`      .replace(DSN_USERINFO, (_, user, pw, rest)`, `      .replace(/(?!)/g, (_, user, pw, rest)`)],
  ['order:no-jwt', s => s.replace(`      .replace(JWT, value`, `      .replace(/(?!)/g, value`)],
  ['order:no-url', s => s.replace(`head.replace(URL_USERINFO,`, `head.replace(/(?!)/g,`)],
  ['order:no-scheme', s => s.replace(`authValues(withUrls, value => hidden('a', value))`, `withUrls`)],
  // ---- scheme loop
  ['auth:consume-non-token', `} else re.lastIndex = m.index + scheme.length`, `} else re.lastIndex = m.index + whole.length`],
  ['auth:skip-1', `} else re.lastIndex = m.index + scheme.length`, `} else re.lastIndex = m.index + whole.length - 1`],
  ['auth:case-sensitive', `new RegExp(AUTH_VALUE.source, 'gi')`, `new RegExp(AUTH_VALUE.source, 'g')`],
  ['auth:one-space', R`const AUTH_VALUE = /\b(bearer|basic|token)\s{1,4}(`, R`const AUTH_VALUE = /\b(bearer|basic|token) (`],
  ['auth:no-token-word', R`(bearer|basic|token)\s{1,4}`, R`(bearer|basic)\s{1,4}`],
  ['auth:no-basic-word', R`(bearer|basic|token)\s{1,4}`, R`(bearer|token)\s{1,4}`],
  ['auth:value-no-+/=', R`([A-Za-z0-9._~+/=-]{8,})/gi`, R`([A-Za-z0-9._~-]{8,})/gi`],
  ['auth:value-9', R`([A-Za-z0-9._~+/=-]{8,})/gi`, R`([A-Za-z0-9._~+/=-]{9,})/gi`],
  ['authToken:no-digit', R`const authToken = (scheme, value) => /\d/.test(value) || value.length >= 16`, R`const authToken = (scheme, value) => value.length >= 16`],
  ['authToken:20', R`/\d/.test(value) || value.length >= 16`, R`/\d/.test(value) || value.length >= 20`],
  ['authToken:no-basic64', R`  || (/^basic$/i.test(scheme) && value.length % 4 === 0`, R`  || (false && value.length % 4 === 0`],
  // ---- URL
  ['url:pw-no-@', R`:([^\s/]{0,256})|([^\s/:@]{16,256}))@/gi`, R`:([^\s/@]{0,256})|([^\s/:@]{16,256}))@/gi`],
  ['url:user-nonempty', R`(?:([^\s/:@]{0,256}):`, R`(?:([^\s/:@]{1,256}):`],
  ['url:token-20', R`|([^\s/:@]{16,256}))@/gi`, R`|([^\s/:@]{20,256}))@/gi`],
  ['url:no-token-alone', R`|([^\s/:@]{16,256}))@/gi`, R`|(?!))@/gi`],
  ['url:case', R`|([^\s/:@]{16,256}))@/gi`, R`|([^\s/:@]{16,256}))@/g`],
  ['url:scheme-letters', R`([a-z][a-z0-9+.-]{0,30}:\/\/)`, R`([a-z]{1,30}:\/\/)`],
  ['url:no-oauth', `const oauth = /^x-oauth-basic$/i.test(pw)`, `const oauth = false`],
  ['url:user-token-only-prefix', `user !== '' && (tokenLike(user) || pw === '' || oauth)`, `user !== '' && (tokenLike(user))`],
  ['tokenLike:no-16', R`|| (s.length >= 16 && /\d/.test(s))`, R`|| false`],
  ['tokenLike:no-prefix', R`/^(?:gh[pousr]_|github_pat_|glpat-|xox[abpr]-|sk_live_|sk-)/.test(s)`, R`false`],
  // ---- DSN
  ['dsn:pw-no-colon', R`:([^\s/]{1,256})@((?:`, R`:([^\s/:]{1,256})@((?:`],
  ['dsn:pw-no-@', R`:([^\s/]{1,256})@((?:`, R`:([^\s@/]{1,256})@((?:`],
  ['dsn:pw-no-gt', R`:([^\s/]{1,256})@((?:`, R`:([^\s/>]{1,256})@((?:`],
  ['dsn:pw-64', R`:([^\s/]{1,256})@((?:`, R`:([^\s/]{1,64})@((?:`],
  ['dsn:user-word', R`(?<![\w.-])([\w.-]{1,64}):([^\s/]`, R`(?<![\w.-])(\w{1,64}):([^\s/]`],
  ['dsn:nets-3', R`@((?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`@((?:tcp|udp|unix)\(|\/)/gi`],
  ['dsn:no-slash', R`@((?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`@((?:[a-z][\w-]{0,31})?\()/gi`],
  ['dsn:net-required', R`@((?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`@((?:[a-z][\w-]{0,31})\(|\/)/gi`],
  ['dsn:net-no-digit', R`@((?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`@((?:[a-z][a-z-]{0,31})?\(|\/)/gi`],
  ['dsn:case', R`?\(|\/)/gi`, R`?\(|\/)/g`],
  ['dsn:no-lookbehind', R`const DSN_USERINFO = /(?<![\w.-])(`, R`const DSN_USERINFO = /(`],
  // ---- JWT
  ['jwt:8', R`eyJ[\w-]{4,}\.eyJ[\w-]{4,}\.[\w-]{4,}/g`, R`eyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g`],
  ['jwt:no-dash', R`eyJ[\w-]{4,}\.eyJ[\w-]{4,}\.[\w-]{4,}/g`, R`eyJ\w{4,}\.eyJ\w{4,}\.\w{4,}/g`],
  // ---- elements
  ['tag:no-ns', R`const ATTR_TAG = /<[\w:.-]{1,64}\s`, R`const ATTR_TAG = /<[\w.-]{1,64}\s`],
  ['tag:space-only', R`const ATTR_TAG = /<[\w:.-]{1,64}\s[^<>]`, R`const ATTR_TAG = /<[\w:.-]{1,64} [^<>]`],
  ['tag:256', R`\s[^<>]{0,1024}>/g`, R`\s[^<>]{0,256}>/g`],
  ['name:no-id', R`/\b(key|name|id|type)\s*=`, R`/\b(key|name|type)\s*=`],
  ['name:no-type', R`/\b(key|name|id|type)\s*=`, R`/\b(key|name|id)\s*=`],
  ['name:no-name', R`/\b(key|name|id|type)\s*=`, R`/\b(key|id|type)\s*=`],
  ['name:no-key', R`/\b(key|name|id|type)\s*=`, R`/\b(name|id|type)\s*=`],
  ['name:no-spaces', R`/\b(key|name|id|type)\s*=\s*(`, R`/\b(key|name|id|type)=(`],
  ['name:no-sq', R`|'([^'<>]{1,128})'|([^\s"'<>=\x60]{1,128}))/gi`, R`|'(?!)()'|([^\s"'<>=\x60]{1,128}))/gi`],
  ['name:no-bare', R`|'([^'<>]{1,128})'|([^\s"'<>=\x60]{1,128}))/gi`, R`|'([^'<>]{1,128})'|(?!)())/gi`],
  ['name:dq-no-sq', R`(?:"([^"<>]{1,128})"|'`, R`(?:"([^"'<>]{1,128})"|'`],
  ['name:case', R`|([^\s"'<>=\x60]{1,128}))/gi`, R`|([^\s"'<>=\x60]{1,128}))/g`],
  ['name:only-m2', `SECRET_NAME.test(m[2] ?? m[3] ?? m[4])`, `SECRET_NAME.test(m[2] ?? '')`],
  ['value:dq-no-apos', R`\s*)(?:"([^"]*)"|'([^']*)'|`, R`\s*)(?:"([^"']*)"|'([^']*)'|`],
  ['value:no-sq', R`\s*)(?:"([^"]*)"|'([^']*)'|`, R`\s*)(?:"([^"]*)"|'(?!)()'|`],
  ['value:no-bare', R`|([^\s"'<>=\x60]+))/gi`, R`|(?!)())/gi`],
  ['value:no-spaces', R`const ATTR_VALUE = /\b(value)(\s*=\s*)`, R`const ATTR_VALUE = /\b(value)(=)`],
  ['value:case', R`|([^\s"'<>=\x60]+))/gi`, R`|([^\s"'<>=\x60]+))/g`],
  ['value:bare-no-gt', R`|([^\s"'<>=\x60]+))/gi`, R`|([^\s"'<=\x60]+))/gi`],
  // ---- keys in text
  ['key:no-pct-start', R`(?:(?<![\w.-])|(?<=%[0-9a-f]{2}))`, R`(?:(?<![\w.-]))`],
  ['key:32->8', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,8}(?:[:=]|%3[ad])`],
  ['key:32->31', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,31}(?:[:=]|%3[ad])`],
  ['key:no-pct-sep', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,32}(?:[:=])`],
  ['key:no-bracket', '${QUOTE}?\\]?\\s{0,32}', '${QUOTE}?\\s{0,32}'],
  ['key:no-backslash-guard', '(?<!\\\\(?=\\\\))${QUOTE}?', '${QUOTE}?'],
  ['key:pre-gate', `if (/[:=]|%3[ad]/i.test(head)) {`, `if (/[:=]/.test(head)) {`],
  ['quote:no-entity', R`|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);|%2[27])`, R`|%2[27])`],
  ['quote:no-pct', R`|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);|%2[27])`, R`|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);)`],
  ['quote:no-backtick', R`(?:\\*["'\x60]|`, R`(?:\\*["']|`],
  ['quote:no-esc', R`(?:\\*["'\x60]|`, R`(?:["'\x60]|`],
  ['strip:no-pct', `const past = before === '%' ? m[1].replace(/^[0-9a-f]{2}/i, '') : before`, `const past = before === '%' ? m[1] : before`],
  ['strip:no-bs', `: before === '\\\\' ? m[1].replace(/^[nrt]/, '') : null`, `: null`],
  ['strip:bs-n-only', `m[1].replace(/^[nrt]/, '')`, `m[1].replace(/^[n]/, '')`],
  ['tagtext:no-ns', R`const TAG_IN_TEXT = /<(?:[\w.-]{1,64}:)?(`, R`const TAG_IN_TEXT = /<(`],
  ['tagtext:no-slash', R`([\w.-]{1,128})(?=[\s/>])/g`, R`([\w.-]{1,128})(?=[\s>])/g`],
  ['tagtext:no-ws', R`([\w.-]{1,128})(?=[\s/>])/g`, R`([\w.-]{1,128})(?=[/>])/g`],
  ['tagtext:gate', `if (head.includes('<')) for`, `if (false) for`],
  ['flag:single-dash', R`(?<!\S)--?([a-z]`, R`(?<!\S)--([a-z]`],
  ['flag:case', R`(?=[\s=])/gi`, R`(?=[\s=])/g`],
  ['flag:eq-only', R`(?=[\s=])/gi`, R`(?==)/gi`],
  ['mysql:no-dump', R`(?:mysql|mysqldump|mysqladmin|mariadb)`, R`(?:mysql|mysqladmin|mariadb)`],
  ['mysql:case', R`\s-p[^\s-]/i`, R`\s-p[^\s-]/`],
  ['pem:no-block', R`PRIVATE KEY(?: BLOCK)?-----/`, R`PRIVATE KEY-----/`],
  ['pem:no-openssh', R`/-----BEGIN [A-Z ]{0,64}PRIVATE`, R`/-----BEGIN [A-Z]{0,64} ?PRIVATE`],
  // ---- decode passes (held JSON, twice-encoded, NDJSON)
  ['json:no-twice', `if (twice && /^\\s*"\\s*[[{]/.test(s)) {`, `if (false) {`],
  ['json:no-ndjson', `if (s.includes('\\n')) {`, `if (false) {`],
  ['json:depth-1', s => s.replace(/const HELD_JSON_DEPTH = \d+/, 'const HELD_JSON_DEPTH = 1')],
  ['json:depth-2', s => s.replace(/const HELD_JSON_DEPTH = \d+/, 'const HELD_JSON_DEPTH = 2')],
  ['json:replacer-no-key', `if (k !== '' && SECRET_NAME.test(k) && v !== null && v !== undefined) return secret(k, raw)`, `if (false) return secret(k, raw)`],
  ['json:no-rawheaders', `if (Array.isArray(v) && v.some(x => typeof x === 'string' && SECRET_NAME.test(x))) {`, `if (false) {`],
  ['json:no-pair', `        if (pair !== null) return { ...v,`, `        if (false) return { ...v,`],
  ['json:no-string-mask', `if (typeof v === 'string' && k !== '') return maskText(v, where, depth)`, `if (false) return maskText(v, where, depth)`],
  // ---- pair rule
  ['pair:strict-lower-only', `    || ((isText(obj, 'Name') || isText(obj, 'Key')) && Object.hasOwn(obj, 'Value'))\n`, `\n`],
  ['pair:6->5', `if (!strict && keys.length > 6) return null`, `if (!strict && keys.length > 5) return null`],
  ['pair:first-name-only', `if (name === null && typeof obj[k] === 'string' && SECRET_NAME.test(obj[k])) name = obj[k]`, `if (name === null && typeof obj[k] === 'string') name = SECRET_NAME.test(obj[k]) ? obj[k] : ''`],
  ['pair:one-value', `} else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) values.push(k)`, `} else if (PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined && values.length === 0) values.push(k)`],
  ['pair:no-field', `new Set(['name', 'key', 'field', 'k'])`, `new Set(['name', 'key', 'k'])`],
  ['pair:no-val', `new Set(['value', 'val', 'v'])`, `new Set(['value', 'v'])`],
  ['row:no-pair', `const paired = pair !== null && pair.values.includes(field) && !named.includes(field)`, `const paired = false`],
  ['row:pair-keys-too', `const paired = pair !== null && pair.values.includes(field) && !named.includes(field)`, `const paired = pair !== null && pair.values.includes(field)`],
  // ---- names
  ['name:no-pw-word', R`(?:^|[-_])(?:pin|pw|psk)(?:[-_]|$)`, R`(?:^|[-_])(?:pin|psk)(?:[-_]|$)`],
  ['name:no-_auth', R`|^_?auth$/i`, R`/i`],
  ['name:no-dsn', R`|signature|dsn|(?:database`, R`|signature|(?:database`],
  ['scan:head-64k', s => s.replace(/const HELD_JSON_MAX = [^\n]+/, m => m.replace(/=.*/, '= 64 * 1024'))],
]

rmSync(`${D}mut`, { recursive: true, force: true })
const list = []
for (const [id, a, b] of M) {
  let out
  if (typeof a === 'function') out = a(src)
  else {
    const n = src.split(a).length - 1
    if (n !== 1) { console.log(`SKIP ${id}: find occurs ${n} times`); continue }
    out = src.replace(a, () => b)
  }
  if (out === src) { console.log(`SKIP ${id}: no change`); continue }
  const dir = `${D}mut/${id.replace(/[^\w.-]/g, '_')}`
  mkdirSync(`${dir}/lib`, { recursive: true })
  mkdirSync(`${dir}/test`, { recursive: true })
  writeFileSync(`${dir}/lib/data-diff.mjs`, out)
  writeFileSync(`${dir}/test/data-masking-corpus.test.mjs`, corpus)
  writeFileSync(`${dir}/test/data-diff.test.mjs`, dd)
  list.push(id)
}
writeFileSync(`${D}mut/list.txt`, list.map(id => id.replace(/[^\w.-]/g, '_')).join('\n') + '\n')
console.log(`${list.length} mutants`)
