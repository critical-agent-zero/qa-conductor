// Tests for the git-worktree BuildConvention. git is simulated by a recording
// execFileFn over an in-memory fsx, so nothing here runs real git, spawns a
// process or touches the network. The module is imported through the package
// self-reference, which also proves the `exports` entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { createWorktreeBuild, trustDecision } from '@critical-labs/qa-conductor/adapters/build-worktree'

const REPO = 'acme/widget'
const CACHE = '/cache/acme-widget'
const BARE = `${CACHE}/repo.git`
const WT = sha => `${CACHE}/worktrees/${sha}`
const MARKER = sha => `${CACHE}/built/${sha}.json`
const sha = ch => ch.repeat(40)
const BASE = sha('a')
const PR = sha('b')
const MOVED = sha('c')
const INSTALL = { cmd: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile'], env: { CI: 'true' } }
const ENV = { PATH: '/usr/bin:/bin', HOME: '/home/qa', GITHUB_QA_TOKEN: 'ghp_secret', AWS_SECRET_ACCESS_KEY: 'shh' }
const TRUST = { logins: [], associations: ['OWNER', 'MEMBER', 'COLLABORATOR'], requirePush: true }

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

// --- fakes -------------------------------------------------------------------

// A tiny in-memory filesystem with the fs.promises subset the adapter uses.
// `fail(op, path)` returning an Error injects a failure.
function memFs() {
  const files = new Map()
  const dirs = new Set(['/'])
  const calls = []
  const enoent = p => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: 'ENOENT' })
  const mkdirp = p => { for (let d = p; d !== path.dirname(d); d = path.dirname(d)) dirs.add(d) }
  const fsx = {
    files, dirs, calls, mkdirp, fail: null,
    exists: p => files.has(p) || dirs.has(p),
    async mkdir(p) { calls.push(['mkdir', p]); mkdirp(p) },
    async readFile(p) {
      if (!files.has(p)) throw enoent(p)
      return files.get(p)
    },
    async writeFile(p, data) {
      calls.push(['writeFile', p])
      if (!dirs.has(path.dirname(p))) throw enoent(p)
      files.set(p, String(data))
    },
    async readdir(p) {
      if (!dirs.has(p)) throw enoent(p)
      const names = new Set()
      for (const x of [...files.keys(), ...dirs]) if (x !== p && path.dirname(x) === p) names.add(path.basename(x))
      return [...names]
    },
    async rm(p, opts = {}) {
      calls.push(['rm', p, opts])
      const injected = fsx.fail?.('rm', p)
      if (injected) throw injected
      if (!fsx.exists(p) && !opts.force) throw enoent(p)
      for (const k of [...files.keys()]) if (k === p || k.startsWith(`${p}/`)) files.delete(k)
      for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d)
    },
    async lstat(p) {
      if (!fsx.exists(p)) throw enoent(p)
      return { isDirectory: () => dirs.has(p) }
    },
  }
  return fsx
}

// A recording execFileFn that simulates just enough git over `fs`: the bare
// repo, fetch into refs from `remote`, rev-parse, update-ref and worktrees.
// Anything that isn't git is the installer, answered by `onInstall`.
function gitWorld(fs, { remote, onInstall, onFetch, fail } = {}) {
  const refs = {}
  const calls = []
  const ok = { stdout: '' }
  const fromRemote = src => {
    const pull = /^refs\/pull\/(\d+)\/head$/.exec(src)
    const out = pull ? remote.pulls[pull[1]] : src === `refs/heads/${remote.baseRef ?? 'main'}` ? remote.base : undefined
    if (out === undefined) throw new Error(`fatal: couldn't find remote ref ${src}`)
    return out
  }
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args: [...args], opts })
    const injected = fail?.(cmd, args)
    if (injected) throw injected
    if (cmd !== 'git') return onInstall ? onInstall(args, opts) : { stdout: 'installed\n' }
    if (args[0] === 'init') {
      fs.mkdirp(args[2])
      fs.files.set(`${args[2]}/HEAD`, 'ref: refs/heads/main\n')
      return ok
    }
    assert.deepEqual(args.slice(0, 2), ['--git-dir', BARE])
    const [sub, ...rest] = args.slice(2)
    if (sub === 'fetch') {
      for (const spec of rest.slice(2)) {
        const [src, dst] = spec.replace(/^\+/, '').split(':')
        refs[dst] = fromRemote(src)
      }
      onFetch?.()
      return ok
    }
    if (sub === 'rev-parse') {
      const ref = rest.at(-1)
      if (refs[ref] === undefined) throw new Error('fatal: Needed a single revision')
      return { stdout: `${refs[ref]}\n` }
    }
    if (sub === 'update-ref') { refs[rest[0]] = rest[1]; return ok }
    if (sub === 'worktree') {
      const [op, ...r] = rest
      if (op === 'add') {
        const dir = r.at(-2)
        if (fs.exists(dir)) throw new Error(`fatal: '${dir}' already exists`)
        fs.mkdirp(dir)
        fs.files.set(`${dir}/.git`, `gitdir: ${BARE}/worktrees/x\n`)
      }
      if (op === 'remove') {
        const dir = r.at(-1)
        if (!fs.exists(dir)) throw new Error(`fatal: '${dir}' is not a working tree`)
        await fs.rm(dir, { recursive: true, force: true })
      }
      return ok
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  exec.calls = calls
  exec.refs = refs
  return exec
}

// prInfo answers are the defaults (a trusted member's same-repo PR at PR)
// merged with `info` (an object or (num) => object) or, per call, `infos[i]`.
function fakeGithub({ info = {}, infos = null, permission = 'write' } = {}) {
  const calls = []
  let n = 0
  return {
    calls,
    async prInfo(num) {
      calls.push(['prInfo', num])
      const over = infos ? infos[Math.min(n++, infos.length - 1)] : typeof info === 'function' ? info(num) : info
      if (over instanceof Error) throw over
      return { number: num, headSha: PR, author: 'alice', authorAssociation: 'MEMBER', isDraft: false, headRepo: REPO, headOwner: 'acme', ...over }
    },
    async authorPermission(login) {
      calls.push(['authorPermission', login])
      const p = typeof permission === 'function' ? permission(login) : permission
      if (p instanceof Error) throw p
      return p
    },
  }
}

