// Which SBPL forms let one loopback port through while denying the rest.
import net from 'node:net'
import { execFile } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const listen = host => new Promise(resolve => { const s = net.createServer(c => { c.on('error', () => {}); c.end('hi') }); s.listen(0, host, () => resolve(s)) })
const [allowed, denied] = [await listen('127.0.0.1'), await listen('127.0.0.1')]
const six = await listen('::1')
const S = six.address().port
const A = allowed.address().port
const D = denied.address().port
const dir = mkdtempSync(join(tmpdir(), 'qa-sbx-'))
const client = `
const net = require('net')
const tries = JSON.parse(process.argv[1])
let left = tries.length
const out = {}
for (const [host, port] of tries) {
  const s = net.connect({ host, port }, () => { out[port] = 'ok'; s.destroy(); if (--left === 0) console.log(JSON.stringify(out)) })
  s.on('error', e => { out[port] = e.code; if (--left === 0) console.log(JSON.stringify(out)) })
}`
const variants = {
  'deny two by param, v4 and v6': `(version 1)(allow default)(deny network-outbound (remote ip (string-append "localhost:" (param "P"))))(deny network-outbound (remote ip (string-append "localhost:" (param "Q"))))`,
  'deny then allow literal': `(version 1)(allow default)(deny network-outbound (remote ip "localhost:*"))(allow network-outbound (remote ip "localhost:${A}"))`,
  'deny literal only': `(version 1)(allow default)(deny network-outbound (remote ip "localhost:${D}"))`,
  'deny literal by param': `(version 1)(allow default)(deny network-outbound (remote ip (string-append "localhost:" (param "P"))))`,
  'deny tcp literal': `(version 1)(allow default)(deny network-outbound (remote tcp "localhost:${D}"))`,
  'deny all but require-not': `(version 1)(allow default)(deny network-outbound (require-all (remote ip "localhost:*") (require-not (remote ip "localhost:${A}"))))`,
}
const run = (args) => new Promise(resolve => execFile('/usr/bin/sandbox-exec', args, { timeout: 10_000 }, (err, stdout, stderr) => resolve(stdout.trim() || `${err?.message ?? ''} ${stderr.trim()}`)))
for (const [name, text] of Object.entries(variants)) {
  const file = join(dir, `${name.replace(/\W+/g, '-')}.sb`)
  writeFileSync(file, text)
  console.log(name.padEnd(28), await run(['-D', `P=${D}`, '-D', `Q=${S}`, '-f', file, process.execPath, '-e', client, JSON.stringify([['127.0.0.1', A], ['127.0.0.1', D], ['::1', S], ['localhost', D]])]))
}
console.log('allowed', A, 'denied', D)
for (const s of [allowed, denied, six]) s.close()
rmSync(dir, { recursive: true, force: true })
