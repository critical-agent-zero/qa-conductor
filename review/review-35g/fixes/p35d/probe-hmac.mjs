// (5) CPU per raw MB of shapes that make the masker take one HMAC every few
// bytes, at a smaller scale (MB raw from argv), extrapolated to 32 MB.
// usage: node probe-hmac.mjs <engine head|old> <MB> <shape...>
const engine = process.argv[2] ?? 'head'
const MB = Number(process.argv[3] ?? 4)
const only = process.argv.slice(4)
const lib = engine === 'old' ? './old/data-diff-2ec0bba.mjs' : './repo/lib/data-diff.mjs'
const { createMasker, sanitizeSnapshot, validateRules } = await import(lib)
const rules = validateRules({})
const masker = createMasker({ key: Buffer.alloc(32, 7), rules })
const BYTES = MB * 1048576
const K = 256 * 1024
const fill = (unit, n = K) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
// each builder returns { rows } whose JSON is about BYTES
const textRows = unit => ({ key: ['id'], rows: Array.from({ length: Math.round(BYTES / K) }, (_, i) => ({ id: i, note: fill(unit) })) })
const shapes = {
  'plain text cells': () => textRows('lorem ipsum dolor sit amet '),
  'url a://:x@ text cells': () => textRows('a://:x@'),
  'url a://u:x@ text cells': () => textRows('a://u:x@'),
  'Bearer 12345678 text cells': () => textRows('Bearer 12345678 '),
  'tag <a  text cells': () => textRows('<a '),
  // secret-looking row fields: one HMAC per field (since round 1)
  'secret row fields {pass0:1,...}': () => {
    const per = 1000
    const n = Math.round(BYTES / (per * 10))
    return { key: ['id'], rows: Array.from({ length: n }, (_, i) => { const r = { id: i }; for (let j = 0; j < per; j++) r[`pass${j}`] = 1; return r }) }
  },
  // secret-looking keys inside a JSON value
  'JSON cell with secret keys': () => {
    const per = 20000
    const n = Math.round(BYTES / (per * 12))
    return { key: ['id'], rows: Array.from({ length: n }, (_, i) => { const o = {}; for (let j = 0; j < per; j++) o[`pass${j}`] = 1; return { id: i, doc: o } }) }
  },
  // a list of strings: each string after a secret-looking one is masked (rawHeaders)
  'JSON list ["pass","x",...]': () => {
    const per = 20000
    const n = Math.round(BYTES / (per * 6))
    const list = Array.from({ length: per }, (_, j) => (j % 2 ? 'x' : 'pass'))
    return { key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i, doc: list })) }
  },
  // name and value pairs
  'JSON list of {k:"pass",v:1}': () => {
    const per = 20000
    const n = Math.round(BYTES / (per * 18))
    const list = Array.from({ length: per }, () => ({ k: 'pass', v: 1 }))
    return { key: ['id'], rows: Array.from({ length: n }, (_, i) => ({ id: i, doc: list })) }
  },
  // short text cells each with a secret-looking key: one HMAC per cell
  'many short cells "p=1"': () => {
    const per = 1000
    const n = Math.round(BYTES / (per * 12))
    return { key: ['id'], rows: Array.from({ length: n }, (_, i) => { const r = { id: i }; for (let j = 0; j < per; j++) r[`f${j}`] = 'p=1'; return r }) }
  },
}
for (const [name, build] of Object.entries(shapes)) {
  if (only.length && !only.some(o => name.startsWith(o))) continue
  const c = build()
  const rawBytes = JSON.stringify(c).length
  global.gc?.()
  const t = performance.now()
  const cpu0 = process.cpuUsage()
  const snap = sanitizeSnapshot({ collections: { t: { ...c, count: c.rows.length } } }, { masker, rules })
  const took = performance.now() - t
  const cpu = process.cpuUsage(cpu0)
  process.stdout.write(`[cpu user+sys ${((cpu.user + cpu.system) / 1000).toFixed(0)} ms, wall ${took.toFixed(0)} ms] `)
  const kept = snap.collections.t
  const perMB = took / (rawBytes / 1048576)
  console.log(`${engine} ${name.padEnd(34)} raw ${(rawBytes / 1048576).toFixed(1)} MB: ${took.toFixed(0)} ms = ${perMB.toFixed(0)} ms/MB -> ${(perMB * 32 / 1000).toFixed(1)} s at 32 MB; kept ${kept.rows.length}/${c.rows.length} rows${kept.truncated ? ' (truncated)' : ''}${snap.problems.length ? ' problems ' + JSON.stringify(snap.problems).slice(0, 100) : ''}`)
}
