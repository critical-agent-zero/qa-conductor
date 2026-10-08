// The npm package and its publish workflow. A tag stages whatever these
// files say, and a maintainer approves it on npmjs.com, so the things that
// would make a release wrong are pinned here: what the tarball carries, that
// every export is in it, and that the workflow stages only the tag's version
// and never publishes directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

// The jobs under `jobs:`, in order, each as { header, steps }: the header maps
// each job key to [its value, ...the lines under it], and steps are
// jobSteps's.
function jobsOf(block) {
  const bodies = new Map()
  let body
  for (const line of block.slice(1)) {
    const name = /^ {2}([\w-]+):$/.exec(line)?.[1]
    if (name) {
      assert.ok(!bodies.has(name), `job ${name} appears once`)
      bodies.set(name, (body = []))
    } else {
      assert.ok(body && /^ {4}/.test(line), `"${line.trim()}" belongs to a job`)
      body.push(line)
    }
  }
  return new Map([...bodies].map(([name, lines]) => {
    const at = lines.indexOf('    steps:')
    assert.ok(at >= 0, `job ${name} has steps`)
    const header = {}
    let key
    for (const line of lines.slice(0, at)) {
      const field = /^ {4}([\w-]+):(?: (.*))?$/.exec(line)
      if (field) {
        key = field[1]
        assert.ok(!(key in header), `job ${name} sets ${key} once`)
        header[key] = [field[2] ?? '']
      } else {
        assert.ok(key && /^ {6}\S/.test(line), `"${line.trim()}" is under a key of job ${name}`)
        header[key].push(line.trim())
      }
    }
    return [name, { header, steps: jobSteps(lines.slice(at + 1)) }]
  }))
}

