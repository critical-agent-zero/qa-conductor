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
// adapter owns every effect.

import { HARNESS_PATH } from './config.mjs'
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
    const listen = ports?.[name]
    if (!Number.isInteger(listen) || listen < 1 || listen > 65535) {
      throw new Error(`exposure: the ${name} listen port must be an integer from 1 to 65535, got ${shown(listen)} (pass the bound ports)`)
    }
    return {
      name,
      host: new URL(origin).hostname,
      port: portOf(origin),
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
// as { ok: false, error }, keeping whatever ensure had already added.
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
    return { ok: false, checkedAt: now(), drift: [], added, error: String(err?.message ?? err) }
  }
}