function setup({
  fs = memFs(), remote = { base: BASE, pulls: { 7: PR } }, onInstall, onFetch, fail,
  info, infos, permission, now = { t: 1000 }, install = INSTALL, ...opts
} = {}) {
  const exec = gitWorld(fs, { remote, onInstall, onFetch, fail })
  const github = fakeGithub({ info, infos, permission })
  const services = []
  const build = createWorktreeBuild({
    repo: REPO,
    cacheDir: CACHE,
    github,
    servicesFor: (dir, meta) => { services.push([dir, meta]); return { app: dir } },
    install,
    execFileFn: exec,
    fsx: fs,
    baseEnv: ENV,
    nowFn: () => now.t,
    ...opts,
  })
  const events = []
  build.subscribeBuild(e => { events.push(e) })
  const messages = () => events.map(e => e.message)
  return { build, fs, exec, github, remote, events, messages, now, services }
}

// Readable views of what was executed.
const gitOps = w => w.exec.calls.filter(c => c.cmd === 'git').map(c => (c.args[0] === '--git-dir' ? c.args.slice(2) : c.args).join(' '))
const installs = w => w.exec.calls.filter(c => c.cmd !== 'git')
const worktreeAdds = w => w.exec.calls.filter(c => c.args.includes('add')).map(c => c.args.at(-1))
const updateRefs = w => w.exec.calls.filter(c => c.args.includes('update-ref')).map(c => c.args.slice(-2))
const markerShas = fs => [...fs.files.keys()].filter(k => k.startsWith(`${CACHE}/built/`)).map(k => path.basename(k, '.json')).sort()
const trusted = over => ({ author: 'alice', authorAssociation: 'MEMBER', headRepo: REPO, headOwner: 'acme', ...over })

// --- trustDecision (pure) ----------------------------------------------------

const info = over => ({ number: 7, headSha: PR, isDraft: false, ...trusted(over) })
const decide = (over, { trust = TRUST, permission = 'write' } = {}) => trustDecision(info(over), { repo: REPO, trust, permission })

test('trustDecision: a member or owner with push access is trusted', () => {
  assert.deepEqual(decide({}), { ok: true })
  assert.deepEqual(decide({ authorAssociation: 'OWNER' }, { permission: 'admin' }), { ok: true })
})

test('trustDecision: association alone is not an access check (read-only collaborator, no-push member)', () => {
  const ro = decide({ authorAssociation: 'COLLABORATOR' }, { permission: 'read' })
  assert.equal(ro.ok, false)
  assert.match(ro.reason, /@alice has read access; push access is required/)
  assert.equal(decide({}, { permission: 'none' }).ok, false)
  assert.equal(decide({}, { permission: null }).ok, false)
})

test('trustDecision: an association outside trust.associations is refused', () => {
  assert.deepEqual(decide({ authorAssociation: 'CONTRIBUTOR' }), { ok: false, reason: 'author association CONTRIBUTOR is not trusted' })
})

test('trustDecision: a login in trust.logins is trusted (case-insensitive) with no association or permission', () => {
  const trust = { ...TRUST, logins: ['carol'] }
  assert.deepEqual(decide({ author: 'Carol', authorAssociation: 'NONE', headOwner: 'acme' }, { trust, permission: null }), { ok: true })
})

test('trustDecision: requirePush false trusts the association alone', () => {
  assert.deepEqual(decide({ authorAssociation: 'COLLABORATOR' }, { trust: { ...TRUST, requirePush: false }, permission: 'read' }), { ok: true })
})

test('trustDecision: a partial trust config keeps the fail-closed defaults', () => {
  const trust = { logins: ['bob'] }
  assert.equal(decide({}, { trust, permission: 'read' }).ok, false) // requirePush still on
  assert.deepEqual(decide({}, { trust, permission: 'write' }), { ok: true }) // default associations
  assert.equal(decide({ authorAssociation: 'CONTRIBUTOR' }, { trust, permission: 'write' }).ok, false)
})

test('trustDecision: a deleted head repository is refused', () => {
  assert.deepEqual(decide({ headRepo: null, headOwner: null }), { ok: false, reason: 'head repository was deleted' })
})

test("trustDecision: a head branch in someone else's fork is refused, even for an allowlisted login", () => {
  const fork = { headRepo: 'mallory/widget', headOwner: 'mallory' }
  const reason = "head branch is in @mallory's fork (mallory/widget), not the author's"
  assert.deepEqual(decide(fork), { ok: false, reason })
  assert.deepEqual(decide(fork, { trust: { ...TRUST, logins: ['alice'] } }), { ok: false, reason })
})

test("trustDecision: the same repo in a different case and the author's own fork are trusted", () => {
  assert.deepEqual(decide({ headRepo: 'ACME/Widget' }), { ok: true })
  assert.deepEqual(decide({ headRepo: 'alice/widget', headOwner: 'Alice' }), { ok: true })
})

test('trustDecision: any error fails closed', () => {
  const boom = { get author() { throw new Error('boom') }, authorAssociation: 'MEMBER' }
  const d = trustDecision(boom, { repo: REPO, trust: TRUST, permission: 'write' })
  assert.equal(d.ok, false)
  assert.match(d.reason, /boom/)
  assert.equal(trustDecision(null, { repo: REPO, trust: TRUST, permission: 'write' }).ok, false)
  assert.equal(trustDecision(info({}), undefined).ok, false)
})

