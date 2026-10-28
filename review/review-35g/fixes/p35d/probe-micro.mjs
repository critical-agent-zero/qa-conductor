// What one masked list element costs: the HMAC, the failed JSON.parse of
// the '[secret …]' string it becomes, and the rest.
import { createHmac } from 'node:crypto'
const key = Buffer.alloc(32, 7)
const N = 100_000
const time = (label, fn) => { fn(); const c0 = process.cpuUsage(); const t = performance.now(); for (let i = 0; i < N; i++) fn(i); const c = process.cpuUsage(c0); console.log(`${label.padEnd(44)} ${(((c.user + c.system) / N)).toFixed(2)} us cpu each (wall ${((performance.now() - t) * 1000 / N).toFixed(2)} us)`) }
time('createHmac(...).update().digest(hex)', i => createHmac('sha256', key).update(`j:t\u0000f\u0000pass\u0000"x${i}"`).digest('hex').slice(0, 8))
time("JSON.parse('[secret 1234abcd]') throwing", () => { try { JSON.parse('[secret 1234abcd]') } catch { /* */ } })
time("/^\\s*[[{]/ test only", () => /^\s*[[{]/.test('[secret 1234abcd]'))
time('JSON.stringify with a replacer, one string', () => JSON.stringify('x', function (k, v) { return v }))
