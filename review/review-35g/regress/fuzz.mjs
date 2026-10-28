// Differential fuzz: real-world secret shapes, concatenated, mutated and
// wrapped, masked at every head. A regression is a fragment of a secret that
// 4033285 shows and an earlier head hid.
// usage: node fuzz.mjs <seed> <cases> <mode: mix|boundary|grammar> [out.jsonl]
import { writeFileSync, appendFileSync } from 'node:fs'
import { maskValues, maskUncut, HEAD_NAMES, NEW, OLD, leaked } from './h.mjs'
import { rng, secret, frag, fragsOf, TEMPLATES, B64_TEMPLATES, SEPS, pctAll, htmlEsc } from './gen.mjs'

const seed = Number(process.argv[2] ?? 1)
const total = Number(process.argv[3] ?? 10000)
const mode = process.argv[4] ?? 'mix'
const outFile = process.argv[5] ?? `out-fuzz-${mode}-${seed}.jsonl`
writeFileSync(outFile, '')
const r = rng(seed)
const NAMES = Object.keys(TEMPLATES)
const JOINS = ['', ' ', ' ', '\n', '\r\n', '\t', ';', ',', '&', '>', '"', "'", ' | ', '  ', '/', ':', '=', '<br>', '</td><td>', '\\n', '%0A', '"}', ')', ']']

function piece() {
  const name = r.pick(NAMES)
  const s = secret(r)
  let text = TEMPLATES[name](r, s)
  let frags = B64_TEMPLATES.has(name) ? fragsOf(text.match(/[A-Za-z0-9+/=]{12,}/g)?.join(' ') ?? '') : fragsOf(s)
  if (name === 'jwt') frags = fragsOf(text.replace(/^.*?eyJhbGciOiJIUzI1NiJ9\./, ''))
  return { name, text, frags }
}

// the grammar mode: tokens from every text rule, with secrets between
const GTOK = () => r.pick([
  'Bearer ', 'bearer ', 'Basic ', 'token ', 'Token  ', '//bearer ', 'x/token ',
  'root:', 'u:', 'a:', ':', '::', '@', '@tcp(h)', '@tcp(', '@unix(/s)', '@/', '@(', '@/db', '@cloudsql(p:r:i)/d',
  '<input type=password value=', '<input type="password" value="', '<add key="DbPassword" value="', "<add key='ApiToken' value='", '<x name=secret value=', '<x id=pwd value=', '<b>', '</b>', '>', '/>', '"', "'", ' ', '\n', '\t', '<', '=', '&', ';', ',',
  'https://', 'redis://:', 'postgres://app:', 'mysql://', 'git@', 'x-oauth-basic',
  'eyJhbGciOiJIUzI1NiJ9.', 'eyJzdWIiOiIxIn0.', '.', '-', '_',
  'style="width:100%"', 'class="sm:w-full"', '@media(max-width:600px)', 'href="mailto:a@b.c"',
  'password=', '%3D', '%26', '%22', '\\"', '\\n', 'note=', 'value=', 'key=', 'name=', 'type=',
  '--token ', '-p', 'mysql ', '-----BEGIN RSA PRIVATE KEY-----',
])

function grammarCase() {
  const parts = []
  const frags = []
  const n = 3 + r.int(10)
  for (let i = 0; i < n; i++) {
    if (r.chance(0.3)) {
      const s = r.chance(0.5) ? frag(r) : secret(r)
      parts.push(s)
      frags.push(...fragsOf(s))
    } else parts.push(GTOK())
  }
  return { names: ['grammar'], text: parts.join(''), frags }
}

