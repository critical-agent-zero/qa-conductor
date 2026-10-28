// Hand mutants of 7193877's own round-3 code in lib/data-diff.mjs; each
// non-equivalent one must fail test/data-diff.test.mjs at 7193877. Each run
// is its own process group (detached), killed whole on timeout.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
const DIR = new URL('.', import.meta.url).pathname
const MUT = DIR + 'mut'
mkdirSync(MUT + '/lib', { recursive: true })
mkdirSync(MUT + '/test', { recursive: true })
cpSync(DIR + 'repo/test/data-diff.test.mjs', MUT + '/test/data-diff.test.mjs')
cpSync(DIR + 'repo/package.json', MUT + '/package.json')
const FILE = MUT + '/lib/data-diff.mjs'
const ORIG = readFileSync(DIR + 'repo/lib/data-diff.mjs', 'utf8')
const only = process.argv[2] ? new RegExp(process.argv[2]) : null
const TIMEOUT = 240_000

const Q = String.raw`(?:\\*["']|&(?:quot|apos|#0{0,4}3[49]|#x0{0,4}2[27]);)`
const mutants = [
  // the key scan (the high)
  ['scan: run guard removed', String.raw`(?<![\w.-])(?<!\\(?=\\))`, String.raw`(?<![\w.-])`],
  ['scan: verdict form (?<![\\w.\\\\-])', String.raw`(?<![\w.-])(?<!\\(?=\\))`, String.raw`(?<![\w.\\-])`],
  ['scan: no key after any backslash', String.raw`(?<!\\(?=\\))`, String.raw`(?<!\\)`],
  ['scan: guard lookahead inverted', String.raw`(?<!\\(?=\\))`, String.raw`(?<!\\(?!\\))`],
  ['scan: no HTML-escaped quotes', Q, String.raw`(?:\\*["'])`],
  ['scan: no &quot;', '&(?:quot|apos|', '&(?:apos|'],
  ['scan: no &apos;', '&(?:quot|apos|', '&(?:quot|'],
  ['scan: no decimal entity', '|#0{0,4}3[49]|', '|'],
  ['scan: no hex entity', '|#x0{0,4}2[27]);', ');'],
  ['scan: no trailing quote', String.raw`([\w.-]{1,128})${'${QUOTE}'}?\]?`, String.raw`([\w.-]{1,128})\]?`],
  ['scan: no space before [:=] (r3 survivor)', String.raw`\]?\s{0,8}[:=]`, String.raw`\]?[:=]`],
  ['scan: unbounded run in QUOTE bounded {0,1}', String.raw`(?:\\*["']|&`, String.raw`(?:\\?["']|&`],
  // tags
  ['tag: no namespace', String.raw`/<(?:[\w.-]{1,64}:)?([\w.-]{1,128})`, String.raw`/<([\w.-]{1,128})`],
  ['tag: no attributes', String.raw`(?:\s[^>]{0,256})?>/g`, '>/g'],
  ['tag: attributes not crossing < (suggested fix)', String.raw`(?:\s[^>]{0,256})?>/g`, String.raw`(?:\s[^<>]{0,256})?>/g`],
  // URL userinfo
  ['url: user needs a character', String.raw`(?:([^\s/:@]{0,256}):`, String.raw`(?:([^\s/:@]{1,256}):`],
  ['url: password stops at @', String.raw`:([^\s/]{1,256})|`, String.raw`:([^\s/@]{1,256})|`],
  ['url: no token alone', String.raw`|([^\s/:@]{16,256}))@/gi`, String.raw`)@/gi`],
  ['url: token alone from 8', String.raw`|([^\s/:@]{16,256}))@/gi`, String.raw`|([^\s/:@]{8,256}))@/gi`],
  ['url: token alone from 1', String.raw`|([^\s/:@]{16,256}))@/gi`, String.raw`|([^\s/:@]{1,256}))@/gi`],
  ['url: token shown', '? `${scheme}[secret ${mac(`u:${where}\\u0000${token}`, 8)}]@`', '? `${scheme}${token}@`'],
  // Authorization schemes
  ['auth: case-sensitive', String.raw`[A-Za-z0-9._~+/=-]{16,})/gi`, String.raw`[A-Za-z0-9._~+/=-]{16,})/g`],
  ['auth: title-case names (claimed equivalent)', '(bearer|basic|token)', '(Bearer|Basic|Token)'],
  ['auth: no digit rule (8+ always)', String.raw`((?=[A-Za-z0-9._~+/=-]{0,1024}\d)[A-Za-z0-9._~+/=-]{8,}|`, String.raw`([A-Za-z0-9._~+/=-]{8,}|`],
  ['auth: 16 rule from 8', String.raw`|[A-Za-z0-9._~+/=-]{16,})/gi`, String.raw`|[A-Za-z0-9._~+/=-]{8,})/gi`],
  ['auth: no 16 rule', String.raw`[A-Za-z0-9._~+/=-]{8,}|[A-Za-z0-9._~+/=-]{16,})/gi`, String.raw`[A-Za-z0-9._~+/=-]{8,})/gi`],
  ['auth: digit form from 12', String.raw`\d)[A-Za-z0-9._~+/=-]{8,}|`, String.raw`\d)[A-Za-z0-9._~+/=-]{12,}|`],
  ['auth: no basic', '(bearer|basic|token)', '(bearer|token)'],
  ['auth: no token', '(bearer|basic|token)', '(bearer|basic)'],
  // double encoding
  ['enc: no enc at the top', 'if (isTwice(value)) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }', ''],
  ['enc: only short cells', 'if (isTwice(value)) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }', 'if (isTwice(value) && toJson(held, where, 0).length <= MAX_TEXT) return { ...cellOfJsonText(toJson(held, where, 0)), enc: 2 }'],
  ['enc: nested loses outer string', 'return isTwice(s) ? JSON.stringify(toJson(held, where, depth + 1)) : toJson(held, where, depth + 1)', 'return toJson(held, where, depth + 1)'],
  ['enc: isTwice always', 'const isTwice = s => /^\\s*"/.test(s)', 'const isTwice = s => true'],
  ['enc: isTwice never', 'const isTwice = s => /^\\s*"/.test(s)', 'const isTwice = s => false'],
  ['enc: enc 1 for plain too', 'value = held\n    }', 'return { ...cellOfJsonText(toJson(held, where, 0)), enc: 1 }\n    }'],
  // pairs
  ['pair: case-sensitive', 'const lower = k.toLowerCase()', 'const lower = k'],
  ['pair: at most 2 keys', 'if (keys.length > 6) return null', 'if (keys.length > 2) return null'],
  ['pair: any number of keys', 'if (keys.length > 6) return null', ''],
  ['pair: no field/k', "new Set(['name', 'key', 'field', 'k'])", "new Set(['name', 'key'])"],
  ['pair: no val/v', "new Set(['value', 'val', 'v'])", "new Set(['value'])"],
  ['pair: name need not be a string', "PAIR_NAMES.has(lower) && typeof obj[k] === 'string') name = obj[k]", 'PAIR_NAMES.has(lower)) name = String(obj[k])'],
  ['pair: null value masked', "PAIR_VALUES.has(lower) && obj[k] !== null && obj[k] !== undefined) value = k", 'PAIR_VALUES.has(lower)) value = k'],
  ['pair: last value key wins', 'else if (value === null && PAIR_VALUES.has(lower)', 'else if (PAIR_VALUES.has(lower)'],
  // the cache
  ['cache: long fields cached', 'if (cacheable && field.length <= CACHED_NAME && fieldsCached', 'if (cacheable && fieldsCached'],
  ['cache: long collections cached', 'const cacheable = collection.length <= CACHED_NAME', 'const cacheable = true'],
  ['cache: CACHED_NAME 127', 'const CACHED_NAME = 128', 'const CACHED_NAME = 127'],
  ['cache: reset before the cacheable check', "if (cacheable) {\n        if (classes.size >= CLASS_CACHE) { classes.clear(); fieldsCached = 0 }", "if (classes.size >= CLASS_CACHE) { classes.clear(); fieldsCached = 0 }\n      if (cacheable) {"],
  // omitted
  ['omitted: always 0', 'return { collections, problems, omitted: total - n }', 'return { collections, problems, omitted: 0 }'],
  ['omitted: null unreadable as 0', "problems: ['the snapshot has no collections object'], omitted: null }", "problems: ['the snapshot has no collections object'], omitted: 0 }"],
  ['omitted: thrown read as 0', 'problems: [`the snapshot could not be read: ${String(err?.message ?? err)}`], omitted: null }', 'problems: [`the snapshot could not be read: ${String(err?.message ?? err)}`], omitted: 0 }'],
  ['omitted: mayOmit ignores null', 'const mayOmit = snapshot => snapshot.omitted !== undefined && snapshot.omitted !== 0', 'const mayOmit = snapshot => snapshot.omitted > 0'],
  ['omitted: mayOmit counts undefined', 'const mayOmit = snapshot => snapshot.omitted !== undefined && snapshot.omitted !== 0', 'const mayOmit = snapshot => snapshot.omitted !== 0'],
  ['omitted: after side dropped', "mayOmit(after) ? omittedChange(b, null, 'after') : changeOf('dropped', b, null, b.key)", "changeOf('dropped', b, null, b.key)"],
  ['omitted: before side added', "if (!b && mayOmit(before)) { put(collections, name, omittedChange(null, a, 'before')); continue }", ''],
  ['omitted: long names not counted', 'omitted: total - n }', 'omitted: names.length - n }'],
  ['omitted: unreadable not counted', "if (kept.has(name)) { put(collections, name, kept.get(name)); n++ } else if", "n++\n    if (kept.has(name)) { put(collections, name, kept.get(name)) } else if"],
  ['omittedChange: counts 0 not null', "countBefore: b ? b.count : null, countAfter: a ? a.count : null", "countBefore: b ? b.count : 0, countAfter: a ? a.count : 0"],
  ['omittedChange: not truncated', 'countAfter: a ? a.count : null, truncated: true, omitted: side }', 'countAfter: a ? a.count : null, truncated: false, omitted: side }'],
  ['omittedChange: no side', 'truncated: true, omitted: side }', 'truncated: true, omitted: null }'],
  ['divergence: omitted not unknown', "if (b?.omitted || p?.omitted) status = 'unknown'", ''],
  ['divergence: only PR omitted unknown', "if (b?.omitted || p?.omitted) status = 'unknown'", "if (p?.omitted) status = 'unknown'"],
  ['countsOf: omitted guessed', 'if (!d || d.omitted) return { inserted: 0, updated: 0, deleted: 0 }', 'if (!d) return { inserted: 0, updated: 0, deleted: 0 }'],
  ['tally: omitted read', '    if (c.omitted) continue\n', ''],
  ['flags: omitted can be shared', 'const shared = !c.omitted && !b.omitted && Boolean(b.truncated)', 'const shared = Boolean(b.truncated)'],
  ['flags: base omitted can be shared', 'const shared = !c.omitted && !b.omitted && Boolean(b.truncated)', 'const shared = !c.omitted && Boolean(b.truncated)'],
  // the fold and the order
  ['fold: none', 'if (b === undefined) { prOnly.push(name); continue }', ''],
  ['fold: all names', 'names: prOnly.slice(0, 5) })', 'names: prOnly })'],
  ['fold: names unsorted', '    prOnly.sort()\n', ''],
  ['fold: amber when trusted', "flags.push({ collection: null, kind: 'unverified', severity: 'red'", "flags.push({ collection: null, kind: 'unverified', severity: trusted ? 'amber' : 'red'"],
  ['fold: a made-up name', "flags.push({ collection: null, kind: 'unverified'", "flags.push({ collection: '(collections)', kind: 'unverified'"],
  ['fold: pr 1', "shared: false, pr: prOnly.length, base: 0, collections", "shared: false, pr: 1, base: 0, collections"],
  ['order: not red first', "const order = (x, y) => (x.severity === y.severity ? 0 : x.severity === 'red' ? -1 : 1)\n    || ", 'const order = (x, y) => '],
  ['order: no base first', '    || prOwn(x) - prOwn(y)\n', ''],
  ['order: no destructive first', '    || late(x) - late(y)\n', ''],
  ['order: kind before base', '    || prOwn(x) - prOwn(y)\n    || late(x) - late(y)\n', '    || late(x) - late(y)\n    || prOwn(x) - prOwn(y)\n'],
  ['order: cleared not late', "const late = f => (f.kind === 'unverified' || f.kind === 'cleared' ? 1 : 0)", "const late = f => (f.kind === 'unverified' ? 1 : 0)"],
  ['order: null name first', 'x === null ? 1 : y === null ? -1', 'x === null ? -1 : y === null ? 1'],
  ['order: prOwn ignores null', 'f.collection === null || !Object.hasOwn', '!Object.hasOwn'],
  // caps
  ['cap: MAX_NAME 2000', 'const MAX_NAME = 200', 'const MAX_NAME = 2000'],
  ['cap: MAX_NAME 199', 'const MAX_NAME = 200', 'const MAX_NAME = 199'],
  ['cap: MAX_KEY_FIELDS 33', 'const MAX_KEY_FIELDS = 32', 'const MAX_KEY_FIELDS = 33'],
  ['cap: MAX_FIELDS 2001', 'const MAX_FIELDS = 2_000', 'const MAX_FIELDS = 2_001'],
  ['cap: wide key kept', '    named = []\n  }', '  }'],
  ['cap: key not charged', 'let size = sizeOf(named) + sizeOf(fields)', 'let size = sizeOf(fields)'],
  ['cap: fields not charged', 'let size = sizeOf(named) + sizeOf(fields)', 'let size = sizeOf(named)'],
  ['cap: nothing charged', 'let size = sizeOf(named) + sizeOf(fields)', 'let size = 0'],
  ['cap: over budget kept anyway', '  if (size > budget) {\n    problems.push(`${name}: its key and declared fields', '  if (false) {\n    problems.push(`${name}: its key and declared fields'],
  ['cap: count-only not truncated', "collection: { key: null, fields: null, rows: [], count, truncated: true } }", "collection: { key: null, fields: null, rows: [], count, truncated } }"],
  ['cap: count-only charged its fields', 'const countOnly = { size: 0,', 'const countOnly = { size: sizeOf(fields),'],
  ['cap: long-name problem unsaid', 'if (long) {\n    problems.push(', 'if (long) {\n    void ('],
  // the round-3 survivors
  ['r3: stub count from rows only', 'count = Math.max(Number.isSafeInteger(c?.count) && c.count >= 0 ? c.count : 0, rows)', 'count = rows'],
  ['r3: diff fields back to includes', 'out.fieldsDropped = b.fields.filter(f => !has.has(f))\n      out.fieldsAdded = a.fields.filter(f => !had.has(f))', 'out.fieldsDropped = b.fields.filter(f => !a.fields.includes(f))\n      out.fieldsAdded = a.fields.filter(f => !b.fields.includes(f))'],
  ['r3: unverified also for dropped', "if (!c.truncated || c.status === 'dropped') continue", 'if (!c.truncated) continue'],
  ['r3: shared ignores countBefore', "Boolean(b.truncated) && b.countBefore === c.countBefore && b.countAfter === c.countAfter", 'Boolean(b.truncated) && b.countAfter === c.countAfter'],
]

