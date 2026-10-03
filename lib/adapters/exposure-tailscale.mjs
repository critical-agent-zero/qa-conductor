// tailscale serve Exposure adapter: publishes the conductor's mounts on this
// host's tailscaled through the tailscale CLI, and reports drift.
//
// It only ever adds or replaces handlers at the (port, path) pairs it is
// given. `serve --bg --https=P --set-path=/qa T` sits beside an existing /
// handler on P, and re-running a / handler keeps /qa (tailscaled 1.98.5), so
// another app's 8444 / and the harness's /qa can share a port. It never runs
// `serve reset` or `off`, so it never removes a handler: one an old origin
// left stays until the operator removes it.
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

  // The proxy target served over https at the mount's (port, path), or null.
  // The Web key is the mount's own host:port, else the first key on that port
  // (a mount host that is a short MagicDNS name, say).
  function actualTarget(st, { host, port, path }) {
    if (st.TCP?.[String(port)]?.HTTPS !== true) return null
    const keys = Object.keys(st.Web ?? {})
    const exact = `${host}:${port}`.toLowerCase()
    const key = keys.find(k => k.toLowerCase() === exact) ?? keys.find(k => k.endsWith(`:${port}`))
    const proxy = key === undefined ? undefined : st.Web[key]?.Handlers?.[path]?.Proxy
    return typeof proxy === 'string' ? proxy : null
  }

  async function check(mounts) {
    assertMounts(mounts)
    const st = await status()
    const drift = mounts
      .map(mount => ({ mount, actual: actualTarget(st, mount) }))
      .filter(({ mount, actual }) => actual === null || !sameTarget(actual, mount.target))
    return { ok: drift.length === 0, drift }
  }

  // Writes each drifted mount, and only those. One that fails doesn't stop the
  // rest, so a port another listener holds can't keep the others down; the
  // pass then rejects, naming each failure.
  async function ensure(mounts) {
    const { drift } = await check(mounts)
    const added = []
    const failed = []
    for (const { mount } of drift) {
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
      throw new AggregateError(failed.map(f => f.err), lines.join('\n'))
    }
    return { added, ok: mounts.filter(m => !added.includes(m)) }
  }

  return { check, ensure }
}
