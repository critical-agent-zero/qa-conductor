p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/adapters/provisioner-docker.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("""// With `internal` (#32), the PR pane's network is internal: no route off
// itself, to the host or to the base pane. A forwarder (lib/forwarder.mjs)
// on an ordinary network, joined to the internal one as `qa-egress`,
// publishes the PR app on the host's loopback and is its only way out: an
// HTTP proxy that lets it out only to the hosts on the allowlist. If any of
// that can't be set up, the PR pane runs as it would without `internal`.""",
    """// With `internal` (#32), the PR pane's network is internal: no route off
// itself, to the host or to the base pane. A forwarder (lib/forwarder.mjs)
// on an ordinary network, joined to the internal one as `qa-egress`,
// publishes the PR app on the host's loopback and is its only way out: an
// HTTP proxy that lets it out only to the hosts on the allowlist. If any of
// that can't be set up, the PR pane runs as it would without `internal`,
// which is logged, and its isolation verdict is never better than unknown:
// its egress isn't restricted.""")

sub("""const FORWARDER_IMAGE = 'node:22-alpine'""", """const FORWARDER_IMAGE = 'node:22-alpine'
// The DNS server the PR pane's containers get on an internal network: in
// TEST-NET-1, never routed. Docker's own DNS still answers for the names on
// the network, and forwards the rest here, where nothing answers. Without
// it, a Docker Engine with CVE-2024-29018 (before 23.0.11, 25.0.0–25.0.4,
// 26.0.0-rc1–rc3) forwards them to a resolver on the host's loopback: a way
// out for data, in DNS queries.
const NO_DNS = '192.0.2.1'""")

sub("""  // the PR pane on an internal network (#32): true, or { egress, image }
  internal = null,
}) {""", """  // the PR pane on an internal network (#32): true, or { egress, image }
  internal = null,
  // how long the forwarder may take to say it is ready
  forwarderReadyMs = 10_000,
  // where a topology that fell back is said
  log = console,
}) {""")

sub("""  // This boot's internal topology, once provisionDatabase set it up or fell
  // back: { up: true } or { up: false, failure }.
  let topology = null
  const internalUp = () => inside !== null && topology?.up === true""", """  // This boot's internal topology, once provisionDatabase set it up or fell
  // back: { up: true, dns } or { up: false, failure }.
  let topology = null
  const internalUp = () => inside !== null && topology?.up === true
  // the DNS server for the PR pane's containers: none but on the topology
  const dnsFor = role => (role === 'pr' && internalUp() ? topology.dns : null)""")

sub("""  // The PR pane's internal network, the forwarder's ordinary one, and the
  // forwarder on it, then joined to the internal one as qa-egress. Any step
  // that fails undoes them all, and the pane gets an ordinary network, as
  // without `internal`. An internal network left over is reused only when it
  // is internal.
  const internalNetwork = async signal => {
    const net = networks.pr
    try {
      live(signal)
      await docker.createNetwork(edge).catch(err => reuseNetwork(edge, err))
      live(signal)
      await docker.createNetwork(net, { internal: true }).catch(async err => {
        await reuseNetwork(net, err)
        if (!(await docker.networkInternal(net))) throw new Error(`a network ${net} exists that isn't internal`)
      })""", """  // The forwarder is up: running, and says so. Polled until
  // forwarderReadyMs pass.
  const forwarderReady = async signal => {
    for (const end = Date.now() + forwarderReadyMs; ;) {
      live(signal)
      if (!(await docker.containerRunning(FORWARDER))) throw new Error(`the forwarder ${FORWARDER} isn't running`)
      if ((await docker.logsTail(FORWARDER, 20).catch(() => '')).includes('qa-forwarder ready')) return
      if (Date.now() >= end) throw new Error(`the forwarder ${FORWARDER} wasn't ready within ${forwarderReadyMs} ms`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  // The PR pane's internal network, the forwarder's ordinary one, and the
  // forwarder on it, then joined to the internal one as qa-egress. Up only
  // once the network reads back internal and the forwarder is ready. Any
  // step that fails undoes them all, and the pane gets an ordinary network,
  // as without `internal`, which is logged. An internal network left over is
  // reused only when it is internal; one the undo can't remove, or that is
  // still there, fails the boot instead.
  const internalNetwork = async signal => {
    const net = networks.pr
    try {
      live(signal)
      await docker.createNetwork(edge).catch(err => reuseNetwork(edge, err))
      live(signal)
      await docker.createNetwork(net, { internal: true }).catch(async err => {
        await reuseNetwork(net, err)
        if (!(await docker.networkInternal(net))) throw new Error(`a network ${net} exists that isn't internal`)
      })
      if (!(await docker.networkInternal(net))) throw new Error(`${net} was created but isn't internal`)""")
