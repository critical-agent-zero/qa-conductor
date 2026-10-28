R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/docker.mjs', [
    ("""    async rmForce(names) {
      if (!names.length) return
      try {
        await run(['rm', '-f', '-v', ...names])
      } catch (err) {
        if (!onlyMissing(err, /no such container/i)) throw err
      }
    },""",
     """    // One name at a time: Podman before 5.1 (the podman-docker shim on
    // Ubuntu 24.04 and Debian 12) stops `rm -f a b c` at the first name
    // that is gone, removes none of the rest, and still exits 0. Every name
    // is tried; the first failure that isn't a name already gone rejects.
    async rmForce(names) {
      let failure = null
      for (const name of names) {
        try {
          await run(['rm', '-f', '-v', name])
        } catch (err) {
          if (!onlyMissing(err, /no such container/i)) failure ??= err
        }
      }
      if (failure) throw failure
    },"""),
    ("""    // `internal`: a network with no route off itself (#32).
    async createNetwork(name, { internal = false } = {}) {
      return run(['network', 'create', '--label', label, ...(internal ? ['--internal'] : []), name])
    },""",
     """    // `internal`: a network with no route off itself (#32).
    // `isolatedGateway` (Docker Engine 28 and later, for an internal
    // network): the bridge gets no address of the host's, so the network
    // can't reach the host at all.
    async createNetwork(name, { internal = false, isolatedGateway = false } = {}) {
      const gateway = isolatedGateway ? ['-o', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', '-o', 'com.docker.network.bridge.gateway_mode_ipv6=isolated'] : []
      return run(['network', 'create', '--label', label, ...(internal ? ['--internal'] : []), ...gateway, name])
    },

    // Whether a network's bridge has no address of the host's (IPv4
    // gateway mode `isolated`).
    async networkGatewayIsolated(name) {
      return (await run(['network', 'inspect', '--format', '{{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}', name])).trim() === 'isolated'
    },"""),
])

edit('lib/adapters/provisioner-docker.mjs', [
    ("""const NO_DNS = '192.0.2.1'""",
     """const NO_DNS = '192.0.2.1'
// Docker Engine's major version, from `docker version`'s Server section,
// or null (Podman, or no server, or no version there).
export function dockerEngineMajor(version) {
  const text = typeof version === 'string' ? version : ''
  if (/podman/i.test(text)) return null
  const at = text.search(/^Server:/m)
  if (at === -1) return null
  const m = /^\\s*Version:\\s*(\\d+)\\./m.exec(text.slice(at))
  return m ? Number(m[1]) : null
}"""),
    ("""    const net = networks.pr
    try {
      live(signal)
      await docker.createNetwork(edge).catch(err => reuseNetwork(edge, err))
      live(signal)
      await docker.createNetwork(net, { internal: true }).catch(async err => {
        await reuseNetwork(net, err)
        if (!(await docker.networkInternal(net))) throw new Error(`a network ${net} exists that isn't internal`)
      })""",
     """    const net = networks.pr
    try {
      // On Docker Engine 28 and later the internal network's bridge gets no
      // address of the host's (gateway mode isolated), so not even a host
      // service on 0.0.0.0 is reachable from the pane. Podman, and older
      // Engines, keep it (README, its limits). An Engine that refuses the
      // option gets a plain internal network, never the ordinary fallback.
      const engine = dockerEngineMajor((await docker.runtime().catch(() => null))?.version)
      const isolatedGateway = engine !== null && engine >= 28
      live(signal)
      await docker.createNetwork(edge).catch(err => reuseNetwork(edge, err))
      live(signal)
      const exists = err => /already exists|already used/.test(`${err?.message ?? ''}\\n${err?.stderr ?? ''}`)
      await docker.createNetwork(net, { internal: true, isolatedGateway })
        .catch(err => (isolatedGateway && !exists(err) ? docker.createNetwork(net, { internal: true }) : Promise.reject(err)))
        .catch(async err => {
          await reuseNetwork(net, err)
          if (!(await docker.networkInternal(net))) throw new Error(`a network ${net} exists that isn't internal`)
          // one left over without the isolated gateway, where it can have
          // one, is made again
          if (isolatedGateway && !(await docker.networkGatewayIsolated(net).catch(() => false))) {
            live(signal)
            await docker.rmNetwork(net)
            await docker.createNetwork(net, { internal: true, isolatedGateway })
          }
        })"""),
])
print('ok')
