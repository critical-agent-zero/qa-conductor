// A deterministic real-world corpus: every template x every secret style x
// every wrapper, a few draws each. Prints, per template, how many cases each
// head shows, and every masking regression of 4033285 against an earlier head.
import { maskValues, maskUncut, HEAD_NAMES, NEW, OLD, leaked } from './h.mjs'
import { rng, secret, fragsOf, TEMPLATES, B64_TEMPLATES, pctAll, htmlEsc } from './gen.mjs'

const STYLES = ['alnum', 'sep', 'colon', 'at', 'angle', 'quote', 'bs', 'urlsafe', 'nodigit', 'long', 'space']
const WRAPS = {
  plain: t => t,
  obj: t => ({ msg: t }),
  json_text: t => JSON.stringify({ msg: t }),
  dbl: t => JSON.stringify(JSON.stringify({ msg: t })),
  ndjson: t => `{"a":1}\n${JSON.stringify({ msg: t })}`,
  nested: t => ({ outer: JSON.stringify({ msg: t }) }),
  lines: t => `first\n${t}\nlast`,
  pct_all: t => pctAll(t),
  html_esc: t => htmlEsc(t),
}
const r = rng(Number(process.argv[2] ?? 99))
const cases = []
for (const name of Object.keys(TEMPLATES)) {
  for (const style of STYLES) {
    for (let k = 0; k < 3; k++) {
      const s = secret(r, style)
      const text = TEMPLATES[name](r, s)
      let frags = B64_TEMPLATES.has(name) ? fragsOf(text.match(/[A-Za-z0-9+/=]{12,}/g)?.join(' ') ?? '') : fragsOf(s)
      if (name === 'jwt') frags = fragsOf(text.replace(/^.*?eyJhbGciOiJIUzI1NiJ9\./, ''))
      for (const [w, f] of Object.entries(WRAPS)) {
        const value = f(text)
        const shown = typeof value === 'string' ? value : JSON.stringify(value)
        const fr = frags.filter(x => shown.includes(x))
        if (fr.length) cases.push({ name, style, w, text, value, frags: fr })
      }
    }
  }
}
const out = maskValues(cases.map(c => c.value))
const un = maskUncut(cases.map(c => c.value))
const per = {}
const regress = []
cases.forEach((c, i) => {
  per[c.name] ??= Object.fromEntries(HEAD_NAMES.map(h => [h, 0]))
  per[c.name].n = (per[c.name].n ?? 0) + 1
  for (const h of HEAD_NAMES) if (leaked(un[h][i], c.frags).length) per[c.name][h]++
  const atNew = new Set(leaked(un[NEW][i], c.frags))
  for (const h of OLD) {
    const w = [...atNew].filter(f => !leaked(un[h][i], c.frags).includes(f))
    if (w.length) regress.push({ h, c, w, out: out[NEW][i], old: out[h][i] })
  }
})
console.log(`cases ${cases.length}; per template, cases in which any secret fragment shows (uncut):`)
console.log(`${'template'.padEnd(20)} ${'n'.padStart(4)} ${HEAD_NAMES.map(h => h.padStart(8)).join('')}`)
for (const [n, p] of Object.entries(per)) console.log(`${n.padEnd(20)} ${String(p.n).padStart(4)} ${HEAD_NAMES.map(h => String(p[h]).padStart(8)).join('')}`)
const byH = {}
for (const x of regress) byH[x.h] = (byH[x.h] ?? 0) + 1
console.log('regressions (uncut) by earlier head:', JSON.stringify(byH))
const seen = new Set()
for (const x of regress) {
  const sig = `${x.h}|${x.c.name}`
  if (seen.has(sig) || x.h === '2ec0bba') continue
  seen.add(sig)
  console.log(`-- vs ${x.h} ${x.c.name}/${x.c.style}/${x.c.w}: ${JSON.stringify(x.c.text).slice(0, 200)}\n   head: ${x.out.slice(0, 200)}\n   ${x.h}: ${x.old.slice(0, 200)}`)
}
