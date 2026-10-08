// The Exposure seam's pure core: the public endpoints the conductor declares,
// and one reconcile pass over an adapter that makes them exist.
//
// An Exposure adapter (optional, injected by the platform; the core never
// constructs one) publishes Mounts on a front door such as tailscale serve:
//   Mount    = { name: 'harness'|'base'|'pr', host, port, path, target }
//   Drift    = { mount: Mount, actual: string | null }
//   Exposure = { ensure(mounts) -> Promise<{ added: Mount[], ok: Mount[] }>,
//                check(mounts)  -> Promise<{ ok: boolean, drift: Drift[] }> }
// `host` and `port` are the mount's public side, from its own origin;
// `target` is where the conductor listens, on cfg.host. A mount is the
// conductor's own (port, path): an adapter never touches any other handler.
//
// mountsFor derives every mount from the origins viewers open, so the URL a
// viewer sees and the mount behind it can't disagree. No I/O here but
// through what callers inject: the adapter owns every front-door effect, and
// runExpose (the qa-conductor-expose bin's core) probes its targets through
// the fetchFn it is given and prints through the log it is given.

import http from 'node:http'

import { defaultExposure, defaultHarnessOrigin, EXPOSURE_MODES, HARNESS_PATH } from './config.mjs'
import { isIdentityRefusal } from './identity.mjs'
import { hostPort, isLoopbackHost, portOf, webOrigin } from './net.mjs'

const ORIGINS = [
  ['harness', 'the harness origin (QA_HARNESS_ORIGIN)'],
  ['base', 'the base pane origin (QA_BASE_ORIGIN)'],
  ['pr', 'the PR pane origin (QA_PR_ORIGIN)'],
]

const shown = value => (typeof value === 'string' ? JSON.stringify(value) : String(value))

// The three mounts for `cfg`: the harness under HARNESS_PATH at
// cfg.harnessOrigin's port, each pane at / at its origin's port. `ports` are
// the listen ports the targets point at; pass the bound ones when cfg.ports
// holds 0. Throws on a layout no adapter can publish.
export function mountsFor(cfg, { ports = cfg.ports } = {}) {
  if (!cfg.harnessOrigin) throw new Error('exposure: no harness origin to mount (set QA_HARNESS_ORIGIN)')
  const bind = cfg.host ?? '127.0.0.1'
  const mounts = ORIGINS.map(([name, what]) => {
    const value = name === 'harness' ? cfg.harnessOrigin : cfg.paneOrigins?.[name]
    if (value == null || value === '') throw new Error(`exposure: ${what} is missing`)
    const origin = webOrigin(value, `exposure: ${what}`)
    // tailscale serve publishes https only
    if (!origin.startsWith('https:')) throw new Error(`exposure: ${what} ${origin} is not https, and only an https origin can be mounted`)
    // The URL parser takes port 0, and no front door can listen there.
    const port = portOf(origin)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`exposure: ${what} ${origin} has no port a front door can listen on`)
    const listen = ports?.[name]
    if (!Number.isInteger(listen) || listen < 1 || listen > 65535) {
      throw new Error(`exposure: the ${name} listen port must be an integer from 1 to 65535, got ${shown(listen)} (pass the bound ports)`)
    }
    return {
      name,
      host: new URL(origin).hostname,
      port,
      path: name === 'harness' ? HARNESS_PATH : '/',
      target: `http://${hostPort(bind, listen)}`,
    }
  })
  // `serve --https=<port>` publishes on this node's name whatever the host, so
  // two mounts on one port would share an origin, and the harness and the
  // two panes must be three different origins.
  for (const [i, a] of mounts.entries()) {
    for (const b of mounts.slice(i + 1)) {
      if (a.port === b.port) throw new Error(`exposure: the ${a.name} and ${b.name} mounts are both on port ${a.port}: each needs a port of its own`)
    }
  }
  return mounts
}

