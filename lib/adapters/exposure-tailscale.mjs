// tailscale serve Exposure adapter: publishes the conductor's mounts on this
// host's tailscaled through the tailscale CLI, and reports drift.
//
// It only ever adds or replaces handlers at the (port, path) pairs it is
// given. `serve --bg --https=P --set-path=/qa T` sits beside an existing /
// handler on P, and re-running a / handler keeps /qa (tailscaled 1.98.5), so
// another app's 8444 / and the harness's /qa can share a port. It never runs
// `serve reset` or `off`, so it never removes a handler: one an old origin
// left stays until the operator removes it, and one that shadows a mount is
// reported as drift, never rewritten.
//
// Every command goes through the injected execFileFn (makeExecFileFn from
// ./exec in production), so it is tested against recorded status JSON with
// no tailscaled. The platform constructs it; the core never does.

const SERVE_STATUS = ['serve', 'status', '--json']

// A Mount this adapter can pass to the CLI: an argument that can't be read
// as a flag, and a port and path serve accepts.
function assertMounts(mounts) {
  if (!Array.isArray(mounts)) throw new Error('tailscale exposure: mounts must be an array')
  for (const m of mounts) {
    const ok = m != null &&
      Number.isInteger(m.port) && m.port >= 1 && m.port <= 65535 &&
      typeof m.path === 'string' && /^\/\S*$/.test(m.path) &&
      typeof m.target === 'string' && /^https?:\/\/\S+$/.test(m.target)
    if (!ok) throw new Error(`tailscale exposure: not a mount: ${JSON.stringify(m)}`)
  }
}

const sameTarget = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '')
const proxyOf = handler => (typeof handler?.Proxy === 'string' ? handler.Proxy : null)
const snippet = text => JSON.stringify(text.length > 200 ? `${text.slice(0, 200)}…` : text)

export function createTailscaleExposure({ execFileFn, bin = 'tailscale', socket = null, timeoutMs = 30_000 } = {}) {
  if (typeof execFileFn !== 'function') throw new TypeError('createTailscaleExposure needs execFileFn (makeExecFileFn() from ./exec)')
  if (typeof bin !== 'string' || !bin) throw new TypeError(`createTailscaleExposure: bin must be the tailscale CLI's path or name, got ${JSON.stringify(bin)}`)
  if (socket !== null && (typeof socket !== 'string' || !socket)) throw new TypeError(`createTailscaleExposure: socket must be a path or null, got ${JSON.stringify(socket)}`)
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`createTailscaleExposure: timeoutMs must be a positive number of milliseconds, got ${JSON.stringify(timeoutMs)}`)
  }
  // --socket is a global flag, so it goes before the subcommand. The timeout
  // keeps a hung CLI from holding a reconcile pass forever.
  const run = async args => {
    const result = await execFileFn(bin, [...(socket ? [`--socket=${socket}`] : []), ...args], { timeout: timeoutMs })
    return String(result?.stdout ?? '')
  }

  // The serve config. With none, the CLI prints {} (1.98.5); empty output and
  // a JSON null mean the same.
  async function status() {
    const out = (await run(SERVE_STATUS)).trim()
    if (!out) return {}
    let st
    try { st = JSON.parse(out) } catch {
      throw new Error(`tailscale serve status --json printed something that is not JSON: ${snippet(out)}`)
    }
    if (st === null) return {}
    if (typeof st !== 'object' || Array.isArray(st)) throw new Error(`tailscale serve status --json printed JSON that is not a JSON object: ${snippet(out)}`)
    return st
  }

  // What tailscaled serves for a mount, from the status JSON:
  // - `actual`: the proxy target served over https at the mount's own
  //   (port, path), or null;
  // - `shadows`: the other handlers on that Web key that take some of the
  //   mount's requests and don't proxy to its target, each as
  //   `<path> -> <proxy>` or `<path> (not a proxy)`. tailscaled hands a
  //   request to the deepest handler path that holds it, trying `<dir>/`
  //   before `<dir>` (getServeHandler in ipn/ipnlocal/serve.go). So `/qa/`
  //   or `/qa/api` beside the harness's `/qa` takes harness requests, and
  //   any other path on a pane's port takes pane requests.
  // The Web key is the mount's own host:port, else the first key on that port
  // (a mount host that is a short MagicDNS name, say).
  function served(st, { host, port, path, target }) {
    if (st.TCP?.[String(port)]?.HTTPS !== true) return { actual: null, shadows: [] }
    const keys = Object.keys(st.Web ?? {})
    const exact = `${host}:${port}`.toLowerCase()
    const key = keys.find(k => k.toLowerCase() === exact) ?? keys.find(k => k.endsWith(`:${port}`))
    const handlers = (key === undefined ? undefined : st.Web[key]?.Handlers) ?? {}
    const under = path.endsWith('/') ? path : `${path}/`
    const shadows = []
    for (const [p, handler] of Object.entries(handlers)) {
      if (p === path || !p.startsWith(under)) continue
      const proxy = proxyOf(handler)
      if (proxy !== null && sameTarget(proxy, target)) continue
      shadows.push(proxy === null ? `${p} (not a proxy)` : `${p} -> ${proxy}`)
    }
    return { actual: Object.hasOwn(handlers, path) ? proxyOf(handlers[path]) : null, shadows }
  }

  const inPlace = (actual, mount) => actual !== null && sameTarget(actual, mount.target)

  // A mount drifts when its own handler is missing or points elsewhere
  // (`actual` is that handler's target, or null), and once more for each
  // handler that shadows it (`actual` names that handler).
  async function check(mounts) {
    assertMounts(mounts)
    const st = await status()
    const drift = []
    for (const mount of mounts) {
      const { actual, shadows } = served(st, mount)
      if (!inPlace(actual, mount)) drift.push({ mount, actual })
      for (const shadow of shadows) drift.push({ mount, actual: shadow })
    }
    return { ok: drift.length === 0, drift }
  }

  // Writes each mount whose own handler drifted, and only those: a handler
  // that shadows a mount isn't the conductor's, so it is reported and left
  // alone. One that fails doesn't stop the rest, so a port another listener
  // holds can't keep the others down. Then it rejects, naming each failure,
  // and the error's `added` lists the mounts that were written.
  async function ensure(mounts) {
    assertMounts(mounts)
    const st = await status()
    const added = []
    const failed = []
    for (const mount of mounts.filter(m => !inPlace(served(st, m).actual, m))) {
      const args = ['serve', '--bg', `--https=${mount.port}`, ...(mount.path === '/' ? [] : [`--set-path=${mount.path}`]), mount.target]
      try {
        await run(args)
        added.push(mount)
      } catch (err) {
        failed.push({ mount, err })
      }
    }
    if (failed.length) {
      const lines = failed.map(({ mount, err }) => `could not mount ${mount.port}${mount.path} -> ${mount.target}: ${err?.message ?? err}`)
      throw Object.assign(new AggregateError(failed.map(f => f.err), lines.join('\n')), { added })
    }
    return { added, ok: mounts.filter(m => !added.includes(m)) }
  }

  return { check, ensure }
}