sub("""      live(signal)
      await docker.connectNetwork(net, FORWARDER, { alias: EGRESS.alias })
      return { up: true }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      await docker.rmForce([FORWARDER]).catch(() => {})
      await docker.rmNetwork(net).catch(() => {})
      await docker.rmNetwork(edge).catch(() => {})
      live(signal)
      await docker.createNetwork(net).catch(e => reuseNetwork(net, e))
      return { up: false, failure: errorLine(err) }
    }
  }""", """      live(signal)
      await docker.connectNetwork(net, FORWARDER, { alias: EGRESS.alias })
      await forwarderReady(signal)
      // Podman's DNS answers nothing outside the network, and a --dns there
      // would replace it; Docker's forwards, so it gets one that can't answer
      const runtime = await docker.runtime().catch(() => null)
      return { up: true, dns: /podman/i.test(runtime?.version ?? '') ? null : NO_DNS }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      const failure = errorLine(err)
      await docker.rmForce([FORWARDER]).catch(() => {})
      try {
        await docker.rmNetwork(net)
      } catch (rmErr) {
        throw new Error(`the PR pane's internal network couldn't be set up (${failure}), nor removed: ${errorLine(rmErr)}`)
      }
      await docker.rmNetwork(edge).catch(() => {})
      live(signal)
      await docker.createNetwork(net).catch(async e => {
        await reuseNetwork(net, e)
        if (await docker.networkInternal(net)) throw new Error(`the PR pane's internal network couldn't be set up (${failure}), and a network ${net} is still there, and internal`)
      })
      log.error(`[qa] the PR pane's internal network couldn't be set up (${failure}): it runs on an ordinary network, and its egress isn't restricted`)
      return { up: false, failure }
    }
  }""")

# podman shim: info's failure doesn't sink a Podman verdict
sub("""    if (runtime.osError) return cannotTell(`could not tell the container runtime: ${errorLine(runtime.osError)}`)""",
    """    // behind the podman-docker shim `docker info` fails; `docker version`
    // already said what it is
    if (runtime.osError && !/podman/i.test(runtime.version)) return cannotTell(`could not tell the container runtime: ${errorLine(runtime.osError)}`)""")

# the proxy control: every target answered
sub("""      let answered = false // the forwarder's proxy answered a CONNECT
      for (const line of lines) {""", """      const answered = new Set() // the targets the forwarder's proxy answered for
      for (const line of lines) {""")
sub("""        if ((kind === 'proxied' || kind === 'refused') && where) answered = true""",
    """        if ((kind === 'proxied' || kind === 'refused') && where) answered.add(where)""")
sub("""    // no answer from the proxy: its misses prove nothing
    if (up && !answered) return cannotTell(`the probe got no answer from the forwarder's proxy at ${proxy}, so it can't say what the proxy lets through`)""",
    """    // no answer from the proxy for a target: its miss there proves nothing
    if (up) {
      const asked = vias.slice(2)
      const silent = asked.filter(t => !answered.has(t))
      if (silent.length === asked.length) return cannotTell(`the probe got no answer from the forwarder's proxy at ${proxy}, so it can't say what the proxy lets through`)
      if (silent.length) {
        const named = silent.length <= 5 ? silent.join(', ') : `${silent.slice(0, 5).join(', ')} and ${silent.length - 5} more`
        return cannotTell(`the forwarder's proxy at ${proxy} didn't answer the probe for ${silent.length} of ${asked.length} targets (${named}), so it can't say what the proxy lets through there`)
      }
    }""")