// One pass: ensure then check, or check alone with checkOnly. Never rejects:
// exposure trouble must not take the conductor down, so an error comes back
// as { ok: false, error }, keeping whatever ensure added: all of it when the
// check fails, and the error's own `added` list when ensure fails part way.
export async function reconcileExposure(exposure, mounts, { checkOnly = false, now = Date.now } = {}) {
  let added = []
  try {
    if (!checkOnly) {
      const ensured = await exposure.ensure(mounts)
      if (!Array.isArray(ensured?.added)) throw new Error('the exposure adapter\'s ensure returned no added list')
      added = ensured.added
    }
    const checked = await exposure.check(mounts)
    if (!Array.isArray(checked?.drift)) throw new Error('the exposure adapter\'s check returned no drift list')
    return { ok: checked.ok === true && checked.drift.length === 0, checkedAt: now(), drift: checked.drift, added, error: null }
  } catch (err) {
    return { ok: false, checkedAt: now(), drift: [], added: addedOn(err) ?? added, error: messageOf(err) }
  }
}

// The adapter is platform code and may throw anything: a value with no
// primitive form (Object.create(null)), or one whose getters throw, must not
// turn the result into a rejection.
function messageOf(err, fallback = 'the exposure adapter threw a value that is not an Error') {
  try {
    return String(err?.message ?? err)
  } catch {
    return fallback
  }
}

function addedOn(err) {
  try {
    return Array.isArray(err?.added) ? err.added : null
  } catch {
    return null
  }
}

// The expose CLI's core: one pass for `cfg` over `exposure`, printed for an
// operator, as an exit code. It is the conductor's own pass (mountsFor, then
// reconcileExposure) on the configured ports, so the two can't disagree
// about what should be mounted. 0: nothing to do (none mode), or every mount
// in place; 1: drift remains, or the adapter failed; 2: a mode, bind host or
// mount layout the conductor would refuse or no front door can publish, or
// (without checkOnly) a target that isn't a gated conductor. Never rejects
// for anything the adapter or fetchFn does.
//
// Without checkOnly it first asks every target whether it is a conductor in
// tailscale mode, and writes nothing unless all three are (see
// ungatedTargets). The conductor's own loop doesn't ask: it publishes only
// itself, and only in tailscale mode. fetchFn is fetch-shaped; the default
// is loopbackFetch, plain HTTP.
export async function runExpose({ cfg, exposure, checkOnly = false, log = console, fetchFn = loopbackFetch, probeTimeoutMs = 5000 }) {
  // setTimeout clamps anything else to 1ms, which would refuse every target.
  if (!Number.isInteger(probeTimeoutMs) || probeTimeoutMs < 1 || probeTimeoutMs > MAX_TIMER_MS) {
    log.error(`qa exposure: probeTimeoutMs must be a whole number of milliseconds from 1 to ${MAX_TIMER_MS}, got ${shown(probeTimeoutMs)}`)
    return 2
  }
  // A cfg with no exposure or harnessOrigin resolves both as startConductor
  // does; loadConfig's always has both.
  let host, harnessOrigin, mode, because
  try {
    host = cfg.host ?? '127.0.0.1'
    // startConductor refuses this too: every target would be http://[[::1]]:port.
    if (/^\[.*\]$/.test(host)) {
      throw new Error(`the bind host (QA_BIND_HOST, cfg.host) takes an IPv6 literal without brackets, as the conductor requires: use ${JSON.stringify(host.slice(1, -1))}, not ${JSON.stringify(host)}`)
    }
    harnessOrigin = cfg.harnessOrigin ?? defaultHarnessOrigin({ publicHost: cfg.publicHost, host, port: cfg.ports?.harness })
    // `because` names what made a defaulted mode tailscale, for the error below
    const resolved = cfg.exposure != null ? { mode: cfg.exposure, because: null } : defaultExposure({
      harnessOrigin, paneOrigins: cfg.paneOrigins, publicHost: cfg.publicHost, allowedHosts: cfg.allowedHosts ?? [], host,
    })
    mode = resolved.mode
    because = resolved.because
  } catch (err) {
    log.error(`qa exposure: ${err.message}`)
    return 2
  }
  if (!EXPOSURE_MODES.includes(mode)) {
    log.error(`qa exposure: QA_EXPOSURE must be none or tailscale, got ${shown(mode)}`)
    return 2
  }
  // An ungated conductor must not publish itself, so there is nothing to do.
  if (mode === 'none') {
    log.log('qa exposure: QA_EXPOSURE=none, nothing to do')
    return 0
  }
  // The identity gate trusts Tailscale-User-Login only on a loopback bind, so
  // loadConfig and startConductor refuse tailscale mode anywhere else, and
  // the CLI must not publish a layout the conductor won't run.
  if (!isLoopbackHost(host)) {
    const why = because ? `QA_EXPOSURE defaults to tailscale because ${because} is not loopback` : 'QA_EXPOSURE is tailscale'
    log.error(`qa exposure: ${why}, and the conductor runs tailscale mode only on a loopback bind host (QA_BIND_HOST, cfg.host), got ${JSON.stringify(host)}`)
    return 2
  }
  let mounts
  try {
    mounts = mountsFor({ ...cfg, harnessOrigin })
  } catch (err) {
    log.error(`qa exposure: ${String(err.message).replace(/^exposure: /, '')}`)
    return 2
  }
  // A mount outlives whatever answers behind it, so write none unless every
  // target is the gate: all or nothing.
  if (!checkOnly) {
    const problems = await ungatedTargets(mounts, { fetchFn, timeoutMs: probeTimeoutMs })
    if (problems.length > 0) {
      for (const problem of problems) log.error(`qa exposure: ${problem}`)
      log.error('qa exposure: nothing was mounted. Start the conductor in tailscale mode on these ports first, or use --check to only report drift')
      return 2
    }
  }
  const result = await reconcileExposure(exposure, mounts, { checkOnly })
  try {
    report(result, log)
  } catch {
    // The adapter is platform code: a mount whose getters throw.
    log.error('qa exposure: the adapter returned a result that cannot be printed')
    return 1
  }
  if (result.ok) {
    log.log(`qa exposure: ok (harness ${webOrigin(harnessOrigin)}${HARNESS_PATH}/)`)
    return 0
  }
  return 1
}

