// The npm package and its publish workflow. A tag stages whatever these
// files say, and a maintainer approves it on npmjs.com, so the things that
// would make a release wrong are pinned here: what the tarball carries, that
// every export is in it, and that the workflow stages only the tag's version
// and never publishes directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const WORKFLOW = path.join(ROOT, '.github/workflows/publish.yml')
const TAG_CHECK = 'Check the tag matches package.json'

// npm packs these whatever `files` says.
const ALWAYS_PACKED = /^(package\.json|README(\.[^/]*)?|LICEN[CS]E(\.[^/]*)?|CHANGELOG(\.[^/]*)?)$/i

const rel = target => target.replace(/^\.\//, '')
const targetsOf = value =>
  typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(targetsOf) : []
const shipped = () => [
  ...targetsOf(pkg.exports),
  ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})),
  ...(pkg.main ? [pkg.main] : []),
].map(rel)
const inFiles = file =>
  ALWAYS_PACKED.test(file) ||
  pkg.files.some(entry => {
    const dir = rel(entry).replace(/\/$/, '')
    return file === dir || file.startsWith(`${dir}/`)
  })

// The workflow with YAML and shell comments removed, so prose that names a
// command can't satisfy, or trip, a check meant for the commands themselves.
const workflowCommands = () =>
  readFileSync(WORKFLOW, 'utf8').split('\n').map(line => line.replace(/(^|\s)#.*$/, '').trimEnd()).join('\n')

// The `run: |` block of the step with this name, dedented.
function stepScript(yaml, name) {
  const lines = yaml.split('\n')
  const at = lines.findIndex(line => line.trim() === `- name: ${name}`)
  assert.ok(at >= 0, `the publish workflow has no step named "${name}"`)
  const stepIndent = lines[at].indexOf('-')
  for (let i = at + 1; i < lines.length; i++) {
    const indent = lines[i].search(/\S/)
    if (indent !== -1 && indent <= stepIndent) break
    const run = /^(\s*)run: \|\s*$/.exec(lines[i])
    if (!run) continue
    const block = []
    for (const line of lines.slice(i + 1)) {
      const ind = line.search(/\S/)
      if (ind !== -1 && ind <= run[1].length) break
      block.push(line)
    }
    const strip = Math.min(...block.filter(line => line.trim()).map(line => line.search(/\S/)))
    return block.map(line => line.slice(strip)).join('\n')
  }
  assert.fail(`step "${name}" has no run: | block`)
}

test('the package is publishable: not private, public access, provenance from this repository', () => {
  assert.equal(pkg.name, '@critical-labs/qa-conductor')
  assert.notEqual(pkg.private, true, 'npm refuses to publish a private package')
  assert.equal(pkg.publishConfig?.access, 'public', 'a scoped package is restricted unless published public')
  assert.equal(pkg.publishConfig?.provenance, true)
  // npm checks the provenance statement's repository against this field.
  assert.match(pkg.repository?.url ?? '', /github\.com\/critical-labs\/qa-conductor(\.git)?$/)
})

test('every exports and bin target exists and is inside a files entry', () => {
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, 'without files, npm packs the whole repo')
  for (const entry of pkg.files) assert.doesNotMatch(entry, /[*?[{!]/, `files entry ${entry}: this test reads entries literally`)
  const targets = shipped()
  assert.ok(targets.includes('lib/server.mjs'), 'the main export')
  for (const target of targets) {
    assert.ok(existsSync(path.join(ROOT, target)) && statSync(path.join(ROOT, target)).isFile(), `${target} exists`)
    assert.ok(inFiles(target), `${target} is inside one of files ${JSON.stringify(pkg.files)}`)
  }
})

test('npm pack --dry-run packs lib/ and public/, and no test/, demo/, qa/, docs/ or .github files', { timeout: 90_000 }, async () => {
  const { stdout } = await execFileP('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  const [result] = JSON.parse(stdout)
  assert.equal(result.name, pkg.name)
  assert.equal(result.version, pkg.version)
  const packed = result.files.map(file => file.path)
  assert.ok(packed.some(file => file.startsWith('lib/')), 'lib/ is packed')
  assert.ok(packed.some(file => file.startsWith('public/')), 'public/ is packed')
  for (const file of ['package.json', 'public/index.html', 'public/harness.js', 'public/bridge.js', ...shipped()]) {
    assert.ok(packed.includes(file), `${file} is packed`)
  }
  for (const file of packed) {
    assert.doesNotMatch(file, /^(test|demo|qa|docs|\.github)\//, `${file} must not be published`)
    assert.doesNotMatch(file, /(^|\/)(\.env|\.npmrc)/, `${file} must not be published`)
    assert.ok(inFiles(file), `${file} is outside files ${JSON.stringify(pkg.files)}`)
  }
})

test('the publish workflow stages the tag\'s version and never publishes directly', () => {
  assert.ok(existsSync(WORKFLOW), '.github/workflows/publish.yml exists')
  const yaml = workflowCommands()

  assert.match(yaml, /^on:\s*\n\s+push:\s*\n\s+tags:\s*\[\s*["']v\*["']\s*\]\s*$/m, 'runs on pushed v* tags')
  assert.doesNotMatch(yaml, /^\s*(pull_request|pull_request_target|workflow_run)\b/m, 'never runs for pull requests')
  assert.match(yaml, /^permissions:\s*\n\s+contents: read\s*\n\s+id-token: write\s*$/m, 'contents: read, id-token: write (provenance)')
  assert.doesNotMatch(yaml, /write-all|contents: write/)
  assert.match(yaml, /timeout-minutes: \d+/)
  const uses = yaml.match(/uses:.*$/gm) ?? []
  assert.ok(uses.length > 0, 'checks out and sets up node')
  for (const use of uses) {
    assert.match(use, /^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${use} is pinned to a commit SHA`)
  }
  assert.match(yaml, /node-version: 22$/m)
  assert.match(yaml, /registry-url: https:\/\/registry\.npmjs\.org$/m)
  assert.match(yaml, /run: npm install -g npm@\^11\.15\.0$/m, 'staged publishing needs npm 11.15')

  assert.match(yaml, /run: npm stage publish --access public$/m)
  assert.match(yaml, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}$/m)
  assert.match(yaml, /NPM_CONFIG_PROVENANCE: "true"$/m)
  // The only line that says publish, apart from names, is the stage command:
  // no bare `npm publish` in any spelling, and no third-party publish action.
  // The token is stage-only, and a maintainer approves each version.
  const publishLines = yaml.split('\n').filter(line => /\bpublish\b/i.test(line) && !/^\s*(-\s+)?name:|^\s*publish:$/.test(line))
  assert.deepEqual(publishLines.map(line => line.trim()), ['run: npm stage publish --access public'])

  const order = [`- name: ${TAG_CHECK}`, 'run: npm test', 'run: npm pack --dry-run', 'run: npm stage publish'].map(s => yaml.indexOf(s))
  assert.ok(order.every(i => i >= 0), `steps present: ${order}`)
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'tag check, then tests, then pack, then stage')
})

test('the workflow\'s tag check passes only for v<package.json version>', { timeout: 30_000 }, async () => {
  const script = stepScript(readFileSync(WORKFLOW, 'utf8'), TAG_CHECK)
  // The tag reaches the script as the runner's env, never as a ${{ }}
  // expression spliced into shell source.
  assert.doesNotMatch(script, /\$\{\{/)
  const run = tag =>
    execFileP('bash', ['-c', script], {
      cwd: ROOT,
      timeout: 10_000,
      env: { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, GITHUB_REF_NAME: tag },
    })
  await run(`v${pkg.version}`)
  for (const tag of ['v9.9.9', pkg.version, `v${pkg.version}-rc.1`, `v${pkg.version}.1`, `xv${pkg.version}`, '']) {
    await assert.rejects(run(tag), err => err.code === 1 && /does not match/.test(err.stdout + err.stderr), `tag "${tag}" is refused`)
  }
})
