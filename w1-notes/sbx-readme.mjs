// Runs the README's own pr-pane.sb: five named ports shut, one other open.
import net from 'node:net'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const readme = readFileSync(new URL('../repo31/README.md', import.meta.url), 'utf8')
const profileText = /```scheme\n([\s\S]*?)```/.exec(readme)[1]
const listen = host => new Promise(resolve => { const s = net.createServer(c => { c.on('error', () => {}); c.end('hi') }); s.listen(0, host, () => resolve(s)) })
const names = ['HARNESS', 'BASE_PROXY', 'PR_PROXY', 'BASE_APP', 'BASE_DB']
const servers = {}
for (const name of names) servers[name] = await listen(name === 'BASE_DB' ? '::1' : '127.0.0.1')
const other = await listen('127.0.0.1')
const dir = mkdtempSync(join(tmpdir(), 'qa-sbx-'))
const file = join(dir, 'pr-pane.sb')
writeFileSync(file, profileText)
const tries = [...names.map(n => [n === 'BASE_DB' ? '::1' : '127.0.0.1', servers[n].address().port, n]), ['127.0.0.1', other.address().port, 'OTHER']]
const client = `
const net = require('net')
const tries = JSON.parse(process.argv[1])
let left = tries.length
const out = {}
for (const [host, port, name] of tries) {
  const s = net.connect({ host, port }, () => { out[name] = 'connected'; s.destroy(); if (--left === 0) console.log(JSON.stringify(out)) })
  s.on('error', e => { out[name] = e.code; if (--left === 0) console.log(JSON.stringify(out)) })
}`
const params = names.flatMap(n => ['-D', `${n}=${servers[n].address().port}`])
execFile('/usr/bin/sandbox-exec', [...params, '-f', file, process.execPath, '-e', client, JSON.stringify(tries)], { timeout: 10_000 }, (err, stdout, stderr) => {
  console.log(stdout.trim() || `${err?.message} ${stderr}`)
  for (const s of [...Object.values(servers), other]) s.close()
  rmSync(dir, { recursive: true, force: true })
})