// npm pack names the tarball <scope>-<name>-<version>.tgz.
const TARBALL = pkg.name.replace(/^@/, '').replace('/', '-')
const ON_MAIN = 'Check the tagged commit is on main'
const TARBALL_CHECK = 'Check the tarball is the tag\'s version'
// `./` makes it a file: npm reads release/x.tgz as the GitHub repo release/x.tgz.
const STAGE_RUN = `npm stage publish "./release/${TARBALL}-\${GITHUB_REF_NAME#v}.tgz" --access public`
// The publish job's two scripts, whole: it runs git, ls and npm stage, and no
// code from the repository.
const ON_MAIN_SCRIPT = [
  'git init --quiet "$RUNNER_TEMP/main-history"',
  'cd "$RUNNER_TEMP/main-history"',
  'git fetch --quiet --no-tags "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git" +refs/heads/main:refs/remotes/origin/main',
  'if ! git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main; then',
  '  echo "::error::$GITHUB_REF_NAME ($GITHUB_SHA) is not on main: tag a commit main has merged"',
  '  exit 1',
  'fi',
].join('\n')
const TARBALL_CHECK_SCRIPT = [
  `want="${TARBALL}-\${GITHUB_REF_NAME#v}.tgz"`,
  'have="$(ls -A release)"',
  'if [ "$have" != "$want" ]; then',
  '  echo "::error::the test job\'s tarball is $have, not $want"',
  '  exit 1',
  'fi',
].join('\n')
const SHA_PINNED = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}( # \S+)?$/

// Throws unless the workflow runs on v* tags only, in two jobs:
// - test: no secrets and no id-token; it checks the tag, runs the tests and
//   packs the tarball;
// - publish: after test, behind the npm-release environment; it checks that
//   the tagged commit is on main, then stages test's tarball, the token in
//   the stage step alone, and runs no code from the repository.
// It reads the file as text, so it catches mistakes, not every way a shell
// could spell a command: the stage-only token is what refuses a plain publish.
function assertStagesOnly(text) {
  const lines = contentLines(text)
  const blocks = topLevel(lines)
  assert.deepEqual([...blocks.keys()], ['name', 'on', 'permissions', 'jobs'], 'no workflow-level env, defaults, concurrency or other key')
  assert.deepEqual(blocks.get('on'), ['on:', '  push:', '    tags: ["v*"]'], 'runs on pushed v* tags only')
  assert.deepEqual(blocks.get('permissions'), ['permissions: {}'], 'no permission at workflow level: each job asks for its own')

  const jobs = jobsOf(blocks.get('jobs'))
  assert.deepEqual([...jobs.keys()], ['test', 'publish'], 'two jobs, test and publish, and no other')
  const test = jobs.get('test')
  const publish = jobs.get('publish')
  // Any other job key could skip a job (if), hand it the token or an id-token
  // (env, secrets, permissions), or run it somewhere else (container,
  // services, defaults).
  assert.deepEqual(Object.keys(test.header), ['runs-on', 'timeout-minutes', 'permissions'], 'the test job has no env, if, environment, needs or other key')
  assert.deepEqual(test.header.permissions, ['', 'contents: read'], 'the test job reads the repository and has no id-token')
  assert.deepEqual(Object.keys(publish.header), ['needs', 'runs-on', 'timeout-minutes', 'environment', 'permissions'], 'the publish job has no env, if or other key')
  assert.deepEqual(publish.header.needs, ['test'], 'publish runs after test passes')
  assert.deepEqual(publish.header.environment, ['npm-release'], 'publish waits for approval of the npm-release environment')
  assert.deepEqual(publish.header.permissions, ['', 'contents: read', 'id-token: write'], 'id-token (provenance) in the publish job alone')
  for (const job of [test, publish]) {
    assert.deepEqual(job.header['runs-on'], ['ubuntu-latest'])
    assert.match(job.header['timeout-minutes'][0], /^\d+$/)
  }

  // Any other step key could skip a gate or let it fail (if,
  // continue-on-error), or run a step's command some other way (shell,
  // working-directory).
  assert.deepEqual(
    test.steps.map(step => Object.keys(step).join(' ')),
    ['uses with', 'uses with', 'name run', 'run', 'run', 'uses with'],
    'test: checkout, setup-node, the tag check, npm test, npm pack, the upload, and nothing else',
  )
  assert.deepEqual(
    publish.steps.map(step => Object.keys(step).join(' ')),
    ['name run', 'uses with', 'run', 'uses with', 'name run', 'name run env'],
    'publish: the on-main check, setup-node, the npm upgrade, the download, the tarball check, then the stage, and nothing else',
  )
  for (const step of [...test.steps, ...publish.steps].filter(step => step.uses)) {
    assert.match(step.uses[0], SHA_PINNED, `${step.uses[0]} is pinned to a commit SHA`)
  }

  const [checkout, testNode, tagCheck, tests, pack, upload] = test.steps
  assert.match(checkout.uses[0], /^actions\/checkout@/)
  assert.deepEqual(checkout.with, ['', 'persist-credentials: false'])
  assert.match(testNode.uses[0], /^actions\/setup-node@/)
  assert.deepEqual(testNode.with, ['', 'node-version: 22', 'package-manager-cache: false'], 'no cache a release could restore, and no registry: the test job never publishes')
  assert.deepEqual(tagCheck.name, [TAG_CHECK])
  assert.equal(tagCheck.run[0], '|')
  assert.deepEqual(tests.run, ['npm test'], 'a failing test fails the job')
  assert.deepEqual(pack.run, ['npm pack'])
  assert.match(upload.uses[0], /^actions\/upload-artifact@/)
  assert.deepEqual(upload.with, ['', 'name: tarball', `path: ${TARBALL}-*.tgz`, 'if-no-files-found: error', 'retention-days: 30'])

  const [onMain, publishNode, upgrade, download, tarballCheck, stage] = publish.steps
  assert.deepEqual(onMain.name, [ON_MAIN])
  assert.equal(onMain.run[0], '|')
  assert.equal(stepScript(text, ON_MAIN), ON_MAIN_SCRIPT, 'the on-main check runs git alone, first')
  assert.match(publishNode.uses[0], /^actions\/setup-node@/)
  assert.deepEqual(publishNode.with, ['', 'node-version: 22', 'registry-url: https://registry.npmjs.org', 'package-manager-cache: false'], 'no cache a release could restore')
  assert.deepEqual(upgrade.run, ['npm install -g npm@^11.15.0'], 'staged publishing needs npm 11.15')
  assert.match(download.uses[0], /^actions\/download-artifact@/)
  assert.deepEqual(download.with, ['', 'name: tarball', 'path: release'])
  assert.deepEqual(tarballCheck.name, [TARBALL_CHECK])
  assert.equal(stepScript(text, TARBALL_CHECK), TARBALL_CHECK_SCRIPT)
  assert.deepEqual(stage.run, [STAGE_RUN])
  assert.deepEqual(stage.env, ['', 'NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}', 'NPM_CONFIG_PROVENANCE: "true"'], 'the stage step gets the token')

  // Across every line, block scripts included. npm expands any unambiguous
  // abbreviation (`npm pub`, `npm pu`), so every npm or npx line must be one
  // of the four the workflow needs, not just free of the word publish. (The
  // environment's name, pinned above, is a name, not a command.)
  assert.deepEqual(
    lines.filter(line => /\bnp[mx]\b/.test(line) && line !== '    environment: npm-release').map(line => line.trim()),
    ['- run: npm test', '- run: npm pack', '- run: npm install -g npm@^11.15.0', `run: ${STAGE_RUN}`],
    'every npm or npx command is one of the four the workflow needs',
  )
  // No third-party publish action or other publisher (pnpm, yarn): apart from
  // names, the stage command is the only line that says pub.
  assert.deepEqual(
    lines.filter(line => /pub/i.test(line) && !/^\s*(-\s+)?name:|^ {2}publish:$/.test(line)).map(line => line.trim()),
    [`run: ${STAGE_RUN}`],
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
  // The name the publish workflow uploads, checks and stages.
  assert.equal(result.filename, `${TARBALL}-${pkg.version}.tgz`)
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

// CONTRIBUTING.md's tarball check (Releasing, step 3): the one sh block in
// that section, dedented. A maintainer runs it on the machine that holds the
// tag-signing key and the npm and GitHub credentials, often from an agent's
// shell, whose stdin is no terminal.
function tarballCheck() {
  const text = readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8')
  const at = text.indexOf('\n## Releasing\n')
  assert.ok(at >= 0, 'CONTRIBUTING.md has a Releasing section')
  const blocks = [...text.slice(at).matchAll(/^( *)```sh\n([\s\S]*?)^\1```$/gm)]
  assert.equal(blocks.length, 1, 'the Releasing section has one sh block, the tarball check')
  const [, indent, body] = blocks[0]
  return body.split('\n').map(line => line.slice(indent.length)).join('\n').trimEnd()
}

// A registry that answers 404 to everything, and records what it was asked.
async function recordingRegistry(t) {
  const asked = []
  const server = http.createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`)
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found"}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return { url: `http://127.0.0.1:${server.address().port}/`, asked }
}

// Runs the tarball check from `dir` with bash, stdin no terminal, and npm's
// registry, cache, config, home and temp dirs all of the test's own.
function runTarballCheck(script, dir, registry, scratch) {
  const home = mkdtempSync(path.join(scratch, 'home-'))
  const env = {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    TMPDIR: home,
    npm_config_registry: registry,
    npm_config_cache: path.join(home, '.npm'),
    npm_config_userconfig: path.join(home, '.npmrc'),
    npm_config_update_notifier: 'false',
  }
  return new Promise(resolve => {
    execFile('bash', ['-c', script], { cwd: dir, env, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? err.signal) : 0, stdout, stderr })
    })
  })
}

