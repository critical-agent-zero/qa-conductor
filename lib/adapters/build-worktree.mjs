// git-worktree BuildConvention: the built-in "build" for consumers that run a
// PR straight from its source instead of from CI-built images.
//
// For a PR it fetches the base branch and the PR head into a bare repository
// under `cacheDir`, checks each SHA out into its own worktree
// (`worktrees/<sha>`), optionally installs dependencies there, and records a
// marker outside the checkout (`built/<sha>.json`) so the next boot of the same
// SHA is instant. `servicesFor(dir, { role, sha })` turns a worktree into the
// Provisioner's service refs.
//
// This checks out and installs a PR's code on the reviewer's machine, so the
// trust gate (`trustDecision`) is the only real boundary: ensureBuilt refuses
// an untrusted PR before any git call, and only the exact SHA that passed the
// gate is ever checked out or installed. The installer's scrubbed env
// (PATH, HOME and install.env only) is defence in depth, not a sandbox.
//
// Builds run one at a time per instance. Effects (execFileFn, fsx, baseEnv,
// nowFn) are injected, so it is unit-tested with no real git or processes.

import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { makeExecFileFn } from '../exec.mjs'

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/
const REPO_RE = /^[\w.-]+\/[\w.-]+$/
const DEFAULT_TRUST = { logins: [], associations: ['OWNER', 'MEMBER', 'COLLABORATOR'], requirePush: true, allowForks: true }
const PUSH_PERMISSIONS = ['admin', 'write']
const PERMISSION_TTL_MS = 5 * 60_000
const TAIL_LINES = 40
const TAIL_BYTES = 8192

const lower = s => String(s ?? '').toLowerCase()
const sha7 = sha => sha.slice(0, 7)
const abortError = () => Object.assign(new Error('build aborted'), { name: 'AbortError' })
const throwIfAborted = signal => { if (signal?.aborted) throw abortError() }

// A string is iterable, so `logins: 'alice'` would spread into one-character
// logins and widen the allowlist. Anything but a list of non-empty strings
// throws: at construction, and inside trustDecision it fails closed.
function stringList(value, key, what) {
  if (value == null) return []
  const list = value instanceof Set ? [...value] : value
  if (!Array.isArray(list) || !list.every(s => typeof s === 'string' && s.trim() !== '')) {
    throw new Error(`trust.${key} must be an array of ${what}`)
  }
  return list.map(s => s.trim())
}

function flag(value, key) {
  if (value == null) return DEFAULT_TRUST[key]
  if (typeof value !== 'boolean') throw new Error(`trust.${key} must be true or false`)
  return value
}

// A partial `trust` must never switch a check off by omission: missing keys
// take the defaults, and only an explicit `false` disables a check.
function normalizeTrust(trust) {
  if (trust != null && (typeof trust !== 'object' || Array.isArray(trust))) throw new Error('trust must be an object')
  const t = { ...DEFAULT_TRUST, ...trust }
  return {
    logins: stringList(t.logins, 'logins', 'GitHub logins').map(lower),
    associations: stringList(t.associations, 'associations', 'author associations').map(s => s.toUpperCase()),
    requirePush: flag(t.requirePush, 'requirePush'),
    allowForks: flag(t.allowForks, 'allowForks'),
  }
}

function isAllowlisted(info, t) {
  return !!info?.author && t.logins.includes(lower(info.author))
}

// Whether trustDecision will need the author's repo permission.
function permissionNeeded(info, t) {
  return t.requirePush && !isAllowlisted(info, t) && t.associations.includes(String(info?.authorAssociation).toUpperCase())
}

