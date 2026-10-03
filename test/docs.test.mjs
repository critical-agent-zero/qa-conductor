// The README is the published package's reference: an npm consumer reads it,
// not the source. So every entry point package.json exports, the bin, and
// every env file key the published code reads must be in it, and the names
// it says an entry point exports must be exactly the ones it does: a name it
// leaves out would read as internal, and a later release could drop it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8')

// The lines of the README section under this heading, up to the next heading
// of the same or a higher level.
function section(heading) {
  const lines = README.split('\n')
  const at = lines.indexOf(heading)
  assert.ok(at >= 0, `the README has a "${heading}" heading`)
  const level = heading.indexOf(' ')
  const end = lines.findIndex((line, i) => i > at && /^#+ /.test(line) && line.indexOf(' ') <= level)
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
