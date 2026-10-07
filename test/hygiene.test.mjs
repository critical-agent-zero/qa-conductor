// The repository is public, and so is everything it has ever tracked. So no
// tracked file may name a real tailnet or a device's tailnet address, an
// absolute path under a home directory, or the private app the conductor was
// first built for. Fixtures use the placeholders below instead.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// The one tailnet and the one tailnet address fixtures may use.
const TAILNET = 'tail1234'
const TAILNET_ADDRESS = '100.64.0.1'
// A tailnet name a fixture may use for a device's MagicDNS name,
// <device>.<tailnet>.ts.net, beside TAILNET.
const PLACEHOLDER_TAILNETS = new Set([TAILNET, 'example'])

// Tailscale names a tailnet tail<hex>.ts.net, or with a "fun name" of two
// words, <word>-<word>.ts.net. Any other one-label name before
// .ts.net (h.ts.net, box.ts.net) is a fixture's placeholder host: no
// tailnet is called that.
const TS_NET = /\b((?:[a-z0-9-]+\.)*)([a-z0-9-]+)\.ts\.net\b/gi
const TAILNET_ID = /\btail[0-9a-f]{4,}\b/gi
const looksLikeTailnet = label => /^tail[0-9a-f]+$/i.test(label) || label.includes('-')

// 100.64.0.0/10, the shared address space Tailscale gives each device. Its
// network address names the range, not a device.
const CGNAT = /\b100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g
const ALLOWED_ADDRESSES = new Set([TAILNET_ADDRESS, '100.64.0.0'])

// An absolute path into a home directory, macOS's or Linux's: a path the
// tree has no use for, and one that names whoever wrote it.
const HOME_PATH = /(?:^|[^\w.~-])(\/(?:Users|home)\/[^\s'"`)\]]*)/g

// The private app the conductor came from. Only the CHANGELOG, which is
// history, may name it. Spelled so this file doesn't.
const CONSUMER = new RegExp(['home', 'free'].join(''), 'i')
const MAY_NAME_CONSUMER = new Set(['CHANGELOG.md'])

// Every problem in one file's text, as `file:line: what`.
function findLeaks(file, text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    const at = what => out.push(`${file}:${i + 1}: ${what}`)
    for (const [name, device, tailnet] of line.matchAll(TS_NET)) {
      if (looksLikeTailnet(tailnet) ? tailnet.toLowerCase() !== TAILNET : device && !PLACEHOLDER_TAILNETS.has(tailnet.toLowerCase())) {
        at(`the tailnet in ${name} (use ${TAILNET}.ts.net)`)
      }
    }
    for (const [id] of line.matchAll(TAILNET_ID)) {
      if (id.toLowerCase() !== TAILNET) at(`the tailnet id ${id} (use ${TAILNET})`)
    }
    for (const [address, second] of line.matchAll(CGNAT)) {
      if (Number(second) >= 64 && Number(second) <= 127 && !ALLOWED_ADDRESSES.has(address)) at(`the tailnet address ${address} (use ${TAILNET_ADDRESS})`)
    }
    for (const [, home] of line.matchAll(HOME_PATH)) at(`the home directory path ${home}`)
    if (!MAY_NAME_CONSUMER.has(file) && CONSUMER.test(line)) at('the private app the conductor came from')
  })
  return out
}

test('the hygiene check catches real tailnets, tailnet addresses, home paths and the private app\'s name', () => {
  // Each leak is written with a | inside it, which comes out before the
  // check, so this file names none of them.
  const leaks = {
    'a device on a tailnet': 'https://mallory.tail|9f3e01.ts.net/',
    'a tailnet': 'tail|beef.ts.net',
    'a fun-name tailnet': 'box.cat-|crocodile.ts.net',
    'a device on another tailnet': 'h.ac|me.ts.net:8443',
    'a tailnet id on its own': 'the tailnet tail|beef1',
    'a short tailnet id': 'http://h.tail|1.ts.net:3100',
    'a tailnet address': "'100.|99.1.2'",
    'the top of 100.64.0.0/10': '100.|127.255.254',
    'another address in it': '100.64.0.1|0',
    'a macOS home': 'cd /Us|ers/someone/src',
    'a Linux home': "HOME: '/ho|me/me'",
    'a home in a file URL': 'file:///ho|me/qa/x',
    'the private app\'s name': 'Home|Free adapters',
  }
  for (const [what, written] of Object.entries(leaks)) {
    const line = written.replace('|', '')
    assert.notDeepEqual(findLeaks('x.mjs', line), [], `${what} (${line}) is caught`)
  }
  const fine = [
    'https://qa-box.tail1234.ts.net:8444', 'Harness.TAIL1234.ts.net', 'h.ts.net', 'Box.ts.net', 'pane.example.ts.net',
    '<machine>.<tailnet>.ts.net', `${TAILNET_ADDRESS}`, '100.64.0.0/10', '100.63.255.255', '100.128.0.1', '10.0.0.1', '1.100.64.5',
    'https://example.com/home/page', '~/home/x', '/fake-home/me/.ssh', '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    'tailscale serve', 'detailed', 'a home, free of charge',
  ]
  for (const line of fine) assert.deepEqual(findLeaks('x.mjs', line), [], `${line} passes`)
  assert.deepEqual(findLeaks('CHANGELOG.md', 'ported from Home|Free'.replace('|', '')), [], 'the CHANGELOG may name the private app')
})

test('no tracked file names a real tailnet, a tailnet address, a home path or the private app', async () => {
  const { stdout } = await execFileP('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 })
  const files = stdout.split('\0').filter(Boolean)
  assert.ok(files.includes('package.json'), 'git ls-files lists this tree')
  const leaks = files.flatMap(file => findLeaks(file, readFileSync(path.join(ROOT, file), 'utf8')))
  assert.deepEqual(leaks, [], `\n${leaks.join('\n')}`)
})