// Is this PR's code safe to check out and run on the reviewer's machine?
// `info` is a github.prInfo result (or a listOpenPrs item). `permission` is the
// author's repo permission, needed only when an association has to be backed
// by push access: author_association alone is not an access check, since
// COLLABORATOR includes read-only outside collaborators and MEMBER includes
// org members with no push access. Any error fails closed.
//
// It vouches for the author and where the head lives, not for every commit on
// the head branch: anyone who can push to the author's fork can move it.
// `allowForks: false` requires a head in the repo itself.
export function trustDecision(info, { repo, trust, permission } = {}) {
  try {
    const t = normalizeTrust(trust)
    const author = info.author
    if (!isAllowlisted(info, t)) {
      const association = String(info.authorAssociation ?? 'NONE').toUpperCase()
      if (!t.associations.includes(association)) return { ok: false, reason: `author association ${association} is not trusted` }
      if (t.requirePush && !PUSH_PERMISSIONS.includes(permission)) {
        const has = permission === 'none' ? 'no' : permission || 'unknown'
        return { ok: false, reason: `@${author} has ${has} access; push access is required` }
      }
    }
    if (info.headRepo == null) return { ok: false, reason: 'head repository was deleted' }
    if (lower(info.headRepo) !== lower(repo)) {
      const authorsFork = !!author && lower(info.headOwner) === lower(author)
      if (!authorsFork) return { ok: false, reason: `head branch is in @${info.headOwner}'s fork (${info.headRepo}), not the author's` }
      if (!t.allowForks) return { ok: false, reason: `head branch is in a fork (${info.headRepo}) and trust.allowForks is off` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `trust check failed: ${err?.message ?? err}` }
  }
}

function validSha(value, what) {
  const sha = typeof value === 'string' ? value.trim() : ''
  if (!SHA_RE.test(sha)) throw new Error(`invalid SHA for ${what}: ${JSON.stringify(String(value)).slice(0, 80)}`)
  return sha
}

function assertPrNumber(pr) {
  if (!Number.isSafeInteger(pr) || pr <= 0) throw new Error(`invalid PR number: ${typeof pr === 'string' ? JSON.stringify(pr) : String(pr)}`)
}

// Tokens belong in a git credential helper, never in the URL: the URL lands in
// argv (visible in `ps`) and in git's own error messages. The message never
// echoes the URL.
function assertCloneUrl(url) {
  if (typeof url !== 'string' || !url.trim() || url.startsWith('-')) throw new Error('cloneUrl must be a URL or a path')
  const refuse = () => { throw new Error('cloneUrl must not contain credentials; use a git credential helper') }
  let parsed = null
  try { parsed = new URL(url) } catch { /* scp-like (git@host:path) or a local path */ }
  if (parsed && url.slice(parsed.protocol.length).startsWith('//')) {
    const sshUser = parsed.protocol === 'ssh:' && !parsed.password
    if (parsed.password || (parsed.username && !sshUser)) refuse()
  } else if (/^[^/@:]+:[^/@]*@/.test(url)) {
    refuse() // user:secret@host:path
  }
}

function assertBaseRef(ref) {
  const ok = typeof ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) &&
    !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/') && !ref.endsWith('.lock')
  if (!ok) throw new Error(`invalid baseRef: ${JSON.stringify(ref)}`)
}

function assertInstall(install) {
  if (install === null) return
  if (typeof install?.cmd !== 'string' || !install.cmd) throw new Error('install.cmd must be a non-empty string')
  if (install.args !== undefined && !(Array.isArray(install.args) && install.args.every(a => typeof a === 'string'))) {
    throw new Error('install.args must be an array of strings')
  }
  if (install.env !== undefined && (typeof install.env !== 'object' || install.env === null)) throw new Error('install.env must be an object')
}

// Markers are keyed on what shaped the install. Env values are left out so a
// rotated secret in install.env doesn't invalidate every build.
function installFingerprint(install) {
  const shape = install ? { cmd: install.cmd, args: install.args ?? [], envKeys: Object.keys(install.env ?? {}).sort() } : null
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex')
}

// The last TAIL_LINES lines, at most TAIL_BYTES, of a failed exec's output.
// U1's exec errors carry stdout/stderr; older ones only a message.
function logTailOf(err) {
  const stdout = err?.stdout == null ? '' : String(err.stdout)
  const stderr = err?.stderr == null ? '' : String(err.stderr)
  let text = stdout && stderr && !stdout.endsWith('\n') ? `${stdout}\n${stderr}` : stdout + stderr
  if (!text.trim()) text = String(err?.message ?? err ?? '')
  const tail = text.replace(/\s+$/, '').split('\n').slice(-TAIL_LINES).join('\n')
  let buf = Buffer.from(tail, 'utf8')
  if (buf.length <= TAIL_BYTES) return tail
  buf = buf.subarray(buf.length - TAIL_BYTES)
  let i = 0
  while (i < buf.length && (buf[i] & 0xc0) === 0x80) i++ // don't start mid-character
  return buf.subarray(i).toString('utf8')
}

