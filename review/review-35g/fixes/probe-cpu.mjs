// CPU time of 256 KB of 'a:' (the README's Hostile PR data line) per head.
import { M } from './h.mjs'
const v = 'a:'.repeat(128 * 1024)
for (const h of ['4a284f9', '4ed6449', '4033285']) {
  M[h].cell('warm')
  const best = []
  for (let i = 0; i < 3; i++) {
    const t = process.cpuUsage()
    M[h].cell(v)
    const d = process.cpuUsage(t)
    best.push(Math.round((d.user + d.system) / 1000))
  }
  console.log(h, 'cpu ms', best.join(' '))
}