// The files npm packs, copied to a directory of their own, with package.json
// edited.
function packageCopy(scratch, name, edit) {
  const dir = path.join(scratch, name)
  for (const entry of [...pkg.files, 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
    cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true })
  }
  const json = structuredClone(pkg)
  edit(json, dir)
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(json, null, 2)}\n`)
  return dir
}

test('the release steps\' tarball check packs into a private directory, stops at the first failure and never runs npx', () => {
  const script = tarballCheck()
  // A fixed path in the shared /tmp is one another local user can plant first.
  assert.doesNotMatch(script, /\/tmp\b/, 'no fixed path in a shared temp dir')
  const dest = /^ *(\w+)="\$\(mktemp -d\)"$/m.exec(script)?.[1]
  assert.ok(dest, 'the pack destination is a fresh mktemp -d directory')
  assert.match(script, new RegExp(`^ *npm pack --pack-destination "\\$${dest}"$`, 'm'))
  assert.doesNotMatch(script, /X\.Y\.Z/, 'no version placeholder to paste unchanged')
  // Without set -e, a failed install goes on to the bin, and a check that
  // failed early can end in a success.
  assert.match(script, /^\(\n *set -e\n[\s\S]*\n\)$/, 'a ( set -e ... ) subshell, so it stops at the first failure and leaves the shell where it was')
  // npx looks a bin it can't find up on the registry, and runs what it finds.
  assert.doesNotMatch(script, /\bnpx\b|\bnpm +(exec|x)\b/, 'no npx or npm exec')
  for (const bin of Object.keys(pkg.bin)) {
    assert.match(script, new RegExp(`^ *\\./node_modules/\\.bin/${bin} --help$`, 'm'), `runs ${bin} from node_modules/.bin`)
  }
})

test('the release steps\' tarball check loads every entry point and runs the bin, fails on a tarball without either, and never asks the registry', { timeout: 240_000 }, async (t) => {
  const script = tarballCheck()
  const registry = await recordingRegistry(t)
  const scratch = mkdtempSync(path.join(tmpdir(), 'qa-tarball-check-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const USAGE = /^Usage: qa-conductor-expose /m
  const LOADS = /^every entry point loads$/m

  const noBin = packageCopy(scratch, 'no-bin', json => delete json.bin)
  const brokenExport = packageCopy(scratch, 'broken-export', (json, dir) => {
    json.exports = { ...json.exports, './broken': './lib/broken.mjs' }
    writeFileSync(path.join(dir, 'lib/broken.mjs'), 'throw new Error("this entry point fails to load")\n')
  })
  const [ok, withoutBin, withBrokenExport] = await Promise.all(
    [ROOT, noBin, brokenExport].map(dir => runTarballCheck(script, dir, registry.url, scratch)),
  )
  const shown = run => `exit ${run.code}\n--- stdout\n${run.stdout}\n--- stderr\n${run.stderr}`

  assert.equal(ok.code, 0, shown(ok))
  assert.match(ok.stdout, LOADS, shown(ok))
  assert.match(ok.stdout, USAGE, shown(ok))

  // The case the check exists for: it must fail here, not fetch the name.
  assert.notEqual(withoutBin.code, 0, shown(withoutBin))
  assert.match(withoutBin.stdout, LOADS, shown(withoutBin))
  assert.doesNotMatch(withoutBin.stdout, USAGE, shown(withoutBin))

  // set -e: an entry point that fails to load ends the check there.
  assert.notEqual(withBrokenExport.code, 0, shown(withBrokenExport))
  assert.doesNotMatch(withBrokenExport.stdout, USAGE, `the bin ran after an entry point failed\n${shown(withBrokenExport)}`)

  assert.deepEqual(registry.asked, [], 'the check never asks the registry for anything')
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

test('the workflow check refuses a publish, a skippable gate, a token or id-token outside the stage, or repository code in the publish job', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const TESTS = '      - run: npm test\n'
  const STAGE = `        run: ${STAGE_RUN}\n`
  const STAGE_NAME = '      - name: Stage publish (a maintainer approves on npmjs.com to go live)\n'
  const TOKEN = '          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n'
  const ON_MAIN_STEP = `      - name: ${ON_MAIN}\n`
  const FETCH = '          git fetch --quiet --no-tags "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git" +refs/heads/main:refs/remotes/origin/main\n'
  const TEST_PERMISSIONS = '    permissions:\n      contents: read\n    steps:\n'
  const ENVIRONMENT = '    environment: npm-release\n'
  const PIN = 'a'.repeat(40)
  // Each mutation edits the real workflow at an anchor that must be there.
  const replace = (from, to) => text => {
    assert.ok(text.includes(from), `the workflow has ${JSON.stringify(from)}`)
    return text.replace(from, to)
  }
  const after = (anchor, ...lines) => replace(anchor, `${anchor}${lines.map(line => `${line}\n`).join('')}`)
  // The on-main step, from its name to the end of its script.
  const onMainStep = text => {
    const start = text.indexOf(ON_MAIN_STEP)
    assert.ok(start >= 0, 'the workflow has the on-main step')
    const end = text.indexOf('          fi\n', start) + '          fi\n'.length
    return text.slice(start, end)
  }
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
    'the tests in the publish job, after the stage': text => replace(TESTS, '')(text) + TESTS,
    'another trigger': after('    tags: ["v*"]\n', '  workflow_dispatch:'),
    'branch pushes': after('    tags: ["v*"]\n', '    branches: ["**"]'),
    'pull requests': after('\non:\n', '  pull_request:'),
    'pull_request_target': after('\non:\n', '  pull_request_target:'),
    'contents: write': replace(TEST_PERMISSIONS, '    permissions:\n      contents: write\n    steps:\n'),
    'id-token in the test job': replace(TEST_PERMISSIONS, '    permissions:\n      contents: read\n      id-token: write\n    steps:\n'),
    'permissions at workflow level': replace('\npermissions: {}\n', '\npermissions:\n  contents: read\n  id-token: write\n'),
    'a workflow-level concurrency key': replace('\npermissions: {}\n', '\nconcurrency: publish\n\npermissions: {}\n'),
    'the token at workflow level': replace('\npermissions: {}\n', `\nenv:\n  ${TOKEN.trim()}\n\npermissions: {}\n`),
    'the token on the test job': after('    timeout-minutes: 15\n', '    env:', `      ${TOKEN.trim()}`),
    'the token on the whole publish job': after(ENVIRONMENT, '    env:', `      ${TOKEN.trim()}`),
    'the token on the tests too': after(TESTS, '        env:', TOKEN.trimEnd()),
    'the token in the tag check\'s script': after('          fi\n', '          echo "${{ secrets.NPM_TOKEN }}"'),
    'no environment': replace(ENVIRONMENT, ''),
    'another environment': replace(ENVIRONMENT, '    environment: production\n'),
    'publish without needs': replace('    needs: test\n', ''),
    'a third job': text => `${text}\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo extra\n`,
    'a checkout in the publish job': replace(ON_MAIN_STEP, `      - uses: actions/checkout@${PIN}\n${ON_MAIN_STEP}`),
    'npm ci in the publish job': replace(STAGE_NAME, `      - run: npm ci\n${STAGE_NAME}`),
    'a repository script in the publish job': replace(STAGE_NAME, `      - run: node scripts/release.mjs\n${STAGE_NAME}`),
    'a repository script in the on-main check': after(FETCH, '          node ./scripts/check.mjs'),
    'the on-main check made to pass': replace('if ! git merge-base', 'if false && ! git merge-base'),
    'the on-main check after the stage': text => {
      const step = onMainStep(text)
      return text.replace(step, '') + step
    },
    'no on-main check': text => text.replace(onMainStep(text), ''),
    'the stage on a path npm reads as a GitHub repo': replace('"./release/', '"release/'),
    'a looser tarball check': replace('if [ "$have" != "$want" ]; then', 'if [ -z "$have" ]; then'),
    'the upload from anywhere': replace(`path: ${TARBALL}-*.tgz`, 'path: "*"'),
    'an action by tag, not SHA': replace('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v7'),
    'the download by tag, not SHA': text => text.replace(/actions\/download-artifact@[0-9a-f]{40}/, 'actions/download-artifact@v8'),
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

// A server-side repository for the on-main check, reached as GitHub would be,
// at $GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git, but over file://. main has
// first, second, then a merge of `merged`; `side` is a pushed branch that main
// never merged, as a PR head is. Git runs with no user or system config.
async function releaseRepo(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'qa-on-main-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'release test',
    GIT_AUTHOR_EMAIL: 'release@example.com',
    GIT_COMMITTER_NAME: 'release test',
    GIT_COMMITTER_EMAIL: 'release@example.com',
  }
  const git = async (cwd, ...args) => (await execFileP('git', args, { cwd, env })).stdout.trim()
  const bare = path.join(root, 'server', 'acme', 'widget.git')
  const work = path.join(root, 'work')
  mkdirSync(bare, { recursive: true })
  mkdirSync(work)
  await git(bare, 'init', '--quiet', '--bare')
  await git(work, 'init', '--quiet')
  await git(work, 'checkout', '--quiet', '-b', 'main')
  const commit = async message => {
    await git(work, 'commit', '--quiet', '--allow-empty', '-m', message)
    return git(work, 'rev-parse', 'HEAD')
  }
  const first = await commit('first')
  const second = await commit('second')
  await git(work, 'checkout', '--quiet', '-b', 'side')
  const side = await commit('side, never merged')
  await git(work, 'checkout', '--quiet', '-b', 'merged', 'main')
  const merged = await commit('merged later')
  await git(work, 'checkout', '--quiet', 'main')
  await git(work, 'merge', '--quiet', '--no-ff', '-m', 'merge', 'merged')
  const tip = await git(work, 'rev-parse', 'HEAD')
  await git(work, 'push', '--quiet', bare, 'main', 'side')
  return { root, env, server: pathToFileURL(path.join(root, 'server')).href, first, second, side, merged, tip }
}

test('the publish job\'s on-main check passes a commit main has merged, and stops any other with an error naming the tag', { timeout: 60_000 }, async t => {
  const script = stepScript(readFileSync(WORKFLOW, 'utf8'), ON_MAIN)
  const repo = await releaseRepo(t)
  // GitHub runs a step's script as bash -e; the tag, SHA and URLs reach it as
  // the runner's env, never as ${{ }} expressions spliced into shell source.
  assert.doesNotMatch(script, /\$\{\{/)
  const run = sha => execFileP('bash', ['-e', '-c', script], {
    cwd: repo.root,
    timeout: 20_000,
    env: {
      ...repo.env,
      GITHUB_SERVER_URL: repo.server,
      GITHUB_REPOSITORY: 'acme/widget',
      GITHUB_REF_NAME: 'v1.2.3',
      GITHUB_SHA: sha,
      RUNNER_TEMP: mkdtempSync(path.join(repo.root, 'runner-')),
    },
  })
  for (const sha of [repo.first, repo.second, repo.merged, repo.tip]) await run(sha)
  for (const sha of [repo.side, 'f'.repeat(40)]) {
    await assert.rejects(run(sha), err => err.code === 1 && err.stdout.includes(`::error::v1.2.3 (${sha}) is not on main`), sha)
  }
})

test('the publish job\'s tarball check passes only a release directory that holds the tag\'s tarball and nothing else', { timeout: 30_000 }, async t => {
  const script = stepScript(readFileSync(WORKFLOW, 'utf8'), TARBALL_CHECK)
  assert.doesNotMatch(script, /\$\{\{/)
  const scratch = mkdtempSync(path.join(tmpdir(), 'qa-tarball-name-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const want = `${TARBALL}-${pkg.version}.tgz`
  const run = (name, files) => {
    const dir = path.join(scratch, name)
    mkdirSync(dir)
    if (files) {
      mkdirSync(path.join(dir, 'release'))
      for (const file of files) writeFileSync(path.join(dir, 'release', file), 'x')
    }
    return execFileP('bash', ['-e', '-c', script], { cwd: dir, timeout: 10_000, env: { PATH: process.env.PATH, GITHUB_REF_NAME: `v${pkg.version}` } })
  }
  await run('ok', [want])
  for (const [name, files] of [
    ['another version', [`${TARBALL}-9.9.9.tgz`]],
    ['another package', [`other-${pkg.version}.tgz`]],
    ['an extra file', [want, 'extra.tgz']],
    ['empty', []],
    ['no directory', null],
  ]) {
    await assert.rejects(run(name, files), err => err.code !== 0, name)
  }
})
