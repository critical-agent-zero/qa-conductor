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
const CHANGELOG = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')

// The CHANGELOG's second-level headings: `## [Unreleased]` while changes
// wait for a release, then one dated `## [X.Y.Z] — YYYY-MM-DD` per release,
// newest first. Each bracketed name is a link, defined at the end of the
// file (Keep a Changelog's layout).
const changelogHeadings = () => [...CHANGELOG.matchAll(/^## (.*)$/gm)].map(match => match[1])
const RELEASE_HEADING = /^\[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2}$/
const UNRELEASED = '[Unreleased]'
const REPO_URL = 'https://github.com/critical-labs/qa-conductor'
const releases = () => changelogHeadings().map(heading => RELEASE_HEADING.exec(heading)?.[1]).filter(Boolean)

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

// The scripts `npm stage publish` would run, as `npm publish` does, with the
// token in their env.
const PUBLISH_SCRIPTS = ['prepublish', 'prepublishOnly', 'prepack', 'prepare', 'postpack', 'publish', 'postpublish']

// The workflow's lines without blank lines and full-line comments, so prose
// that names a command can't satisfy, or trip, a check meant for the commands.
// Trailing ` #` comments stay: inside a `run: |` block or quotes a `#` is not
// a YAML comment, so stripping one could hide a command, and a check that
// trips on a real comment fails safe.
const contentLines = text =>
  text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line && !/^\s*#/.test(line))

// The lines under each top-level key, which must each appear once.
function topLevel(lines) {
  const blocks = new Map()
  let key
  for (const line of lines) {
    if (/^\S/.test(line)) {
      key = /^([\w-]+):/.exec(line)?.[1]
      assert.ok(key && !blocks.has(key), `top-level line "${line}" is a key that appears once`)
      blocks.set(key, [line])
    } else {
      assert.ok(key, `"${line}" is under a top-level key`)
      blocks.get(key).push(line)
    }
  }
  return blocks
}

// The job's steps, each as { key: [its value, ...the lines under it] }.
function jobSteps(lines) {
  const steps = []
  let key
  for (const line of lines) {
    const item = /^ {6}- (.*)$/.exec(line)
    const text = item ? item[1] : /^ {8}/.test(line) ? line.slice(8) : undefined
    assert.ok(text !== undefined && (item || steps.length), `"${line.trim()}" belongs to a step`)
    if (item) steps.push({})
    const field = /^([\w-]+):(?: (.*))?$/.exec(text)
    if (field) {
      key = field[1]
      assert.ok(!(key in steps.at(-1)), `a step sets ${key} once`)
      steps.at(-1)[key] = [field[2] ?? '']
    } else {
      assert.ok(!item, `step "${line.trim()}" starts with a key`)
      steps.at(-1)[key].push(text.trim())
    }
  }
  return steps
}

// Throws unless the workflow text runs on v* tags only, gates the stage on
// the tag check, the tests and the pack, and gives the token to the stage
// step alone. It reads the file as text, so it catches mistakes, not every
// way a shell could spell a command: the stage-only token is what refuses a
// plain publish.
function assertStagesOnly(text) {
  const lines = contentLines(text)
  const blocks = topLevel(lines)
  assert.deepEqual([...blocks.keys()], ['name', 'on', 'permissions', 'jobs'], 'no workflow-level env, defaults or other key')
  assert.deepEqual(blocks.get('on'), ['on:', '  push:', '    tags: ["v*"]'], 'runs on pushed v* tags only')
  assert.deepEqual(blocks.get('permissions'), ['permissions:', '  contents: read', '  id-token: write'], 'contents: read, id-token: write (provenance)')

  const job = blocks.get('jobs')
  const at = job.indexOf('    steps:')
  assert.deepEqual(
    job.slice(0, at + 1).map(line => line.replace(/: .*$/, ':')),
    ['jobs:', '  publish:', '    runs-on:', '    timeout-minutes:', '    steps:'],
    'one job, with no env, if, defaults, container or environment',
  )
  assert.match(job[3], /^ {4}timeout-minutes: \d+$/)

  const steps = jobSteps(job.slice(at + 1))
  // Any other key could skip a gate or let it fail (if, continue-on-error),
  // or run a step's command some other way (shell, working-directory).
  assert.deepEqual(
    steps.map(step => Object.keys(step).join(' ')),
    ['uses with', 'uses with', 'run', 'name run', 'run', 'run', 'name run env'],
    'checkout, setup-node, the npm upgrade, the tag check, npm test, npm pack --dry-run, then the stage, and nothing else',
  )
  const [checkout, node, upgrade, tagCheck, tests, pack, stage] = steps
  for (const step of [checkout, node]) {
    assert.match(step.uses[0], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}( # \S+)?$/, `${step.uses[0]} is pinned to a commit SHA`)
  }
  assert.match(checkout.uses[0], /^actions\/checkout@/)
  assert.deepEqual(checkout.with, ['', 'persist-credentials: false'])
  assert.match(node.uses[0], /^actions\/setup-node@/)
  assert.deepEqual(node.with, ['', 'node-version: 22', 'registry-url: https://registry.npmjs.org', 'package-manager-cache: false'], 'no cache a release could restore')
  assert.deepEqual(upgrade.run, ['npm install -g npm@^11.15.0'], 'staged publishing needs npm 11.15')
  assert.deepEqual(tagCheck.name, [TAG_CHECK])
  assert.equal(tagCheck.run[0], '|')
  assert.deepEqual(tests.run, ['npm test'], 'a failing test fails the job')
  assert.deepEqual(pack.run, ['npm pack --dry-run'])
  assert.deepEqual(stage.run, ['npm stage publish --access public'])
  assert.deepEqual(stage.env, ['', 'NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}', 'NPM_CONFIG_PROVENANCE: "true"'], 'the stage step gets the token')

  // Across every line, block scripts included. npm expands any unambiguous
  // abbreviation (`npm pub`, `npm pu`), so every npm or npx line must be one
  // of the four above, not just free of the word publish.
  assert.deepEqual(
    lines.filter(line => /\bnp[mx]\b/.test(line)).map(line => line.trim()),
    ['- run: npm install -g npm@^11.15.0', '- run: npm test', '- run: npm pack --dry-run', 'run: npm stage publish --access public'],
    'every npm or npx command is one of the four the workflow needs',
  )
  // No third-party publish action or other publisher (pnpm, yarn): apart from
  // names, the stage command is the only line that says pub.
  assert.deepEqual(
    lines.filter(line => /pub/i.test(line) && !/^\s*(-\s+)?name:|^ {2}publish:$/.test(line)).map(line => line.trim()),
    ['run: npm stage publish --access public'],
    'the stage command is the only publish',
  )
  assert.deepEqual(
    lines.filter(line => line.includes('${{')).map(line => line.trim()),
    ['NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}'],
    'the token is the only expression, so it reaches the stage step alone',
  )
  assert.doesNotMatch(lines.join('\n'), /^\s*(-\s+)?(if|continue-on-error):/m, 'no gate can be skipped or allowed to fail')
}

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

// npm fills in homepage and bugs from repository, but only on the registry:
// spelled out, they match agent-identity's and show in the tarball too.
test('the npm page names its author, links back to the repository, and has a description that fits a search result', () => {
  assert.equal(pkg.author, 'Critical Labs')
  assert.equal(pkg.homepage, 'https://github.com/critical-labs/qa-conductor#readme')
  assert.deepEqual(pkg.bugs, { url: 'https://github.com/critical-labs/qa-conductor/issues' })
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length > 0, 'keywords')
  for (const keyword of pkg.keywords) assert.match(keyword, /^[a-z0-9-]+$/, `keyword ${keyword}`)
  assert.ok(pkg.description.length <= 130, `the description is ${pkg.description.length} characters, more than a search result shows`)
})

test('a release names one version: package.json, the CHANGELOG\'s newest release and the README\'s git-tag pin', () => {
  // A tag stages package.json's version, so the notes and the install line
  // a consumer reads must be that version's.
  const headings = changelogHeadings()
  headings.forEach((heading, i) => {
    assert.ok(RELEASE_HEADING.test(heading) || (heading === UNRELEASED && i === 0), `CHANGELOG heading "## ${heading}" is a dated version (or ${UNRELEASED}, first)`)
  })
  const versions = releases()
  for (let i = 1; i < versions.length; i++) {
    // numeric collation compares 0.10.0 and 0.9.0 field by field
    assert.ok(versions[i - 1].localeCompare(versions[i], 'en', { numeric: true }) > 0, `${versions[i - 1]} is newer than ${versions[i]}`)
  }
  assert.equal(versions[0], pkg.version, 'the newest CHANGELOG release is the package.json version')
  const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  // to the end of the code span it sits in, if any
  const pins = [...README.matchAll(/github:critical-labs\/qa-conductor#([^\s`'")]+)/g)].map(match => match[1])
  assert.ok(pins.length > 0, 'the README shows a git-tag pin')
  for (const pin of pins) assert.equal(pin, `v${pkg.version}`, 'the README\'s git-tag pin is this version\'s tag')
})

// Each heading's link shows what changed in it: Unreleased since the newest
// tag, each release since the one before, and the first release its tag.
test('every CHANGELOG heading links to its changes, and the CHANGELOG defines no other link', () => {
  const versions = releases()
  assert.ok(versions.length > 0, 'the CHANGELOG has a release')
  const want = new Map()
  if (changelogHeadings()[0] === UNRELEASED) want.set('Unreleased', `${REPO_URL}/compare/v${versions[0]}...HEAD`)
  versions.forEach((version, i) => {
    const previous = versions[i + 1]
    want.set(version, previous ? `${REPO_URL}/compare/v${previous}...v${version}` : `${REPO_URL}/releases/tag/v${version}`)
  })
  const defined = [...CHANGELOG.matchAll(/^\[([^\]]+)\]: *(\S+)$/gm)].map(match => [match[1], match[2]])
  assert.deepEqual(defined, [...want], 'one link per heading, newest first, at the end of the file')
  assert.match(CHANGELOG, /\n\n(\[[^\]]+\]: \S+\n)+$/, 'the links end the file')
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

test('the bin is the expose CLI, run by node from npx and by npm run expose', () => {
  // No leading ./: npm pkg fix strips it, and a publish would warn that it
  // auto-corrected package.json.
  assert.deepEqual(pkg.bin, { 'qa-conductor-expose': 'bin/qa-conductor-expose.mjs' })
  // npm links a bin as is: without the #! line, npx would hand it to the shell
  for (const target of Object.values(pkg.bin)) {
    assert.match(readFileSync(path.join(ROOT, target), 'utf8'), /^#!\/usr\/bin\/env node\n/, `${target} starts with #!/usr/bin/env node`)
  }
  // In this repo it is self-QA's, the repo's only conductor: self-QA's .env.qa
  // leaves QA_REPO to its loader, so the core loadConfig would refuse it. A
  // later --config wins (test/expose-cli.test.mjs).
  assert.equal(pkg.scripts.expose, 'node bin/qa-conductor-expose.mjs --config qa/self.mjs#loadSelfQaConfig')
})

test('npm pack --dry-run packs lib/, public/ and bin/, and no test/, demo/, qa/, docs/ or .github files', { timeout: 90_000 }, async () => {
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
  assert.ok(packed.some(file => file.startsWith('bin/')), 'bin/ is packed')
  for (const file of ['package.json', 'public/index.html', 'public/harness.js', 'public/bridge.js', 'bin/qa-conductor-expose.mjs', ...shipped()]) {
    assert.ok(packed.includes(file), `${file} is packed`)
  }
  for (const file of packed) {
    assert.doesNotMatch(file, /^(test|demo|qa|docs|\.github)\//, `${file} must not be published`)
    assert.doesNotMatch(file, /(^|\/)(\.env|\.npmrc)/, `${file} must not be published`)
    assert.ok(inFiles(file), `${file} is outside files ${JSON.stringify(pkg.files)}`)
  }
})

test('nothing in the package runs with the publish token, or sends it elsewhere', () => {
  for (const script of PUBLISH_SCRIPTS) assert.equal(pkg.scripts?.[script], undefined, `package.json has no ${script} script`)
  // A registry here, or a project .npmrc, outranks setup-node's npmjs.org.
  assert.deepEqual(pkg.publishConfig, { access: 'public', provenance: true }, 'publishConfig sets no registry')
  assert.ok(!existsSync(path.join(ROOT, '.npmrc')), 'no project .npmrc')
})

test('the publish workflow stages the tag\'s version and never publishes directly', () => {
  assert.ok(existsSync(WORKFLOW), '.github/workflows/publish.yml exists')
  assertStagesOnly(readFileSync(WORKFLOW, 'utf8'))
})

test('the workflow check refuses a publish, a skippable gate or a token that leaks out of the stage step', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const TESTS = '      - run: npm test\n'
  const STAGE = '        run: npm stage publish --access public\n'
  const TOKEN = '          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n'
  const PIN = 'a'.repeat(40)
  // Each mutation edits the real workflow at an anchor that must be there.
  const replace = (from, to) => text => {
    assert.ok(text.includes(from), `the workflow has ${JSON.stringify(from)}`)
    return text.replace(from, to)
  }
  const after = (anchor, ...lines) => replace(anchor, `${anchor}${lines.map(line => `${line}\n`).join('')}`)
  const mutations = {
    'npm pub, which npm expands to publish': after(TESTS, '      - run: npm pub --access public', '        env:', TOKEN.trimEnd()),
    'npm pu': after(TESTS, '      - run: npm pu --access public'),
    'npx publish': after(TESTS, '      - run: npx --yes npm@11 publish'),
    'a quoted # before npm publish in a run: | block': after(TESTS, '      - run: |', '          echo "x #" && npm publish --access public'),
    'npm pub in the tag check\'s script': after('          fi\n', '          npm pub --access public'),
    'pnpm publish': after(TESTS, '      - run: pnpm publish --no-git-checks'),
    'a third-party publish action': after(TESTS, `      - uses: JS-DevTools/npm-publish@${PIN}`),
    'if: false on the tag check': after(`      - name: ${TAG_CHECK}\n`, '        if: false'),
    'continue-on-error on the tag check': after(`      - name: ${TAG_CHECK}\n`, '        continue-on-error: true'),
    'continue-on-error on the tests': after(TESTS, '        continue-on-error: true'),
    'npm test || true': replace(TESTS, '      - run: npm test || true\n'),
    'a shell that runs something else': after(STAGE, '        shell: bash -c "npm publish" {0}'),
    'the tests after the stage': text => replace(TESTS, '')(text) + TESTS,
    'another trigger': after('    tags: ["v*"]\n', '  workflow_dispatch:'),
    'branch pushes': after('    tags: ["v*"]\n', '    branches: ["**"]'),
    'pull requests': after('\non:\n', '  pull_request:'),
    'contents: write': replace('  contents: read\n', '  contents: write\n'),
    'the token at workflow level': replace('\npermissions:\n', `\nenv:\n  ${TOKEN.trim()}\n\npermissions:\n`),
    'the token at job level': after('    timeout-minutes: 15\n', '    env:', `      ${TOKEN.trim()}`),
    'the token on the tests too': after(TESTS, '        env:', TOKEN.trimEnd()),
    'the token in the tag check\'s script': after('          fi\n', '          echo "${{ secrets.NPM_TOKEN }}"'),
    'an action by tag, not SHA': replace('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v7'),
  }
  for (const [what, mutate] of Object.entries(mutations)) {
    // Mutated outside assert.throws, so a missing anchor fails the test.
    const mutated = mutate(yaml)
    assert.notEqual(mutated, yaml, what)
    assert.throws(() => assertStagesOnly(mutated), assert.AssertionError, `${what} passes the check`)
  }
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
  // The release before this one: its tag, pushed again, must not stage this.
  const previous = releases().find(version => version !== pkg.version)
  assert.ok(previous, 'the CHANGELOG has an earlier release')
  for (const tag of [`v${previous}`, 'v9.9.9', pkg.version, `v${pkg.version}-rc.1`, `v${pkg.version}.1`, `xv${pkg.version}`, '']) {
    await assert.rejects(run(tag), err => err.code === 1 && /does not match/.test(err.stdout + err.stderr), `tag "${tag}" is refused`)
  }
})