// The most a timer can wait (2^31 - 1 ms); setTimeout clamps more to 1ms.
const MAX_TIMER_MS = 2 ** 31 - 1

// What answers at each mount's target, asked over loopback as a client with
// no Tailscale identity would be: the harness at its state route, each pane
// at /. A conductor in tailscale mode answers with the identity gate's 403,
// marked X-QA-Refusal: identity (isIdentityRefusal); an answer, any other
// 403, a redirect (never followed) or no answer within timeoutMs means the
// target isn't a gated conductor. Resolves one line for each target that
// isn't, in mount order. Each answer's body is freed unread. Never rejects,
// whatever fetchFn throws or returns.
async function ungatedTargets(mounts, { fetchFn, timeoutMs }) {
  const lines = await Promise.all(mounts.map(async mount => {
    const url = `${mount.target}${mount.name === 'harness' ? `${HARNESS_PATH}/api/state` : '/'}`
    // A timer of our own, not AbortSignal.timeout's: that one doesn't keep
    // the process alive, so a fetchFn holding no socket open would let the
    // process exit before it fired. Raced too, for a fetchFn that ignores
    // its signal.
    const ac = new AbortController()
    let timer
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ac.abort()
        reject(new Error('timed out'))
      }, timeoutMs)
    })
    let res
    try {
      const call = Promise.resolve().then(() => fetchFn(url, { method: 'GET', redirect: 'manual', signal: ac.signal }))
      // A late answer is still freed, and a late rejection handled.
      call.then(late => { if (ac.signal.aborted) freeBody(late) }, () => {})
      res = await Promise.race([call, timedOut])
    } catch (err) {
      return notGated(mount, ac.signal.aborted ? `no answer within ${timeoutMs}ms` : noAnswer(err))
    } finally {
      clearTimeout(timer)
    }
    try {
      freeBody(res)
      if (isIdentityRefusal(res)) return null
      const status = res?.status
      if (!Number.isInteger(status)) return notGated(mount, 'got no response')
      return notGated(mount, status === 403 ? 'got 403 without X-QA-Refusal: identity' : `got ${status}`)
    } catch {
      return notGated(mount, 'got a response that cannot be read')
    }
  }))
  return lines.filter(line => line !== null)
}