sub("""      const run = docker.runProbe(probeName, networks.pr, PROBE_SCRIPT, [String(canary.port), canary.path, canary.expect, ...hosts, '--', ...baseDbs, '--', ...ownDbs, ...vias], { timeoutMs: probeTimeoutMs, signal })""",
    """      const run = docker.runProbe(probeName, networks.pr, PROBE_SCRIPT, [String(canary.port), canary.path, canary.expect, ...hosts, '--', ...baseDbs, '--', ...ownDbs, ...vias], { timeoutMs: probeTimeoutMs, signal, dns: dnsFor('pr') })""")

# --dns for the PR pane's containers
sub("""      live(signal)
      await docker.runPg(pg, net, { password })""", """      live(signal)
      await docker.runPg(pg, net, { password, dns: dnsFor(paneRef.role) })""")
sub("""      await docker.runMigrate(migrate.image, net, file, { name: migrateName(paneRef.role) })""",
    """      await docker.runMigrate(migrate.image, net, file, { name: migrateName(paneRef.role), dns: dnsFor(paneRef.role) })""")
sub("""        await docker.runApp(appName(paneRef.role), image, net, file, paneRef.role === 'pr' && internalUp() ? null : reserved[name].port)""",
    """        await docker.runApp(appName(paneRef.role), image, net, file, paneRef.role === 'pr' && internalUp() ? null : reserved[name].port, { dns: dnsFor(paneRef.role) })""")

# triage
sub("""    // Failure triage: the app container once it exists, the pg container before.
    async logs({ paneRef, stage, lines = 40 }) {
      const container = stage === 'starting' ? appName(paneRef.role) : pgName(paneRef.role)
      return docker.logsTail(container, lines)
    },""", """    // Failure triage: the app container once it exists, the pg container
    // before; with the topology up, the PR pane's forwarder too.
    async logs({ paneRef, stage, lines = 40 }) {
      const container = stage === 'starting' ? appName(paneRef.role) : pgName(paneRef.role)
      const tail = await docker.logsTail(container, lines)
      if (paneRef.role !== 'pr' || !internalUp()) return tail
      const forwarder = await docker.logsTail(FORWARDER, lines).catch(err => `(no log: ${errorLine(err)})\\n`)
      return `${tail}[${FORWARDER}]\\n${forwarder}`
    },""")

# the verdict of a topology that fell back
sub("""    // Whether the PR pane can reach the base pane: check, below. With the
    // internal topology up, the runtime's own reasons (Podman's networks,
    // Docker Desktop's forwarding) are what it is for, so the probe decides,
    // and it also asks the forwarder's proxy for every address it tries
    // directly. The result then says `internal: true`. One that fell back
    // says why, when the verdict isn't isolated.
    async isolation({ signal, canary }) {
      live(signal)
      const up = internalUp()
      const out = await check({ signal, canary, up })
      if (up) return { ...out, internal: true }
      if (inside && topology && !topology.up && out.verdict !== 'isolated') {
        out.reasons.push(`the PR pane's internal network couldn't be set up (${topology.failure}), so it runs on an ordinary network`)
      }
      return out
    },""", """    // Whether the PR pane can reach the base pane: check, below. With the
    // internal topology up, the runtime's own reasons (Podman's networks,
    // Docker Desktop's forwarding) are what it is for, so the probe decides,
    // and it also asks the forwarder's proxy for every address it tries
    // directly. The result then says `internal: true`. One that fell back is
    // never better than unknown, whatever the probe found: the operator asked
    // for an egress allowlist that isn't in force.
    async isolation({ signal, canary }) {
      live(signal)
      const up = internalUp()
      const out = await check({ signal, canary, up })
      if (up) return { ...out, internal: true }
      if (inside && topology && !topology.up) {
        return {
          verdict: out.verdict === 'isolated' ? 'unknown' : out.verdict,
          reasons: [...out.reasons, `egress isn't restricted: the PR pane's internal network couldn't be set up (${topology.failure})`],
        }
      }
      return out
    },""")
open(p, 'w').write(s)
print('ok')