export function createWorktreeBuild({
  repo,
  cloneUrl = `https://github.com/${repo}.git`,
  cacheDir,
  github,
  servicesFor,
  install = null,
  baseRef = 'main',
  trust = DEFAULT_TRUST,
  keep = 6,
  migrationStrategy = 'on-boot',
  execFileFn = makeExecFileFn(),
  fsx = fsp,
  baseEnv = process.env,
  nowFn = Date.now,
} = {}) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new Error(`repo must be 'owner/name', got ${JSON.stringify(repo)}`)
  if (typeof cacheDir !== 'string' || !cacheDir) throw new Error('cacheDir is required')
  if (typeof github?.prInfo !== 'function') throw new Error('github must provide prInfo(num)')
  if (typeof github?.authorPermission !== 'function') throw new Error('github must provide authorPermission(login)')
  if (typeof servicesFor !== 'function') throw new Error('servicesFor(worktreeDir, { role, sha }) is required')
  if (!Number.isSafeInteger(keep) || keep < 0) throw new Error('keep must be a non-negative integer')
  assertCloneUrl(cloneUrl)
  assertBaseRef(baseRef)
  assertInstall(install)

  const trustCfg = normalizeTrust(trust)
  const root = path.resolve(cacheDir)
  const bare = path.join(root, 'repo.git')
  const worktreesRoot = path.join(root, 'worktrees')
  const builtDir = path.join(root, 'built')
  const fingerprint = installFingerprint(install)
  const worktreeDir = sha => path.join(worktreesRoot, sha)
  const markerPath = sha => path.join(builtDir, `${sha}.json`)

  // The SHAs the last live ensureBuilt resolved, for resolve*.
  const resolved = { base: null, prs: new Map() }
  // SHAs whose build holds the lock (describePrs reports them as building).
  let building = new Set()
  let listener = null
  const permissionCache = new Map()

  function progress(message) {
    if (!listener) return
    try {
      const out = listener({ message })
      if (typeof out?.then === 'function') out.then(undefined, () => {})
    } catch { /* a broken subscriber must never fail a build */ }
  }

  // --- the lock: one build at a time -----------------------------------------
  // Callers queue on a promise chain that never rejects. A waiter never
  // shares the holder's promise, because an aborted holder's AbortError must
  // not reach a live boot: it waits, then runs the whole build itself.
  let lockTail = Promise.resolve()
  let lockUsers = 0
  async function withLock(fn) {
    const prev = lockTail
    let release
    lockTail = new Promise(resolve => { release = resolve })
    if (lockUsers++ > 0) progress('waiting for another build to finish…')
    try {
      await prev
      return await fn()
    } finally {
      lockUsers--
      release()
    }
  }

  // --- effects ---------------------------------------------------------------

  // No prompts (a missing credential fails instead of hanging) and no hooks:
  // `worktree add` runs post-checkout and ref updates run
  // reference-transaction, so a user-level core.hooksPath or init.templateDir
  // hook would otherwise run over PR code with this full env. Passed as env
  // config (GIT_CONFIG_COUNT), appended to any the operator already set.
  function gitEnv() {
    const env = { ...baseEnv, GIT_TERMINAL_PROMPT: '0' }
    const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0
    env.GIT_CONFIG_COUNT = String(n + 1)
    env[`GIT_CONFIG_KEY_${n}`] = 'core.hooksPath'
    env[`GIT_CONFIG_VALUE_${n}`] = '/dev/null'
    return env
  }
  const git = (args, signal) => execFileFn('git', ['--git-dir', bare, ...args], { signal, env: gitEnv() })
  const exists = p => fsx.lstat(p).then(() => true, () => false)

  // The only recursive delete: refuses anything outside worktrees/.
  async function rmrf(target) {
    const abs = path.resolve(target)
    if (!abs.startsWith(worktreesRoot + path.sep)) throw new Error(`refusing to delete ${abs}: outside ${worktreesRoot}`)
    await fsx.rm(abs, { recursive: true, force: true })
  }

  async function revParse(ref, signal) {
    const out = await git(['rev-parse', '--verify', ref], signal)
    return validSha(String(out?.stdout ?? ''), ref)
  }

  async function ensureBareRepo(signal) {
    await fsx.mkdir(worktreesRoot, { recursive: true, mode: 0o700 })
    await fsx.mkdir(builtDir, { recursive: true, mode: 0o700 })
    if (!(await exists(path.join(bare, 'HEAD')))) {
      await execFileFn('git', ['init', '--bare', bare], { signal, env: gitEnv() })
    }
  }

  async function readMarker(sha) {
    return JSON.parse(String(await fsx.readFile(markerPath(sha), 'utf8')))
  }

  // Built = a marker for this SHA and install shape, and its checkout present.
  async function isBuilt(sha) {
    try {
      const m = await readMarker(sha)
      return m?.sha === sha && m.installFingerprint === fingerprint && (await exists(worktreeDir(sha)))
    } catch {
      return false
    }
  }

  // --- trust ---------------------------------------------------------------------

  async function gate(info, getPermission) {
    let permission = null
    try {
      if (permissionNeeded(info, trustCfg)) permission = await getPermission(info.author)
    } catch (err) {
      return { ok: false, reason: `could not check @${info?.author}'s permission: ${err?.message ?? err}` }
    }
    return trustDecision(info, { repo, trust: trustCfg, permission })
  }

  const freshPermission = login => github.authorPermission(login)

  // The picker polls describePrs, so permission lookups are memoized per login
  // for five minutes. Failures aren't cached (they fail closed until retried).
  function cachedPermission(login) {
    const key = lower(login)
    const hit = permissionCache.get(key)
    if (hit && nowFn() - hit.at < PERMISSION_TTL_MS) return hit.promise
    const promise = Promise.resolve().then(() => github.authorPermission(login))
    permissionCache.set(key, { at: nowFn(), promise })
    promise.catch(() => { if (permissionCache.get(key)?.promise === promise) permissionCache.delete(key) })
    return promise
  }

  // The fetched head differs from the one we gated: accept it only if GitHub
  // now reports exactly that SHA and it passes the gate again.
  async function regate(pr, fetchedSha) {
    const moved = cause => new Error(`PR #${pr} head moved during fetch; retry`, cause ? { cause } : undefined)
    let again
    try { again = await github.prInfo(pr) } catch (err) { throw moved(err) }
    let sha = null
    try { sha = validSha(again?.headSha, `PR #${pr} head`) } catch { /* treated as moved */ }
    if (sha !== fetchedSha || !(await gate(again, freshPermission)).ok) throw moved()
  }

  // --- building ----------------------------------------------------------------

  async function runInstall(dir, tag, signal) {
    if (!install) return
    progress(`installing dependencies for ${tag}…`)
    // Nothing else from the conductor's env reaches PR code (no tokens).
    const env = {}
    for (const key of ['PATH', 'HOME']) if (baseEnv[key] !== undefined) env[key] = baseEnv[key]
    try {
      await execFileFn(install.cmd, install.args ?? [], { cwd: dir, signal, env: { ...env, ...install.env } })
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err
      const status = err?.code ?? err?.signal ?? 'abnormally'
      throw Object.assign(new Error(`install failed for ${tag}: ${install.cmd} exited ${status}`, { cause: err }), { logTail: logTailOf(err) })
    }
  }

  async function buildTree(sha, who, signal) {
    const tag = `${who} (${sha7(sha)})`
    if (await isBuilt(sha)) {
      progress(`${tag} already built`)
      return
    }
    throwIfAborted(signal)
    const dir = worktreeDir(sha)
    await git(['worktree', 'prune'], signal) // drop registrations whose directory is gone
    if (await exists(dir)) {
      // A previous build died part-way: start from a clean checkout.
      progress(`cleaning up a partial checkout of ${tag}…`)
      await git(['worktree', 'remove', '-f', '-f', dir], signal).catch(() => {})
      await rmrf(dir).catch(() => {})
      await git(['worktree', 'prune'], signal).catch(() => {})
    }
    progress(`checking out ${tag}…`)
    await git(['worktree', 'add', '-f', '-f', '--detach', dir, sha], signal)
    await runInstall(dir, tag, signal)
    // Last, so a marker always means a complete checkout and install.
    await fsx.writeFile(markerPath(sha), `${JSON.stringify({ sha, builtAt: nowFn(), installFingerprint: fingerprint })}\n`)
  }

  // Best-effort: keep the newest `keep` markers and the SHAs just built, and
  // clear everything else, including checkouts whose build never finished.
  async function prune(current, signal) {
    const report = (what, err) => progress(`could not prune ${what}: ${err?.message ?? err}`)
    try {
      const markers = []
      for (const name of await fsx.readdir(builtDir)) {
        const m = /^(.+)\.json$/.exec(name)
        if (!m || !SHA_RE.test(m[1])) continue
        let builtAt = 0
        try { builtAt = Number((await readMarker(m[1])).builtAt) || 0 } catch { /* unreadable: oldest */ }
        markers.push({ sha: m[1], builtAt })
      }
      markers.sort((a, b) => b.builtAt - a.builtAt || a.sha.localeCompare(b.sha))
      const retain = new Set([...markers.slice(0, keep).map(m => m.sha), ...current])
      const candidates = new Set(markers.map(m => m.sha))
      for (const name of await fsx.readdir(worktreesRoot).catch(() => [])) if (SHA_RE.test(name)) candidates.add(name)

      const stale = [...candidates].filter(sha => !retain.has(sha))
      for (const sha of stale) {
        try {
          // Marker first, so a half-removed tree can never count as built.
          await fsx.rm(markerPath(sha), { force: true })
          const dir = worktreeDir(sha)
          await git(['worktree', 'remove', '-f', '-f', dir], signal).catch(() => rmrf(dir))
        } catch (err) {
          report(sha7(sha), err)
        }
      }
      if (stale.length) await git(['worktree', 'prune'], signal).catch(err => report('stale worktrees', err))
    } catch (err) {
      report('the build cache', err)
    }
  }

  async function buildLocked(pr, headSha, signal) {
    throwIfAborted(signal)
    building = new Set([headSha])
    try {
      await ensureBareRepo(signal)
      progress(`fetching ${repo}…`)
      await git([
        'fetch', '--no-tags', cloneUrl,
        `+refs/heads/${baseRef}:refs/qa/base`,
        `+refs/pull/${pr}/head:refs/qa/pr-${pr}-incoming`,
      ], signal)
      const baseSha = await revParse('refs/qa/base', signal)
      const prSha = await revParse(`refs/qa/pr-${pr}-incoming`, signal)
      if (prSha !== headSha) await regate(pr, prSha)
      // From here on prSha is the gated SHA: it is the only PR code that gets
      // pinned, checked out or installed.
      await git(['update-ref', `refs/qa/pr-${pr}`, prSha], signal)
      if (!signal?.aborted) {
        resolved.base = baseSha
        resolved.prs.set(pr, prSha)
      }
      building = new Set([baseSha, prSha])
      await buildTree(baseSha, 'base', signal)
      await buildTree(prSha, `#${pr}`, signal)
      // An aborted signal fails every further exec, so there's nothing to gain.
      if (!signal?.aborted) await prune([baseSha, prSha], signal)
    } finally {
      building = new Set()
    }
  }

  return {
    migrationStrategy,

    // One subscriber, the latest: the core subscribes on every boot and runs
    // one session at a time.
    subscribeBuild(cb) { listener = cb },

    async ensureBuilt(pr, { signal } = {}) {
      assertPrNumber(pr)
      // The gate runs outside the lock and before any git call.
      const info = await github.prInfo(pr)
      const decision = await gate(info, freshPermission)
      if (!decision.ok) throw new Error(`PR #${pr} by @${info?.author ?? 'unknown'} is not from a trusted source: ${decision.reason}`)
      const headSha = validSha(info.headSha, `PR #${pr} head`)
      await withLock(() => buildLocked(pr, headSha, signal))
    },

    async resolvePrImages(pr) {
      assertPrNumber(pr)
      const sha = resolved.prs.get(pr)
      if (!sha) throw new Error(`PR #${pr} has not been built; call ensureBuilt first`)
      return { services: await servicesFor(worktreeDir(sha), { role: 'pr', sha }), migrate: null, label: `#${pr}@${sha7(sha)}` }
    },

    async resolveBaseImages() {
      const sha = resolved.base
      if (!sha) throw new Error('base has not been built; call ensureBuilt first')
      return { services: await servicesFor(worktreeDir(sha), { role: 'base', sha }), migrate: null, label: `${baseRef}@${sha7(sha)}` }
    },

    // Picker readiness for listOpenPrs items. Items without authorAssociation
    // (a bare { number, headSha }) aren't judged on trust; ensureBuilt still is.
    async describePrs(prs) {
      return Promise.all((prs ?? []).map(async item => {
        const row = { number: item?.number, status: 'none', runUrl: null }
        try {
          if (item.authorAssociation != null) {
            const decision = await gate(item, cachedPermission)
            if (!decision.ok) return { ...row, status: 'blocked', reason: decision.reason }
          }
          const sha = validSha(item.headSha, `PR #${item.number} head`)
          if (building.has(sha)) row.status = 'building'
          else if (await isBuilt(sha)) row.status = 'built'
        } catch { /* unknown readiness shows as none */ }
        return row
      }))
    },
  }
}
