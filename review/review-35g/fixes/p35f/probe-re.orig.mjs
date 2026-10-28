// E4: the new value patterns alone, read from the source, on 256 KB.
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('./repo/lib/data-diff.mjs', import.meta.url), 'utf8')
const grab = name => {
  const line = src.split('\n').find(l => l.startsWith(`const ${name} = `))
  return eval(line.slice(`const ${name} = `.length))
}
const res = Object.fromEntries(['DSN_USERINFO', 'MYSQL_P', 'ATTR_TAG', 'JWT', 'FLAG_IN_TEXT', 'URL_USERINFO', 'TAG_IN_TEXT', 'PEM_KEY'].map(n => [n, grab(n)]))
const CELL = 256 * 1024
const fill = unit => unit.repeat(Math.ceil(CELL / unit.length)).slice(0, CELL)
const time = (re, s) => {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const t = process.cpuUsage()
    re.lastIndex = 0
    if (re.global) for (const _ of s.matchAll(re)) { /* walk */ } else re.test(s)
    const d = process.cpuUsage(t)
    best = Math.min(best, (d.user + d.system) / 1000)
  }
  return best.toFixed(1)
}
for (const [label, s] of [['a:', fill('a:')], ['a:b@', fill('a:b@')], ['mysql -x ', fill('mysql -x ')], ['mysql\\n', fill('mysql\n')], ['-p', fill('mysql' + ' -'.repeat(200) + '\n')], ['plain', fill('lorem ipsum ')]]) {
  console.log(label.padEnd(12), Object.entries(res).map(([n, re]) => `${n} ${time(re, s)}ms`).join('  '))
}
// the DSN with ':' kept out of the password: does it still read `root:pw@tcp(` and stop the scan?
const fixed = /(?<![\w.-])([\w.-]{1,64}):([^\s@/:]{1,256})@(tcp|udp|unix)\(/gi
console.log('dsn with [^\\s@/:]', time(fixed, fill('a:')), 'ms;', 'root:pw@tcp(h:1)/a'.replace(fixed, '$1:X@$3('))
