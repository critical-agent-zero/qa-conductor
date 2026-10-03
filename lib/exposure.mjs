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
// viewer sees and the mount behind it can't disagree. No I/O here: the
// adapter owns every effect, and runExpose (the qa-conductor-expose bin's
// core) prints through the log it is given.

import { defaultExposure, defaultHarnessOrigin, EXPOSURE_MODES, HARNESS_PATH } from './config.mjs'
import { hostPort, portOf, webOrigin } from './net.mjs'

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
function messageOf(err) {
  try {
    return String(err?.message ?? err)
  } catch {
    return 'the exposure adapter threw a value that is not an Error'
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
// in place; 1: drift remains, or the adapter failed; 2: a config or mount
// layout no front door can publish. Never rejects for anything the adapter
// does.
export async function runExpose({ cfg, exposure, checkOnly = false, log = console }) {
  // A cfg with no exposure or harnessOrigin resolves both as startConductor
  // does; loadConfig's always has both.
  let harnessOrigin, mode
  try {
    const host = cfg.host ?? '127.0.0.1'
    harnessOrigin = cfg.harnessOrigin ?? defaultHarnessOrigin({ publicHost: cfg.publicHost, host, port: cfg.ports?.harness })
    mode = cfg.exposure ?? defaultExposure({
      harnessOrigin, paneOrigins: cfg.paneOrigins, publicHost: cfg.publicHost, allowedHosts: cfg.allowedHosts ?? [], host,
    }).mode
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
  let mounts
  try {
    mounts = mountsFor({ ...cfg, harnessOrigin })
  } catch (err) {
    log.error(`qa exposure: ${String(err.message).replace(/^exposure: /, '')}`)
    return 2
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