test('trustDecision: a malformed trust config fails closed; a string never spreads into one-letter logins', () => {
  // e.g. `logins: cfg.env.QA_TRUSTED_LOGINS` left unsplit
  const outsider = { author: 'e', authorAssociation: 'NONE', headRepo: 'e/widget', headOwner: 'e' }
  const d = trustDecision(outsider, { repo: REPO, trust: { logins: 'alice' }, permission: null })
  assert.equal(d.ok, false)
  assert.match(d.reason, /trust\.logins must be an array/)
  for (const trust of [{ associations: 'MEMBER' }, { logins: [null] }, { logins: [' '] }, { requirePush: 'false' }, { allowForks: 0 }, 'alice', ['alice']]) {
    assert.equal(decide({}, { trust }).ok, false, JSON.stringify(trust))
  }
  assert.deepEqual(decide({ author: 'carol', authorAssociation: 'NONE' }, { trust: { logins: new Set(['carol']) }, permission: null }), { ok: true })
})

test("trustDecision: allowForks false refuses a head in the author's own fork", () => {
  const trust = { ...TRUST, allowForks: false }
  assert.deepEqual(decide({ headRepo: 'alice/widget', headOwner: 'alice' }, { trust }), {
    ok: false, reason: 'head branch is in a fork (alice/widget) and trust.allowForks is off',
  })
  assert.deepEqual(decide({ headRepo: 'ACME/widget' }, { trust }), { ok: true })
})

// --- ensureBuilt: the trust gate runs before any git call --------------------

