// Hand mutants of 4ed6449's lib/data-diff.mjs: (A) round 5's 25 surviving
// non-equivalent mutants, adapted to 4ed6449's source; (B) mutants of this
// round's new code (4a284f9..4ed6449). Each must fail
// test/data-diff.test.mjs at 4ed6449 unless marked equivalent. Each run is
// its own process group (detached), killed whole on timeout.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { spawn } from 'node:child_process'
const DIR = new URL('.', import.meta.url).pathname
const ORIG = readFileSync(DIR + 'repo/lib/data-diff.mjs', 'utf8')
const only = process.argv[2] ? new RegExp(process.argv[2]) : null
const PAR = Number(process.env.PAR ?? 2)
const TIMEOUT = 400_000
const NODE = process.env.NODE_BIN ?? process.execPath

const R = String.raw
const mutants = [
  // (A) round 5's surviving non-equivalent mutants
  ['A pair: strict needs name (not key)', "((isText(obj, 'name') || isText(obj, 'key')) && Object.hasOwn(obj, 'value'))", "(isText(obj, 'name') && Object.hasOwn(obj, 'value'))"],
  ['A pair: strict needs Name (not Key)', "((isText(obj, 'Name') || isText(obj, 'Key')) && Object.hasOwn(obj, 'Value'))", "(isText(obj, 'Name') && Object.hasOwn(obj, 'Value'))"],
  ['A tally: merge drops earlier items', 'else if (was.items !== null && items !== null) { merged = was.items; for (const item of items) merged.push(item) }', 'else if (was.items !== null && items !== null) { merged = items }'],
  ['A tally: merge drops new items', 'else if (was.items !== null && items !== null) { merged = was.items; for (const item of items) merged.push(item) }', 'else if (was.items !== null && items !== null) { merged = was.items }'],
  ['A order: key-lost not a loss', "new Set(['delete', 'emptied', 'dropped', 'key-lost'])", "new Set(['delete', 'emptied', 'dropped'])"],
  ['A order: unverified with columns', "f.kind === 'unverified' || f.kind === 'cleared' ? 2 : 1)", "f.kind === 'cleared' ? 2 : 1)"],
  ['A attr: no id', R`/\b(key|name|id|type)\s*=`, R`/\b(key|name|type)\s*=`],
  ['A attr: name case-sensitive', R`|([^\s"'<>=\x60]{1,128}))/gi`, R`|([^\s"'<>=\x60]{1,128}))/g`],
  ['A attr: value case-sensitive', R`|([^\s"'<>=\x60]+))/gi`, R`|([^\s"'<>=\x60]+))/g`],
  ['A attr: value double quotes only', R`(?:"([^"]*)"|'([^']*)'|([^\s"'<>=\x60]+))/gi`, R`(?:"([^"]*)"|(?!)'([^']*)'|(?!)([^\s"'<>=\x60]+))/gi`],
  ['A attr: tag needs a space-free name', R`const ATTR_TAG = /<[\w:.-]{1,64}\s`, R`const ATTR_TAG = /<[\w.-]{1,64}\s`],
  ['A pem: RSA only', 'BEGIN [A-Z ]{0,64}PRIVATE KEY', 'BEGIN RSA PRIVATE KEY'],
  ['A mysql: mysql only', '(?:mysql|mysqldump|mysqladmin|mariadb)', '(?:mysql)'],
  ['A mysql: case-sensitive', R`\s-p[^\s-]/i`, R`\s-p[^\s-]/`],
  ['A authToken: basic case-sensitive', R`  || (/^basic$/i.test(scheme) &&`, R`  || (/^Basic$/.test(scheme) &&`],
  ['A flag: double dash only', R`/(?<!\S)--?([a-z]`, R`/(?<!\S)--([a-z]`],
  ['A quote: percent only %22', R`;|%2[27])`, R`;|%22)`],
  ['A key: 31 spaces', R`\]?\s{0,32}(?:[:=]|%3[ad])`, R`\]?\s{0,31}(?:[:=]|%3[ad])`],
  ['A dsn: tcp only', R`@((?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`@((?:tcp)\(|\/)/gi`],
  ['A url: oauth case-sensitive', 'const oauth = /^x-oauth-basic$/i.test(pw)', 'const oauth = /^x-oauth-basic$/.test(pw)'],
  ['A tokenLike: no gh prefix', R`/^(?:gh[pousr]_|github_pat_|`, R`/^(?:github_pat_|`],
  ['A tokenLike: no github_pat', R`gh[pousr]_|github_pat_|glpat-`, R`gh[pousr]_|glpat-`],
  ['A tokenLike: no slack', R`|xox[abpr]-|`, '|'],
  ['A tokenLike: no sk', R`|sk_live_|sk-)/`, ')/'],
  ['A cols: shared when base dropped any', 'const shared = theirs !== undefined && (mine.items === null && theirs.items === null', "const shared = theirs !== undefined && (mine.kind === 'column-dropped' || mine.items === null && theirs.items === null"],
  // (B) this round's code: the key scan
  ['B key: no percent start', R`(?:(?<![\w.-])|(?<=%[0-9a-f]{2}))(?<!\\(?=\\))`, R`(?<![\w.-])(?<!\\(?=\\))`],
  ['B key: percent start only after %3a/%3d', R`|(?<=%[0-9a-f]{2}))`, R`|(?<=%3[ad]))`],
  ['B key: percent start only after digits', R`|(?<=%[0-9a-f]{2}))`, R`|(?<=%[0-9]{2}))`],
  ['B key: percent start after one hex', R`|(?<=%[0-9a-f]{2}))`, R`|(?<=%[0-9a-f]))`],
  ['B strip: none', 'if (past !== null && past !== m[1] && SECRET_NAME.test(past)) return true', ''],
  ['B strip: percent only', R`: before === '\\' ? m[1].replace(/^[nrt]/, '') : null`, ': null'],
  ['B strip: backslash only', R`const past = before === '%' ? m[1].replace(/^[0-9a-f]{2}/i, '') :`, 'const past = before === null ? null :'],
  ['B strip: hex case-sensitive', R`m[1].replace(/^[0-9a-f]{2}/i, '')`, R`m[1].replace(/^[0-9a-f]{2}/, '')`],
  ['B strip: one hex digit', R`m[1].replace(/^[0-9a-f]{2}/i, '')`, R`m[1].replace(/^[0-9a-f]/i, '')`],
  ['B strip: n only', R`m[1].replace(/^[nrt]/, '')`, R`m[1].replace(/^n/, '')`],
  ['B strip: n and t (no r)', R`m[1].replace(/^[nrt]/, '')`, R`m[1].replace(/^[nt]/, '')`],
  ['B strip: any char after %', "const past = before === '%' ?", "const past = before !== undefined ?"],
  // tags, flags, PEM
  ['B tag: back to [^<>] attributes', R`([\w.-]{1,128})(?=[\s/>])/g`, R`([\w.-]{1,128})(?:\s[^<>]{0,256})?>/g`],
  ['B tag: no slash', R`(?=[\s/>])/g`, R`(?=[\s>])/g`],
  ['B tag: no whitespace', R`(?=[\s/>])/g`, R`(?=[/>])/g`],
  ['B tag: no >', R`(?=[\s/>])/g`, R`(?=[\s/])/g`],
  ['B tag: no namespace', R`const TAG_IN_TEXT = /<(?:[\w.-]{1,64}:)?`, R`const TAG_IN_TEXT = /<`],
  ['B flag: space and = only', R`{0,63})(?=[\s=])/gi`, R`{0,63})(?=[ =])/gi`],
  ['B flag: whitespace only', R`{0,63})(?=[\s=])/gi`, R`{0,63})(?=\s)/gi`],
  ['B pem: no BLOCK', 'PRIVATE KEY(?: BLOCK)?-----', 'PRIVATE KEY-----'],
  // DSN
  ['B dsn: no @ in password', R`([^\s/:]{1,256})@((?:`, R`([^\s/:@]{1,256})@((?:`],
  ['B dsn: no @/', R`(?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`(?:[a-z][\w-]{0,31})?\()/gi`],
  ['B dsn: network required', R`(?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`(?:[a-z][\w-]{0,31})\(|\/)/gi`],
  ['B dsn: tcp/udp/unix only', R`(?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`(?:tcp|udp|unix)\(|\/)/gi`],
  ['B dsn: tcp6 not a network (no digits)', R`(?:[a-z][\w-]{0,31})?\(|\/)/gi`, R`(?:[a-z]{1,32})?\(|\/)/gi`],
  ['B dsn: password shown', "`${user}:${hidden('d', pw)}@${rest}`", '`${user}:${pw}@${rest}`'],
  // attributes
  ['B attr: name single-quoted ignored', 'SECRET_NAME.test(m[2] ?? m[3] ?? m[4])', 'SECRET_NAME.test(m[2] ?? m[4])'],
  ['B attr: name unquoted ignored', 'SECRET_NAME.test(m[2] ?? m[3] ?? m[4])', 'SECRET_NAME.test(m[2] ?? m[3])'],
  ['B attr: value dq without apostrophe', R`(?:"([^"]*)"|'([^']*)'|([^\s"'<>=\x60]+))/gi`, R`(?:"([^"']*)"|'([^']*)'|([^\s"'<>=\x60]+))/gi`],
  ['B attr: value sq without quote', R`(?:"([^"]*)"|'([^']*)'|([^\s"'<>=\x60]+))/gi`, R`(?:"([^"]*)"|'([^'"]*)'|([^\s"'<>=\x60]+))/gi`],
  ['B attr: value unquoted ignored', R`(?:"([^"]*)"|'([^']*)'|([^\s"'<>=\x60]+))/gi`, R`(?:"([^"]*)"|'([^']*)')/gi`],
  ['B attr: value shown', "return `${name}${eq}${q}${hidden('x', value)}${q}`", 'return `${name}${eq}${q}${value}${q}`'],
  ['B attr: name quoted only', R`'([^'<>]{1,128})'|([^\s"'<>=\x60]{1,128}))/gi`, R`'([^'<>]{1,128})')/gi`],
  // pairs
  ['B pair: first name-like key only', "if (name === null && typeof obj[k] === 'string' && SECRET_NAME.test(obj[k])) name = obj[k]", "if (name === null && typeof obj[k] === 'string') name = SECRET_NAME.test(obj[k]) ? obj[k] : ''"],
  ['B pair: last secret name (equivalent: digest only)', "if (name === null && typeof obj[k] === 'string' && SECRET_NAME.test(obj[k])) name = obj[k]", "if (typeof obj[k] === 'string' && SECRET_NAME.test(obj[k])) name = obj[k]"],
  ['B row pair: none', 'masker.cell(name, field, r[field], pair !== null && pair.values.includes(field))', 'masker.cell(name, field, r[field])'],
  ['B row pair: first value field only', 'pair !== null && pair.values.includes(field))', 'pair !== null && pair.values[0] === field)'],
  ['B row pair: softDelete field masked too', "const as = secret && named !== 'plain' ? 'secret' : named", "const as = secret ? 'secret' : named"],
  ['B row pair: cleared value masked', 'if (as === null || as === \'plain\' || !isSet(value)) return plain(', 'if (as === null || as === \'plain\' || (!secret && !isSet(value))) return plain('],
  // fieldsBefore, seeded
  ['B diff: fieldsBefore null', 'fieldsBefore: b?.fields ?? null,', 'fieldsBefore: null,'],
  ['B diff: fieldsBefore from after', 'fieldsBefore: b?.fields ?? null,', 'fieldsBefore: a?.fields ?? b?.fields ?? null,'],
  ['B cols: seeded from the PR diff', 'new Set(own(baseDiff.collections, name)?.fieldsBefore ?? [])', 'new Set(own(prDiff.collections, name)?.fieldsBefore ?? [])'],
  ['B cols: seeded unsorted', 'const seeded = mine.items.filter(f => declared.has(f)).sort()', 'const seeded = mine.items.filter(f => declared.has(f))'],
  ['B cols: others unsorted', 'const others = mine.items.filter(f => !declared.has(f)).sort()', 'const others = mine.items.filter(f => !declared.has(f))'],
  ['B cols: others first', 'fields: [...seeded, ...others].slice(0, 5)', 'fields: [...others, ...seeded].slice(0, 5)'],
  ['B cols: seeded count wrong', 'seeded: seeded.length,', 'seeded: mine.n,'],
  ['B cols: six names', 'fields: [...seeded, ...others].slice(0, 5)', 'fields: [...seeded, ...others].slice(0, 6)'],
  // order: left out
  ['B order: no leftOut', 'LOSES_ROWS.has(f.kind) || leftOut(f) ? 0', 'LOSES_ROWS.has(f.kind) ? 0'],
  ['B order: leftOut only when omitted', "&& (!Object.hasOwn(prDiff.collections, f.collection) || Boolean(own(prDiff.collections, f.collection).omitted))", "&& Boolean(own(prDiff.collections, f.collection)?.omitted)"],
  ['B order: leftOut only when the PR diff lacks it', "&& (!Object.hasOwn(prDiff.collections, f.collection) || Boolean(own(prDiff.collections, f.collection).omitted))", "&& !Object.hasOwn(prDiff.collections, f.collection)"],
  ['B order: leftOut only after side', "|| Boolean(own(prDiff.collections, f.collection).omitted))", "|| own(prDiff.collections, f.collection).omitted === 'after')"],
  ['B order: leftOut for the PR-only fold', "const leftOut = f => f.kind === 'unverified' && typeof f.collection === 'string'", "const leftOut = f => f.kind === 'unverified'"],
  ['B order: column-dropped a loss', "new Set(['delete', 'emptied', 'dropped', 'key-lost'])", "new Set(['delete', 'emptied', 'dropped', 'key-lost', 'column-dropped'])"],
]

function run(dir) {
  return new Promise(resolve => {
    const child = spawn(NODE, ['--test', '--test-force-exit', '--test-reporter=spec', 'test/data-diff.test.mjs'], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, TIMEOUT)
    child.on('close', (code, signal) => { clearTimeout(timer); try { process.kill(-child.pid, 'SIGKILL') } catch {} ; resolve({ code, signal, out }) })
  })
}

const todo = mutants.filter(([name]) => !only || only.test(name))
if (process.env.DRY) {
  for (const [name, from] of todo) {
    const n = ORIG.split(from).length - 1
    if (n !== 1) console.log(`found ${n}x: ${name}`)
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
    const which = [...r.out.matchAll(/^\s*✖ (.*?) \(\d/gm)].map(m => m[1].slice(0, 60))
    const msgs = [...r.out.matchAll(/AssertionError \[ERR_ASSERTION\]: (.*)/g)].map(m => m[1].slice(0, 50))
    const syntax = /SyntaxError[^\n]*/.exec(r.out)?.[0]
    const verdict = r.signal === 'SIGKILL' ? 'killed (timeout)' : r.code === 0 ? 'SURVIVED' : syntax ? `BROKEN ${syntax.slice(0, 60)}` : 'killed'
    const line = `${verdict} ${JSON.stringify([...new Set(which)].slice(0, 3))} ${JSON.stringify(msgs.slice(0, 2))} ${((performance.now() - t) / 1000).toFixed(0)}s`
    results.set(name, line)
    console.log(`${line.slice(0, 300)} | ${name}`)
  }
}
await Promise.all(Array.from({ length: PAR }, (_, w) => worker(w)))
console.log('---')
for (const [name] of todo) console.log(`${(results.get(name) ?? '').slice(0, 10).padEnd(12)} ${name}`)
console.log('total', todo.length, 'survived', [...results.values()].filter(r => r.startsWith('SURVIVED')).length, 'skipped', [...results.values()].filter(r => r.startsWith('SKIP')).length)
