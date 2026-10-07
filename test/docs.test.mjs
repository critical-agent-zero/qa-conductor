// The README is the published package's reference: an npm consumer reads it,
// not the source. So every entry point package.json exports, the bin, and
// every env file key the published code reads must be in it, and the names
// it says an entry point exports must be exactly the ones it does: a name it
// leaves out would read as internal, and a later release could drop it. What
// a consumer copies from it must work: its examples' imports, its sample
// .env.qa files and its links.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from '../lib/config.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8')

// The lines of the README section under this heading, up to the next heading
// of the same or a higher level. A # line in a code block, such as a
// comment in a sample .env.qa, is no heading.
function section(heading) {
  const lines = README.split('\n')
  const at = lines.indexOf(heading)
  assert.ok(at >= 0, `the README has a "${heading}" heading`)
  const level = heading.indexOf(' ')
  let fenced = false
  const end = lines.findIndex((line, i) => {
    if (/^ *```/.test(line)) fenced = !fenced
    return i > at && !fenced && /^#+ /.test(line) && line.indexOf(' ') <= level
  })
  return lines.slice(at + 1, end === -1 ? undefined : end)
}

// A table row's cells, without the outer pipes.
const cells = row => row.replace(/^\|/, '').replace(/\|$/, '').split(' | ').map(cell => cell.trim())
const codeSpans = text => [...text.matchAll(/`([^`]+)`/g)].map(match => match[1])

// Every file the package publishes from a files entry, recursively.
function published(dir = '') {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(dir, entry.name)
    return entry.isDirectory() ? published(rel) : [rel]
  })
}

test('the README\'s entry points are exactly package.json\'s exports and bin, and each row lists exactly the names its entry point exports', async () => {
  const lines = section('### Entry points')
  const rows = lines.filter(line => line.startsWith(`| \`${pkg.name}`))
  const documented = new Map(rows.map(row => {
    const [entry, names] = cells(row)
    return [`.${codeSpans(entry)[0].slice(pkg.name.length)}`, codeSpans(names)]
  }))
  assert.deepEqual([...documented.keys()].sort(), Object.keys(pkg.exports).sort(), 'one row per export, and no other')
  for (const [subpath, names] of documented) {
    if (subpath === './package.json') continue
    // By the package's own name, so the exports map is what resolves it.
    const mod = await import(`${pkg.name}${subpath.slice(1)}`)
    assert.deepEqual([...names].sort(), Object.keys(mod).sort(), `the ${subpath} row lists every name it exports, and no other`)
  }
  for (const bin of Object.keys(pkg.bin)) {
    assert.ok(lines.some(line => line.includes(`\`${bin}\``)), `the bin ${bin} is listed with the entry points`)
  }
})

test('every env file key the published code reads has a Configuration row', () => {
  const rows = section('## Configuration').filter(line => line.startsWith('| `'))
  const documented = new Set(rows.flatMap(row => codeSpans(cells(row)[0])))
  const read = new Set()
  for (const dir of pkg.files) {
    for (const file of published(dir)) {
      for (const [key] of readFileSync(path.join(ROOT, file), 'utf8').matchAll(/\b(?:QA_[A-Z0-9_]+|GITHUB_QA_TOKEN)\b/g)) read.add(key)
    }
  }
  // QA_ENV_FILE is the process environment's, and names the env file itself.
  read.delete('QA_ENV_FILE')
  for (const key of ['QA_HARNESS_ORIGIN', 'QA_EXPOSURE', 'QA_TAILSCALE_BIN']) assert.ok(read.has(key), `the scan finds ${key}`)
  for (const key of [...read].sort()) assert.ok(documented.has(key), `${key} has a row in the Configuration table`)
})

// Fenced code blocks of this language in a markdown text, list items' too,
// without their indent.
const codeBlocks = (text, lang) =>
  [...text.matchAll(new RegExp(`^( *)\`\`\`${lang}\\n([\\s\\S]*?)^\\1\`\`\`$`, 'gm'))]
    .map(([, indent, body]) => body.split('\n').map(line => line.slice(indent.length)).join('\n'))

test('every import in the README\'s examples names something its entry point exports', async () => {
  let checked = 0
  for (const block of codeBlocks(README, 'js')) {
    for (const [, names, specifier] of block.matchAll(/^import \{([^}]+)\} from '(@critical-labs\/qa-conductor[^']*)'/gm)) {
      const mod = await import(specifier)
      for (const name of names.split(',').map(entry => entry.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        assert.ok(Object.hasOwn(mod, name), `${specifier} exports ${name}`)
        checked++
      }
    }
  }
  assert.ok(checked >= 10, `checked ${checked} imported names`)
})

// A consumer starts from these: each must load, the local one with no
// identity gate and the tailnet one behind it.
test('the README\'s sample .env.qa files load: the local one ungated, the tailnet one gated', () => {
  const samples = codeBlocks(section('### Sample `.env.qa` files').join('\n'), 'ini')
  assert.equal(samples.length, 2, 'a local sample and a tailnet sample')
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-readme-'))
  const [local, tailnet] = samples.map((text, i) => {
    const file = path.join(dir, `.env.qa-${i}`)
    writeFileSync(file, text)
    return loadConfig(file)
  })
  assert.equal(local.exposure, 'none')
  assert.equal(local.host, '127.0.0.1')
  assert.equal(local.harnessOrigin, 'http://127.0.0.1:3100')
  assert.deepEqual(local.paneOrigins, { base: 'http://127.0.0.1:3101', pr: 'http://127.0.0.1:3102' })
  assert.equal(tailnet.exposure, 'tailscale')
  assert.equal(tailnet.host, '127.0.0.1')
  assert.equal(tailnet.harnessOrigin, 'https://qa-box.tail1234.ts.net:8444')
  assert.deepEqual(tailnet.paneOrigins, { base: 'https://qa-box.tail1234.ts.net:8443', pr: 'https://qa-box.tail1234.ts.net:10000' })
  assert.ok(tailnet.allowedLogins.length > 0, 'the tailnet sample lets someone in')
})