// Freed, not awaited: a body that never settles mustn't hold the run.
function freeBody(res) {
  try { res?.body?.cancel?.()?.catch?.(() => {}) } catch { /* nothing to free */ }
}

const notGated = (mount, why) => `${new URL(mount.target).host} (${mount.name}) is not a gated conductor (${why}); refusing to publish it`

// Why a probe got no answer: node:http rejects with the socket error, fetch
// with a TypeError whose cause holds it.
function noAnswer(err) {
  let code
  try { code = err?.cause?.code ?? err?.code } catch { code = undefined }
  if (code === 'ECONNREFUSED') return 'nothing listens there'
  if (typeof code === 'string') return `no answer: ${code}`
  let cause
  try { cause = err?.cause } catch { cause = undefined }
  return `no answer: ${messageOf(cause ?? err, 'fetchFn threw a value that is not an Error')}`
}

// The default fetchFn: fetch's shape (status, headers.get, body.cancel) over
// node:http, one connection per request. Unlike fetch it has no list of
// ports it refuses (fetch refuses 6000 and 10080, among others, which a
// conductor may listen on), reads no proxy from the environment, and never
// follows a redirect.
function loopbackFetch(url, { method = 'GET', signal } = {}) {
  return new Promise((resolve, reject) => {
    const answer = (res, done) => resolve({
      status: res.statusCode,
      headers: {
        get: name => {
          const value = res.headers[String(name).toLowerCase()]
          return value === undefined ? null : Array.isArray(value) ? value.join(', ') : String(value)
        },
      },
      body: { cancel: async () => { done() } },
    })
    const req = http.request(url, { method, signal, agent: false }, res => answer(res, () => res.destroy()))
    // A 101 with Upgrade comes here, not to the callback above: an answer
    // all the same (not the gate's), and its socket is closed at once.
    req.on('upgrade', (res, socket) => {
      socket.destroy()
      answer(res, () => {})
    })
    req.on('error', reject)
    // Any other way the request ends without an answer: a no-op once settled.
    req.on('close', () => reject(new Error('the connection closed without a response')))
    req.end()
  })
}

function report(result, log) {
  for (const m of result.added) log.log(`qa exposure: mounted ${at(m)} -> ${field(m?.target)}`)
  for (const { mount, actual } of result.drift) {
    // A handler under the mount's path, which check names by its path: no
    // ensure replaces it, since it isn't the conductor's.
    if (typeof actual === 'string' && actual.startsWith('/')) {
      log.error(`qa exposure: drift ${at(mount)}: the handler at ${actual} takes some of its requests; remove it`)
    } else {
      log.error(`qa exposure: drift ${at(mount)}: want ${field(mount?.target)}, have ${typeof actual === 'string' ? actual : 'nothing'}`)
    }
  }
  if (result.error !== null) log.error(`qa exposure: ${result.error}`)
  else if (!result.ok && result.drift.length === 0) log.error('qa exposure: the adapter reported drift but named no mount')
}

// A mount as the adapter returned it, printed: only the Mount type's own
// values (a string, an integer port) are shown, anything else as `?`.
const field = value => (typeof value === 'string' || Number.isInteger(value) ? String(value) : '?')
const at = m => `${field(m?.port)}${field(m?.path)}`
