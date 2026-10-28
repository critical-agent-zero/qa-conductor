// Checks the sandbox-exec recipe on this Mac: two loopback servers, one the
// profile allows, one it denies; a child under the profile tries both, over
// 127.0.0.1, ::1 and localhost, and a host off loopback. Nothing leaves.
import net from 'node:net'
import { execFile } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const listen = host => new Promise(resolve => { const s = net.createServer(c => { c.on('error', () => {}); c.end('hi') }); s.listen(0, host, () => resolve(s)) })
const [allowed4, denied4] = [await listen('127.0.0.1'), await listen('127.0.0.1')]
const denied6 = await listen('::1')
const dir = mkdtempSync(join(tmpdir(), 'qa-sbx-'))
const profile = join(dir, 'pr-pane.sb')
writeFileSync(profile, `(version 1)
(allow default)
; no TCP connection to anything on loopback...
(deny network-outbound (remote ip "localhost:*"))
; ...but the ports this pane needs: its own database, say
(allow network-outbound (remote ip (string-append "localhost:" (param "OWN_DB_PORT"))))
`)
const client = `
const net = require('net')
const tries = JSON.parse(process.argv[1])
let left = tries.length
const out = {}
for (const [host, port] of tries) {
  const s = net.connect({ host, port }, () => { out[host + ':' + port] = 'connected'; s.destroy(); if (--left === 0) console.log(JSON.stringify(out)) })
  s.on('error', e => { out[host + ':' + port] = e.code; if (--left === 0) console.log(JSON.stringify(out)) })
}`
const tries = [['127.0.0.1', allowed4.address().port], ['127.0.0.1', denied4.address().port], ['localhost', denied4.address().port], ['::1', denied6.address().port]]
const run = (cmd, args) => new Promise(resolve => execFile(cmd, args, { timeout: 10_000 }, (err, stdout, stderr) => resolve({ err: err?.message ?? null, stdout: stdout.trim(), stderr: stderr.trim() })))
console.log('ports', JSON.stringify({ allowed: allowed4.address().port, denied4: denied4.address().port, denied6: denied6.address().port }))
console.log('without the profile', JSON.stringify(await run(process.execPath, ['-e', client, JSON.stringify(tries)])))
console.log('with the profile', JSON.stringify(await run('/usr/bin/sandbox-exec', ['-D', `OWN_DB_PORT=${allowed4.address().port}`, '-f', profile, process.execPath, '-e', client, JSON.stringify(tries)])))
for (const s of [allowed4, denied4, denied6]) s.close()
rmSync(dir, { recursive: true, force: true })