function run() {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-force-exit', '--test-reporter=spec', 'test/data-diff.test.mjs'], { cwd: MUT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, TIMEOUT)
    child.on('close', (code, signal) => { clearTimeout(timer); try { process.kill(-child.pid, 'SIGKILL') } catch {} ; resolve({ code, signal, out }) })
  })
}

const results = []
for (const [name, from, to] of mutants) {
  if (only && !only.test(name)) continue
  const n = ORIG.split(from).length - 1
  if (n !== 1) { results.push([name, `SKIP (found ${n}x)`]); console.log(results.at(-1)[1], name); continue }
  writeFileSync(FILE, ORIG.replace(from, () => to))
  const t = performance.now()
  const r = await run()
  const failed = /ℹ fail (\d+)/.exec(r.out)?.[1]
  const which = [...r.out.matchAll(/^✖ (.*?) \(\d/gm)].map(m => m[1].slice(0, 60))
  const verdict = r.signal === 'SIGKILL' ? 'killed (timeout)' : r.code === 0 ? 'SURVIVED' : `killed (${failed ?? 'err'} failing)`
  results.push([name, `${verdict} ${JSON.stringify([...new Set(which)].slice(0, 2))} ${((performance.now() - t) / 1000).toFixed(0)}s`])
  console.log(results.at(-1)[1].slice(0, 120).padEnd(60), '|', name)
}
writeFileSync(FILE, ORIG)
console.log('---')
for (const [n, s] of results) console.log(s.slice(0, 16).padEnd(18), n)
console.log('total', results.length, 'survived', results.filter(r => r[1].startsWith('SURVIVED')).length, 'skipped', results.filter(r => r[1].startsWith('SKIP')).length)