async function refusedBeforeGit(opts, reason) {
  const w = setup(opts)
  await assert.rejects(w.build.ensureBuilt(7), err => {
    assert.match(err.message, /^PR #7 by @\w+ is not from a trusted source: /)
    assert.match(err.message, reason)
    return true
  })
  assert.equal(w.exec.calls.length, 0)
  assert.equal(w.fs.calls.length, 0)
  return w
}

test('ensureBuilt refuses a read-only collaborator before any git call', async () => {
  const w = await refusedBeforeGit({ info: { authorAssociation: 'COLLABORATOR' }, permission: 'read' }, /@alice has read access/)
  assert.deepEqual(w.github.calls, [['prInfo', 7], ['authorPermission', 'alice']])
})

test('ensureBuilt fails closed when the permission lookup errors', async () => {
  await refusedBeforeGit({ permission: new Error('github GET /collaborators -> 502') }, /could not check @alice's permission: github GET/)
})

test("ensureBuilt refuses a head branch in someone else's fork", async () => {
  await refusedBeforeGit({ info: { headRepo: 'mallory/widget', headOwner: 'mallory' } }, /@mallory's fork \(mallory\/widget\)/)
})

test('ensureBuilt refuses a PR whose head repository was deleted', async () => {
  await refusedBeforeGit({ info: { headRepo: null, headOwner: null } }, /head repository was deleted$/)
})

test("ensureBuilt refuses the author's own fork when trust.allowForks is false", async () => {
  await refusedBeforeGit({ info: { headRepo: 'alice/widget', headOwner: 'alice' }, trust: { allowForks: false } }, /trust\.allowForks is off$/)
})

test('ensureBuilt fails closed when prInfo errors', async () => {
  const w = setup({ info: new Error('github GET /pulls/7 -> 500') })
  await assert.rejects(w.build.ensureBuilt(7), /pulls\/7 -> 500/)
  assert.equal(w.exec.calls.length, 0)
})

test('ensureBuilt trusts a login in trust.logins without a permission lookup', async () => {
  const w = setup({ info: { author: 'Carol', authorAssociation: 'NONE', headRepo: REPO }, trust: { logins: ['carol'] } })
  await w.build.ensureBuilt(7)
  assert.deepEqual(w.github.calls, [['prInfo', 7]])
  assert.deepEqual(worktreeAdds(w), [BASE, PR])
})

test("ensureBuilt trusts the same repo in a different case and the author's own fork", async () => {
  for (const over of [{ headRepo: 'ACME/WIDGET' }, { headRepo: 'alice/widget', headOwner: 'ALICE' }]) {
    const w = setup({ info: over })
    await w.build.ensureBuilt(7)
    assert.deepEqual(worktreeAdds(w), [BASE, PR])
  }
})

// --- ensureBuilt: fetch and the moved-head re-gate ----------------------------

test('fetches both refs with prompts disabled, pins the gated SHA, and passes the signal to every exec', async () => {
  const w = setup()
  const ac = new AbortController()
  await w.build.ensureBuilt(7, { signal: ac.signal })
  assert.deepEqual(gitOps(w).slice(0, 5), [
    `init --bare ${BARE}`,
    'fetch --no-tags https://github.com/acme/widget.git +refs/heads/main:refs/qa/base +refs/pull/7/head:refs/qa/pr-7-incoming',
    'rev-parse --verify refs/qa/base',
    'rev-parse --verify refs/qa/pr-7-incoming',
    `update-ref refs/qa/pr-7 ${PR}`,
  ])
  const fetch = w.exec.calls.find(c => c.args.includes('fetch'))
  assert.equal(fetch.opts.env.GIT_TERMINAL_PROMPT, '0')
  assert.ok(w.exec.calls.length > 5)
  for (const c of w.exec.calls) assert.equal(c.opts.signal, ac.signal, `${c.cmd} ${c.args.join(' ')}`)
})

test('git runs with hooks disabled, so no user-level hook sees a PR checkout with the full env', async () => {
  const w = setup()
  await w.build.ensureBuilt(7)
  const gits = w.exec.calls.filter(c => c.cmd === 'git')
  assert.ok(gits.some(c => c.args.includes('add')))
  for (const c of gits) {
    assert.equal(c.opts.env.GIT_CONFIG_COUNT, '1')
    assert.equal(c.opts.env.GIT_CONFIG_KEY_0, 'core.hooksPath')
    assert.equal(c.opts.env.GIT_CONFIG_VALUE_0, '/dev/null')
  }
  // an operator's own env-supplied git config is kept, and ours is appended
  const own = setup({ baseEnv: { ...ENV, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.proxy', GIT_CONFIG_VALUE_0: 'http://proxy:3128' } })
  await own.build.ensureBuilt(7)
  const env = own.exec.calls.find(c => c.args.includes('fetch')).opts.env
  assert.deepEqual([env.GIT_CONFIG_COUNT, env.GIT_CONFIG_KEY_0, env.GIT_CONFIG_KEY_1, env.GIT_CONFIG_VALUE_1], ['2', 'http.proxy', 'core.hooksPath', '/dev/null'])
})

test('baseRef and cloneUrl shape the fetch', async () => {
  const w = setup({ baseRef: 'develop', cloneUrl: 'git@github.com:acme/widget.git', remote: { base: BASE, baseRef: 'develop', pulls: { 7: PR } } })
  await w.build.ensureBuilt(7)
  assert.equal(gitOps(w)[1], 'fetch --no-tags git@github.com:acme/widget.git +refs/heads/develop:refs/qa/base +refs/pull/7/head:refs/qa/pr-7-incoming')
  assert.equal((await w.build.resolveBaseImages()).label, 'develop@aaaaaaa')
})

test('a head that moved during the fetch is re-gated before it is pinned or checked out', async () => {
  const w = setup({ infos: [{ headSha: PR }, { headSha: MOVED }], remote: { base: BASE, pulls: { 7: MOVED } } })
  await w.build.ensureBuilt(7)
  assert.equal(w.github.calls.filter(c => c[0] === 'prInfo').length, 2)
  assert.equal(w.github.calls.filter(c => c[0] === 'authorPermission').length, 2)
  assert.deepEqual(updateRefs(w), [['refs/qa/pr-7', MOVED]])
  assert.deepEqual(worktreeAdds(w), [BASE, MOVED])
  assert.equal((await w.build.resolvePrImages(7)).label, '#7@ccccccc')
})

test("a moved head that doesn't pass the re-gate fails with 'retry' and is never pinned or checked out", async () => {
  const seconds = [
    { headSha: MOVED, headRepo: 'mallory/widget', headOwner: 'mallory' }, // now untrusted
    { headSha: sha('d') }, // moved again
    { headSha: 'garbage' },
    new Error('github GET /pulls/7 -> 502'),
  ]
  for (const second of seconds) {
    const w = setup({ infos: [{ headSha: PR }, second], remote: { base: BASE, pulls: { 7: MOVED } } })
    await assert.rejects(w.build.ensureBuilt(7), { message: 'PR #7 head moved during fetch; retry' })
    assert.deepEqual(updateRefs(w), [])
    assert.deepEqual(worktreeAdds(w), [])
    assert.equal(installs(w).length, 0)
    await assert.rejects(w.build.resolvePrImages(7), /has not been built/)
  }
})

// --- ensureBuilt: worktrees, markers, install --------------------------------

test('each SHA gets a fresh worktree after a prune, then an install, then an external marker', async () => {
  const w = setup()
  await w.build.ensureBuilt(7)
  const seq = w.exec.calls.slice(5).map(c => (c.cmd === 'git' ? `git ${c.args.slice(2).join(' ')}` : `${c.cmd} @ ${c.opts.cwd}`))
  assert.deepEqual(seq, [
    'git worktree prune',
    `git worktree add -f -f --detach ${WT(BASE)} ${BASE}`,
    `pnpm @ ${WT(BASE)}`,
    'git worktree prune',
    `git worktree add -f -f --detach ${WT(PR)} ${PR}`,
    `pnpm @ ${WT(PR)}`,
  ])
  const marker = JSON.parse(w.fs.files.get(MARKER(PR)))
  assert.deepEqual(Object.keys(marker).sort(), ['builtAt', 'installFingerprint', 'sha'])
  assert.equal(marker.sha, PR)
  assert.equal(marker.builtAt, 1000)
  assert.match(marker.installFingerprint, /^[0-9a-f]{64}$/)
  assert.deepEqual(markerShas(w.fs), [BASE, PR])
  // the marker lives outside the checkout, so nothing in the PR can forge it
  assert.equal([...w.fs.files.keys()].some(k => k.startsWith(`${WT(PR)}/`) && k.endsWith('.json')), false)
})

test('a SHA with a valid marker is not checked out or installed again', async () => {
  const w = setup()
  await w.build.ensureBuilt(7)
  w.exec.calls.length = 0
  w.events.length = 0
  await w.build.ensureBuilt(7)
  assert.deepEqual(gitOps(w), [
    'fetch --no-tags https://github.com/acme/widget.git +refs/heads/main:refs/qa/base +refs/pull/7/head:refs/qa/pr-7-incoming',
    'rev-parse --verify refs/qa/base',
    'rev-parse --verify refs/qa/pr-7-incoming',
    `update-ref refs/qa/pr-7 ${PR}`,
  ])
  assert.equal(installs(w).length, 0)
  assert.deepEqual(w.messages(), ['fetching acme/widget…', 'base (aaaaaaa) already built', '#7 (bbbbbbb) already built'])
})

test('a partially built directory is cleaned with worktree remove -f -f and rm -rf, tolerating failures', async () => {
  const fs = memFs()
  fs.mkdirp(`${WT(PR)}/node_modules`)
  fs.files.set(`${WT(PR)}/node_modules/half-written`, 'x')
  const w = setup({ fs, fail: (cmd, args) => (args.includes('remove') ? new Error('fatal: not a working tree') : null) })
  await w.build.ensureBuilt(7)
  const ops = gitOps(w)
  const at = ops.indexOf(`worktree remove -f -f ${WT(PR)}`)
  assert.ok(at > 0, ops.join('\n'))
  assert.deepEqual(ops.slice(at - 1, at + 3), [
    'worktree prune',
    `worktree remove -f -f ${WT(PR)}`,
    'worktree prune',
    `worktree add -f -f --detach ${WT(PR)} ${PR}`,
  ])
  assert.deepEqual(fs.calls.find(c => c[0] === 'rm' && c[1] === WT(PR)), ['rm', WT(PR), { recursive: true, force: true }])
  assert.equal(fs.files.has(`${WT(PR)}/node_modules/half-written`), false)
  assert.deepEqual(markerShas(fs), [BASE, PR])
})

test("a marker whose install fingerprint doesn't match, or whose worktree is gone, counts as not built", async () => {
  const fs = memFs()
  await setup({ fs }).build.ensureBuilt(7)

  const same = setup({ fs, install: { ...INSTALL, env: { CI: 'false' } } }) // env values aren't fingerprinted
  await same.build.ensureBuilt(7)
  assert.equal(installs(same).length, 0)

  const DEV = { ...INSTALL, env: { CI: 'true', NODE_ENV: 'development' } } // a new env key changes it
  const changed = setup({ fs, install: DEV })
  await changed.build.ensureBuilt(7)
  assert.deepEqual(installs(changed).map(c => c.opts.cwd), [WT(BASE), WT(PR)])

  fs.files.set(MARKER(PR), JSON.stringify({ sha: PR, builtAt: 1, installFingerprint: 'nope' }))
  const mismatched = setup({ fs, install: DEV })
  await mismatched.build.ensureBuilt(7)
  assert.deepEqual(installs(mismatched).map(c => c.opts.cwd), [WT(PR)])
  assert.ok(gitOps(mismatched).includes(`worktree remove -f -f ${WT(PR)}`))

  await fs.rm(WT(BASE), { recursive: true, force: true })
  const gone = setup({ fs, install: DEV })
  await gone.build.ensureBuilt(7)
  assert.deepEqual(installs(gone).map(c => c.opts.cwd), [WT(BASE)])
})

test('install: null skips the installer but still marks the build', async () => {
  const w = setup({ install: null })
  await w.build.ensureBuilt(7)
  assert.equal(installs(w).length, 0)
  assert.deepEqual(markerShas(w.fs), [BASE, PR])
})

test('the installer sees exactly PATH, HOME and install.env', async () => {
  const w = setup()
  await w.build.ensureBuilt(7)
  assert.equal(installs(w).length, 2)
  for (const c of installs(w)) {
    assert.equal(c.cmd, 'pnpm')
    assert.deepEqual(c.args, INSTALL.args)
    assert.deepEqual(c.opts.env, { PATH: ENV.PATH, HOME: ENV.HOME, CI: 'true' })
  }
  const override = setup({ install: { cmd: 'npm', args: ['ci'], env: { HOME: '/tmp/qa-home' } } })
  await override.build.ensureBuilt(7)
  assert.deepEqual(installs(override)[0].opts.env, { PATH: ENV.PATH, HOME: '/tmp/qa-home' })
})

test('an install failure names the tree and exit code, with the last 40 lines of stdout+stderr as logTail', async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`)
  const w = setup({
    onInstall: () => {
      throw Object.assign(new Error('pnpm install: Command failed'), {
        code: 1, stdout: `${lines.slice(0, 90).join('\n')}\n`, stderr: `${lines.slice(90).join('\n')}\n`,
      })
    },
  })
  await assert.rejects(w.build.ensureBuilt(7), err => {
    assert.equal(err.message, 'install failed for base (aaaaaaa): pnpm exited 1')
    assert.equal(err.logTail, lines.slice(60).join('\n'))
    return true
  })
  assert.deepEqual(markerShas(w.fs), [])
  assert.deepEqual(worktreeAdds(w), [BASE])
})

test('the logTail is capped at 8 KB, and falls back to the message for errors without output (pre-U1 exec)', async () => {
  const long = Array.from({ length: 40 }, (_, i) => `${i}:${'é'.repeat(300)}`)
  const capped = setup({ onInstall: () => { throw Object.assign(new Error('x'), { code: 2, stdout: long.join('\n'), stderr: '' }) } })
  await assert.rejects(capped.build.ensureBuilt(7), err => {
    assert.ok(Buffer.byteLength(err.logTail) <= 8192, `${Buffer.byteLength(err.logTail)} bytes`)
    assert.ok(err.logTail.endsWith(long.at(-1)))
    assert.ok(!err.logTail.includes('�'))
    return true
  })

  const legacy = setup({
    remote: { base: BASE, pulls: { 7: PR } },
    onInstall: (args, opts) => {
      if (opts.cwd === WT(BASE)) return { stdout: '' }
      throw new Error('pnpm install: Command failed: pnpm install\nERR_PNPM_OUTDATED_LOCKFILE')
    },
  })
  await assert.rejects(legacy.build.ensureBuilt(7), err => {
    assert.equal(err.message, 'install failed for #7 (bbbbbbb): pnpm exited abnormally')
    assert.equal(err.logTail, 'pnpm install: Command failed: pnpm install\nERR_PNPM_OUTDATED_LOCKFILE')
    return true
  })
})

// --- ensureBuilt: the one-build-at-a-time lock and abort ----------------------

function blockingInstall() {
  const started = deferred()
  const release = deferred()
  const handler = (args, opts) => new Promise((resolve, reject) => {
    started.resolve(opts)
    const abort = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    if (opts.signal?.aborted) return abort()
    opts.signal?.addEventListener('abort', abort, { once: true })
    release.promise.then(() => resolve({ stdout: '' }))
  })
  return { started: started.promise, release: () => release.resolve(), handler }
}

test('a second caller waits for the lock, ignores an aborted first build, then builds for itself', async () => {
  const block = blockingInstall()
  let n = 0
  const w = setup({ onInstall: (args, opts) => (n++ === 0 ? block.handler(args, opts) : { stdout: '' }) })
  const first = new AbortController()
  const second = new AbortController()
  const a = w.build.ensureBuilt(7, { signal: first.signal })
  await block.started
  const b = w.build.ensureBuilt(7, { signal: second.signal })
  await flush()
  assert.equal(gitOps(w).filter(op => op.startsWith('fetch')).length, 1, 'the second caller must wait')
  assert.ok(w.messages().includes('waiting for another build to finish…'))

  first.abort()
  await assert.rejects(a, { name: 'AbortError' })
  await b
  assert.equal(gitOps(w).filter(op => op.startsWith('fetch')).length, 2)
  assert.deepEqual(installs(w).map(c => c.opts.cwd), [WT(BASE), WT(BASE), WT(PR)])
  assert.ok(installs(w).slice(1).every(c => c.opts.signal === second.signal))
  assert.deepEqual(markerShas(w.fs), [BASE, PR])
  assert.equal((await w.build.resolvePrImages(7)).label, '#7@bbbbbbb')
})

test('a second caller runs its own build after a failed first build', async () => {
  let n = 0
  const w = setup({ onInstall: () => { if (n++ === 0) throw Object.assign(new Error('boom'), { code: 1 }); return { stdout: '' } } })
  const [a, b] = await Promise.allSettled([w.build.ensureBuilt(7), w.build.ensureBuilt(7)])
  assert.equal(a.status, 'rejected')
  assert.equal(b.status, 'fulfilled')
  assert.deepEqual(markerShas(w.fs), [BASE, PR])
})

test('an already-aborted signal is honoured once the lock is taken, before any git call', async () => {
  const w = setup()
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(w.build.ensureBuilt(7, { signal: ac.signal }), { name: 'AbortError' })
  assert.deepEqual(w.github.calls.map(c => c[0]), ['prInfo', 'authorPermission']) // the gate still ran
  assert.equal(w.exec.calls.length, 0)
})

test('a caller aborted while waiting for the lock throws AbortError without running git', async () => {
  const block = blockingInstall()
  const w = setup({ onInstall: block.handler })
  const a = w.build.ensureBuilt(7)
  await block.started
  const ac = new AbortController()
  const b = w.build.ensureBuilt(7, { signal: ac.signal })
  ac.abort()
  block.release()
  await a
  await assert.rejects(b, { name: 'AbortError' })
  assert.equal(w.exec.calls.filter(c => c.opts.signal === ac.signal).length, 0)
})

test('an abort during the fetch records no SHAs for resolve* and checks nothing out', async () => {
  const ac = new AbortController()
  const w = setup({ onFetch: () => ac.abort() })
  await assert.rejects(w.build.ensureBuilt(7, { signal: ac.signal }), { name: 'AbortError' })
  assert.deepEqual(worktreeAdds(w), [])
  await assert.rejects(w.build.resolvePrImages(7), /has not been built/)
  await assert.rejects(w.build.resolveBaseImages(), /has not been built/)
})

// --- prune --------------------------------------------------------------------

const S = { 1: sha('1'), 2: sha('2'), 3: sha('3'), 4: sha('4') }
const manyPrs = opts => setup({ remote: { base: BASE, pulls: S }, info: n => ({ headSha: S[n] }), ...opts })

test('prune keeps the newest `keep` markers plus the SHAs just built, and clears orphaned checkouts', async () => {
  const w = manyPrs({ keep: 2 })
  w.fs.mkdirp(`${WT(sha('9'))}/node_modules`) // a checkout whose install never finished
  w.fs.mkdirp(`${CACHE}/worktrees/not-a-sha`)
  for (const n of [1, 2, 3, 4]) {
    await w.build.ensureBuilt(n)
    w.now.t += 1000
  }
  // BASE was built first (the oldest marker) but is current, so it stays
  assert.deepEqual(markerShas(w.fs), [S[3], S[4], BASE].sort())
  assert.ok(w.fs.exists(WT(BASE)) && w.fs.exists(WT(S[3])) && w.fs.exists(WT(S[4])))
  for (const gone of [S[1], S[2], sha('9')]) assert.equal(w.fs.exists(WT(gone)), false, gone)
  assert.ok(w.fs.exists(`${CACHE}/worktrees/not-a-sha`), 'names that are not SHAs are never touched')
  const removed = gitOps(w).filter(op => op.startsWith('worktree remove')).map(op => op.split(' ').at(-1))
  assert.deepEqual(removed.sort(), [WT(S[1]), WT(S[2]), WT(sha('9'))].sort())
  assert.ok(gitOps(w).at(-1) === 'worktree prune')
})

test('prune with keep 0 retains only the SHAs just built', async () => {
  const w = manyPrs({ keep: 0 })
  await w.build.ensureBuilt(1)
  w.now.t += 1000
  await w.build.ensureBuilt(2)
  assert.deepEqual(markerShas(w.fs), [S[2], BASE].sort())
})

test('prune failures are reported as progress and never fail ensureBuilt', async () => {
  let removeTried = false
  const w = manyPrs({
    keep: 0,
    fail: (cmd, args) => {
      if (args.includes('remove') && args.includes(WT(S[1]))) { removeTried = true; return new Error('fatal: locked') }
      if (removeTried && args.at(-1) === 'prune' && args.length === 4) return new Error('fatal: prune broke')
      return null
    },
  })
  await w.build.ensureBuilt(1)
  w.fs.fail = (op, p) => (p === WT(S[1]) ? new Error('EACCES: permission denied') : null)
  await w.build.ensureBuilt(2) // resolves despite every removal step failing
  assert.ok(w.messages().some(m => /^could not prune 1111111: EACCES/.test(m)), w.messages().join('\n'))
  assert.ok(w.messages().some(m => /^could not prune stale worktrees: fatal: prune broke/.test(m)), w.messages().join('\n'))
  // the marker went first, so a half-removed tree can never count as built…
  assert.equal(w.fs.files.has(MARKER(S[1])), false)
  // …and the leftover directory is retried as an orphan on the next build
  w.fs.fail = null
  removeTried = false
  await w.build.ensureBuilt(3)
  assert.equal(w.fs.exists(WT(S[1])), false)
})

// --- validation -----------------------------------------------------------------

test('PR numbers must be positive safe integers, checked before any GitHub or git call', async () => {
  for (const bad of [0, -1, 1.5, '7', Number.NaN, 2 ** 53, null]) {
    const w = setup()
    await assert.rejects(w.build.ensureBuilt(bad), /invalid PR number/)
    await assert.rejects(w.build.resolvePrImages(bad), /invalid PR number/)
    assert.equal(w.github.calls.length, 0)
    assert.equal(w.exec.calls.length, 0)
  }
})

test('SHAs from GitHub are trimmed and validated before any git call', async () => {
  const w = setup({ info: { headSha: `  ${PR}\n` } })
  await w.build.ensureBuilt(7)
  assert.deepEqual(updateRefs(w), [['refs/qa/pr-7', PR]])

  for (const bad of ['', 'b'.repeat(39), 'B'.repeat(40), 'g'.repeat(40), `${PR}; rm -rf /`, 'b'.repeat(50), null]) {
    const v = setup({ info: { headSha: bad } })
    await assert.rejects(v.build.ensureBuilt(7), /invalid SHA/)
    assert.equal(v.exec.calls.length, 0)
  }
})

test('SHA-256 object names (64 hex) are accepted', async () => {
  const long = 'e'.repeat(64)
  const w = setup({ info: { headSha: long }, remote: { base: BASE, pulls: { 7: long } } })
  await w.build.ensureBuilt(7)
  assert.deepEqual(worktreeAdds(w), [BASE, long])
  assert.equal((await w.build.resolvePrImages(7)).label, '#7@eeeeeee')
})

test('a SHA from git that is not an object name stops the build before any checkout', async () => {
  const w = setup({ remote: { base: '../../etc', pulls: { 7: PR } } })
  await assert.rejects(w.build.ensureBuilt(7), /invalid SHA for refs\/qa\/base/)
  assert.deepEqual(worktreeAdds(w), [])
  assert.equal(w.fs.calls.some(c => c[0] === 'rm'), false)
})

test('a cloneUrl carrying credentials is rejected at construction, without echoing them', () => {
  const make = cloneUrl => setup({ cloneUrl })
  for (const url of [
    'https://x-access-token:ghp_SECRET@github.com/acme/widget.git',
    'https://ghp_SECRET@github.com/acme/widget.git',
    'ssh://git:ghp_SECRET@github.com/acme/widget.git',
    'deploy:ghp_SECRET@github.com:acme/widget.git',
  ]) {
    assert.throws(() => make(url), err => /must not contain credentials/.test(err.message) && !err.message.includes('ghp_SECRET'), url)
  }
  for (const url of ['https://github.com/acme/widget.git', 'git@github.com:acme/widget.git', 'ssh://git@github.com/acme/widget.git', '/srv/git/widget.git', 'file:///srv/git/widget.git']) {
    assert.doesNotThrow(() => make(url), url)
  }
  assert.throws(() => make('--upload-pack=touch /tmp/x'), /cloneUrl/)
})

test('construction validates the trust config, so a misconfigured gate fails loudly instead of open', () => {
  const base = { repo: REPO, cacheDir: CACHE, github: fakeGithub(), servicesFor: dir => ({ app: dir }) }
  const bad = [
    [{ logins: 'alice' }, /trust\.logins must be an array of GitHub logins/],
    [{ logins: 'carol,dave' }, /trust\.logins must be an array/],
    [{ associations: 'OWNER' }, /trust\.associations must be an array of author associations/],
    [{ logins: [null] }, /trust\.logins must be an array/],
    [{ logins: ['alice', ''] }, /trust\.logins must be an array/],
    [{ requirePush: 'false' }, /trust\.requirePush must be true or false/],
    [{ allowForks: 'no' }, /trust\.allowForks must be true or false/],
  ]
  for (const [trust, re] of bad) assert.throws(() => createWorktreeBuild({ ...base, trust }), re, JSON.stringify(trust))
  assert.throws(() => createWorktreeBuild({ ...base, trust: 'alice' }), /trust must be an object/)
  assert.throws(() => createWorktreeBuild({ ...base, trust: ['alice'] }), /trust must be an object/)
  for (const trust of [{ logins: new Set(['carol']) }, { logins: null }, {}, null]) {
    assert.doesNotThrow(() => createWorktreeBuild({ ...base, trust }), JSON.stringify(trust))
  }
})

test('a Set of logins is trusted like an array', async () => {
  const w = setup({ info: { author: 'carol', authorAssociation: 'NONE' }, trust: { logins: new Set(['Carol']) } })
  await w.build.ensureBuilt(7)
  assert.deepEqual(worktreeAdds(w), [BASE, PR])
})

test('construction validates the repo, github, servicesFor, baseRef, keep and install', () => {
  const base = { repo: REPO, cacheDir: CACHE, github: fakeGithub(), servicesFor: dir => ({ app: dir }) }
  const bad = [
    [{ repo: 'widget' }, /repo/],
    [{ cacheDir: undefined }, /cacheDir/],
    [{ github: { prInfo: async () => ({}) } }, /authorPermission/],
    [{ github: { authorPermission: async () => 'write' } }, /prInfo/],
    [{ servicesFor: null }, /servicesFor/],
    [{ baseRef: 'main:evil' }, /baseRef/],
    [{ baseRef: '../main' }, /baseRef/],
    [{ baseRef: '-main' }, /baseRef/],
    [{ keep: -1 }, /keep/],
    [{ keep: 1.5 }, /keep/],
    [{ install: { args: ['install'] } }, /install\.cmd/],
    [{ install: { cmd: 'pnpm', args: 'install' } }, /install\.args/],
  ]
  for (const [over, re] of bad) assert.throws(() => createWorktreeBuild({ ...base, ...over }), re, JSON.stringify(over))
  assert.equal(createWorktreeBuild(base).migrationStrategy, 'on-boot')
  assert.equal(createWorktreeBuild({ ...base, migrationStrategy: 'none' }).migrationStrategy, 'none')
})

// --- resolve* ---------------------------------------------------------------------

test('resolve* return the worktree services, no migrate, and path-free labels', async () => {
  const w = setup()
  await assert.rejects(w.build.resolvePrImages(7), /PR #7 has not been built/)
  await w.build.ensureBuilt(7)
  const pr = await w.build.resolvePrImages(7)
  const base = await w.build.resolveBaseImages()
  assert.deepEqual(pr, { services: { app: WT(PR) }, migrate: null, label: '#7@bbbbbbb' })
  assert.deepEqual(base, { services: { app: WT(BASE) }, migrate: null, label: 'main@aaaaaaa' })
  assert.deepEqual(w.services, [[WT(PR), { role: 'pr', sha: PR }], [WT(BASE), { role: 'base', sha: BASE }]])
  for (const { label } of [pr, base]) {
    assert.ok(!label.includes('/') && !label.includes(':'), label)
  }
})

// --- describePrs --------------------------------------------------------------------

test('describePrs reports blocked, building, built and none, with runUrl always null', async () => {
  const D = sha('d')
  const block = blockingInstall()
  const w = setup({
    remote: { base: BASE, pulls: { 7: PR, 8: D } },
    info: n => ({ headSha: n === 8 ? D : PR }),
    onInstall: (args, opts) => (opts.cwd === WT(D) ? block.handler(args, opts) : { stdout: '' }),
  })
  await w.build.ensureBuilt(7)
  const building = w.build.ensureBuilt(8)
  await block.started

  const rows = await w.build.describePrs([
    { number: 7, headSha: PR, ...trusted() },
    { number: 8, headSha: D, ...trusted() },
    { number: 9, headSha: sha('e'), ...trusted() },
    { number: 10, headSha: sha('f'), ...trusted({ author: 'mallory', authorAssociation: 'CONTRIBUTOR', headRepo: 'mallory/widget', headOwner: 'mallory' }) },
    { number: 11, headSha: PR, ...trusted({ headRepo: 'mallory/widget', headOwner: 'mallory' }) },
    { number: 12, headSha: PR, author: 'mallory' }, // no authorAssociation (e.g. a prHead fallback): not judged on trust
    { number: 13, headSha: 'nonsense', ...trusted() },
  ])
  assert.deepEqual(rows, [
    { number: 7, status: 'built', runUrl: null },
    { number: 8, status: 'building', runUrl: null },
    { number: 9, status: 'none', runUrl: null },
    { number: 10, status: 'blocked', runUrl: null, reason: 'author association CONTRIBUTOR is not trusted' },
    { number: 11, status: 'blocked', runUrl: null, reason: "head branch is in @mallory's fork (mallory/widget), not the author's" },
    { number: 12, status: 'built', runUrl: null },
    { number: 13, status: 'none', runUrl: null },
  ])
  assert.equal(w.github.calls.filter(c => c[0] === 'prInfo').length, 2, 'describePrs never calls prInfo')
  block.release()
  await building
  assert.equal((await w.build.describePrs([{ number: 8, headSha: D, ...trusted() }]))[0].status, 'built')
})

test('describePrs memoizes authorPermission per login for 5 minutes and fails closed on errors', async () => {
  let carolFails = true
  const w = setup({ permission: login => (login === 'carol' && carolFails ? new Error('github 502') : login === 'dave' ? 'read' : 'write') })
  const items = [
    { number: 1, headSha: PR, ...trusted() },
    { number: 2, headSha: PR, ...trusted({ author: 'ALICE', headOwner: 'acme' }) },
    { number: 3, headSha: PR, ...trusted({ author: 'carol' }) },
    { number: 4, headSha: PR, ...trusted({ author: 'dave' }) },
  ]
  const lookups = () => w.github.calls.filter(c => c[0] === 'authorPermission').map(c => c[1].toLowerCase()).sort()
  const rows = await w.build.describePrs(items)
  assert.deepEqual(rows.map(r => r.status), ['none', 'none', 'blocked', 'blocked'])
  assert.match(rows[2].reason, /could not check @carol's permission: github 502/)
  assert.match(rows[3].reason, /@dave has read access/)
  assert.deepEqual(lookups(), ['alice', 'carol', 'dave'])

  carolFails = false
  w.now.t += 4 * 60_000
  const again = await w.build.describePrs(items)
  assert.equal(again[2].status, 'none', 'a failed lookup is not cached')
  assert.deepEqual(lookups(), ['alice', 'carol', 'carol', 'dave'])

  w.now.t += 61_000 // past five minutes since the first lookups; carol's is only 61 s old
  await w.build.describePrs(items)
  assert.deepEqual(lookups(), ['alice', 'alice', 'carol', 'carol', 'dave', 'dave'])
})

// --- progress -------------------------------------------------------------------------

test('progress messages reach the subscriber as { message }, and subscriber errors are swallowed', async () => {
  const w = setup()
  await w.build.ensureBuilt(7)
  assert.deepEqual(w.messages(), [
    'fetching acme/widget…',
    'checking out base (aaaaaaa)…',
    'installing dependencies for base (aaaaaaa)…',
    'checking out #7 (bbbbbbb)…',
    'installing dependencies for #7 (bbbbbbb)…',
  ])
  assert.ok(w.events.every(e => Object.keys(e).length === 1 && typeof e.message === 'string'))

  const sync = setup()
  sync.build.subscribeBuild(() => { throw new Error('ui gone') })
  await sync.build.ensureBuilt(7)
  const unhandled = []
  const onUnhandled = err => unhandled.push(err)
  process.on('unhandledRejection', onUnhandled)
  try {
    const rejecting = setup()
    rejecting.build.subscribeBuild(async () => { throw new Error('ui gone') })
    await rejecting.build.ensureBuilt(7)
    await flush()
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  assert.deepEqual(unhandled, [])
})