function boundaryCase() {
  // two or three pieces from the element / DSN / scheme / URL / JWT families, glued
  const fam = ['go_dsn', 'go_dsn_slash', 'go_dsn_paren', 'html_input', 'html_input_unq', 'xml_add', 'xml_add_unq', 'html_min', 'auth_free', 'url_pw', 'url_token_user', 'jwt', 'url_empty_user', 'xml_tag', 'spring_prop']
  const k = 2 + r.int(2)
  const pieces = []
  for (let i = 0; i < k; i++) {
    const name = r.pick(fam)
    const s = secret(r, r.pick(['colon', 'at', 'angle', 'quote', 'sep', 'alnum', 'space', 'urlsafe']))
    pieces.push({ name, text: TEMPLATES[name](r, s), frags: name === 'jwt' ? [] : fragsOf(s) })
  }
  let text = pieces[0].text
  for (const p of pieces.slice(1)) text += r.pick(JOINS) + p.text
  return { names: pieces.map(p => p.name), text, frags: pieces.flatMap(p => p.frags) }
}

// a secret element whose other attributes hold long JWTs, DSNs, URLs or
// tokens that the text rules shorten, with the secret value early
function jwtOf(n) {
  let s = 'eyJhbGciOiJSUzI1NiJ9.eyJ'
  while (s.length < n) s += frag(r, { len: 8 })
  return `${s}.${frag(r, { len: 20 })}`
}
function longCase() {
  const s = secret(r, r.pick(['alnum', 'sep', 'urlsafe', 'colon', 'at']))
  const tag = r.pick(['input', 'add', 'property', 'x:add', 'param'])
  const named = r.pick(['type="password"', 'name="api_token"', 'key="DbPassword"', "id='secret'", 'type=password', 'name=ClientSecret'])
  const q = r.pick(['"', "'", ''])
  const val = q ? `value=${q}${s.replace(new RegExp(q, 'g'), '')}${q}` : `value=${s.replace(/[\s"'<>=`]/g, '')}`
  const extras = []
  const n = 1 + r.int(4)
  for (let i = 0; i < n; i++) {
    const kind = r.int(5)
    const nm = r.pick(['data-a', 'data-state', 'content', 'note', 'src', 'title', 'data-claims', 'href'])
    if (kind === 0) extras.push(`${nm}="${jwtOf(100 + r.int(1400))}"`)
    else if (kind === 1) extras.push(`${nm}="u:${'p'.repeat(20 + r.int(236))}@tcp(h)/d"`)
    else if (kind === 2) extras.push(`${nm}="https://u:${frag(r, { len: 20 + r.int(200) })}@h/x"`)
    else if (kind === 3) extras.push(`${nm}="Bearer ${frag(r, { len: 20 + r.int(300) })}"`)
    else extras.push(`${nm}="${'w'.repeat(r.int(400))}"`)
  }
  const attrs = [named, val, ...extras]
  if (r.chance(0.3)) attrs.sort(() => r.f() - 0.5)
  const text = `<${tag} ${attrs.join(r.pick([' ', '\n  ', '\t']))}${r.pick(['/>', '>', ' />'])}`
  const v = val.replace(/^value=['"]?/, '')
  return { names: ['long'], text, frags: fragsOf(v) }
}

function mixCase() {
  const k = r.chance(0.6) ? 1 : 2 + r.int(2)
  const pieces = Array.from({ length: k }, piece)
  let text = pieces[0].text
  for (const p of pieces.slice(1)) text += r.pick(JOINS) + p.text
  return { names: pieces.map(p => p.name), text, frags: pieces.flatMap(p => p.frags) }
}

function mutate(text) {
  const m = r.int(6)
  let t = text
  for (let i = 0; i < m; i++) {
    const at = r.int(t.length + 1)
    switch (r.int(7)) {
      case 0: t = t.slice(0, at) + r.pick(SEPS) + t.slice(at); break
      case 1: t = t.slice(0, at) + t.slice(at + 1); break
      case 2: t = t.slice(0, at) + r.pick([' ', '\n', '\t', '>', '<', ':', '@', '"']) + t.slice(at); break
      case 3: { const j = r.int(t.length); const len = 1 + r.int(12); t = t.slice(0, at) + t.slice(j, j + len) + t.slice(at); break }
      case 4: t = t.replace(/bearer|basic|token|password|value|tcp/i, w => (r.chance(0.5) ? w.toUpperCase() : w.toLowerCase())); break
      case 5: t = t.slice(0, at) + r.pick(['%3D', '%3A', '%26', '%22', '&quot;', '&amp;', '\\"', '\\\\']) + t.slice(at); break
      default: break
    }
  }
  return t
}

const WRAPS = {
  plain: t => t,
  obj: t => ({ msg: t, n: 1 }),
  json_text: t => JSON.stringify({ msg: t }),
  dbl: t => JSON.stringify(JSON.stringify({ msg: t })),
  ndjson: t => `{"a":1}\n${JSON.stringify({ msg: t })}`,
  nested: t => ({ outer: JSON.stringify({ msg: t }) }),
  array: t => ['x', t],
  lines: t => `first line\n${t}\nlast line`,
  pct_all: t => pctAll(t),
  html_esc: t => htmlEsc(t),
  prefix_long: t => `${'x'.repeat(40)} ${t}`,
  pair_desc: t => [{ name: 'description', value: t }],
}
const WRAP_NAMES = Object.keys(WRAPS)

const BATCH = 400
let done = 0
const counts = { cases: 0, regress: 0, regressMask: 0, byOld: {}, bySig: {} }
const t0 = Date.now()
while (done < total) {
  const n = Math.min(BATCH, total - done)
  const cases = []
  for (let i = 0; i < n; i++) {
    const c = mode === 'grammar' ? grammarCase() : mode === 'boundary' ? boundaryCase() : mode === 'long' ? longCase() : mixCase()
    if (r.chance(mode === 'grammar' ? 0.3 : mode === 'long' ? 0.1 : 0.5)) c.text = mutate(c.text)
    c.wrap = mode === 'grammar' || mode === 'long' ? (r.chance(0.8) ? 'plain' : r.pick(WRAP_NAMES)) : r.pick(WRAP_NAMES)
    c.value = WRAPS[c.wrap](c.text)
    const shown = typeof c.value === 'string' ? c.value : JSON.stringify(c.value)
    c.frags = [...new Set(c.frags)].filter(f => shown.includes(f))
    if (c.frags.length) cases.push(c)
  }
  const outs = maskValues(cases.map(c => c.value))
  const flagged = []
  cases.forEach((c, i) => {
    const atNew = new Set(leaked(outs[NEW][i], c.frags))
    const regress = {}
    for (const h of OLD) {
      const atOld = new Set(leaked(outs[h][i], c.frags))
      const worse = [...atNew].filter(f => !atOld.has(f))
      if (worse.length) regress[h] = worse
    }
    if (Object.keys(regress).length) flagged.push({ c, i, regress })
  })
  // classify with the uncut heads: a masking regression, or only the cut moving
  if (flagged.length) {
    const un = maskUncut(flagged.map(f => f.c.value))
    flagged.forEach((f, j) => {
      const atNew = new Set(leaked(un[NEW][j], f.c.frags))
      const mask = {}
      for (const h of OLD) {
        const atOld = new Set(leaked(un[h][j], f.c.frags))
        const worse = [...atNew].filter(x => !atOld.has(x))
        if (worse.length) mask[h] = worse
      }
      const sig = `${f.c.names.join('+')}|${f.c.wrap}|${Object.keys(f.regress).join(',')}|${Object.keys(mask).length ? 'mask' : 'cut'}`
      counts.bySig[sig] = (counts.bySig[sig] ?? 0) + 1
      counts.regress++
      if (Object.keys(mask).length) counts.regressMask++
      for (const h of Object.keys(f.regress)) counts.byOld[h] = (counts.byOld[h] ?? 0) + 1
      appendFileSync(outFile, `${JSON.stringify({ names: f.c.names, wrap: f.c.wrap, text: f.c.text, frags: f.c.frags, regress: f.regress, mask, out: Object.fromEntries(HEAD_NAMES.map(h => [h, outs[h][f.i]])) })}\n`)
    })
  }
  counts.cases += cases.length
  done += n
}
console.log(JSON.stringify({ seed, mode, total, ...counts, ms: Date.now() - t0 }, null, 1))
