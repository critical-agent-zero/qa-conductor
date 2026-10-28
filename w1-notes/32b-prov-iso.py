p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/adapters/provisioner-docker.mjs'
s = open(p).read()


def sub(text, a, b):
    assert text.count(a) == 1, a[:80]
    return text.replace(a, b, 1)


# 1. cut the isolation method's body out
head = "    async isolation({ signal, canary }) {\n      live(signal)\n"
start = s.index(head)
tail = "      return found.length ? { verdict: 'reachable', reasons: found } : { verdict: 'isolated', reasons: [] }\n    },\n"
end = s.index(tail, start) + len(tail)
# the comment block above the method stays with check
comment_start = s.rindex("    // Whether the PR pane can reach the base pane (README, Security), checked", 0, start)
comment = s[comment_start:start]
body = s[start + len(head):end - len("    },\n")]

# 2. the body, as check({ signal, canary, up }), dedented by two
lines = body.split('\n')
body2 = '\n'.join(line[2:] if line.startswith('  ') else line for line in lines)
body2 = sub(body2, """    // An address:port target's family: an address with a colon of its own
    // is IPv6.
    const familyOf""", """    // An address:port target's family: an address with a colon of its own
    // is IPv6.
    const familyOf""")
body2 = sub(body2, """    const readProbe = text => {
      const lines = typeof text === 'string' ? text.split('\\n').map(line => line.trim()) : []
      const hits = []
      const vouched = new Set()
      for (const line of lines) {
        const [kind, where] = line.split(' ')
        if (kind === 'listener' && where) hits.push(`the PR pane reached this conductor at ${where}:${canary.port}, so it can reach the host's loopback, where the base app is published`)
        if (kind === 'open' && where) hits.push(`the PR pane reached the base pane's database at ${where}`)
        if (kind === 'self' && where) vouched.add(familyOf(where))
      }
      return { hits, vouched, done: lines.includes('probe done') }
    }""", """    const readProbe = text => {
      const lines = typeof text === 'string' ? text.split('\\n').map(line => line.trim()) : []
      const hits = []
      const vouched = new Set()
      let answered = false // the forwarder's proxy answered a CONNECT
      for (const line of lines) {
        const [kind, where] = line.split(' ')
        if (kind === 'listener' && where) hits.push(`the PR pane reached this conductor at ${where}:${canary.port}, so it can reach the host's loopback, where the base app is published`)
        if (kind === 'open' && where) hits.push(`the PR pane reached the base pane's database at ${where}`)
        if (kind === 'self' && where) vouched.add(familyOf(where))
        if (kind === 'proxied' && where) hits.push(`the PR pane got through the forwarder's proxy to ${where}`)
        if ((kind === 'proxied' || kind === 'refused') && where) answered = true
      }
      return { hits, vouched, answered, done: lines.includes('probe done') }
    }""")
body2 = sub(body2, """    if (/podman/i.test(runtime.version)) return""", """    if (/podman/i.test(runtime.version) && !up) return""")
body2 = sub(body2, """    if (/docker desktop/i.test(runtime.os)) found.push(""", """    if (/docker desktop/i.test(runtime.os) && !up) found.push(""")
body2 = sub(body2, """    const databaseOf = async role => {
      const addresses = await docker.containerAddresses(pgName(role))
      if (addresses.length === 0) throw new Error(`${pgName(role)} has none`)
      return addresses.map(address => `${address}:5432`)
    }
    let gateways
    let baseDbs
    let ownDbs
    try {
      gateways = await docker.networkGateways(networks.pr)
      baseDbs = await databaseOf('base')
      ownDbs = await databaseOf('pr')
    } catch (err) {
      return cannotTell(`could not find the panes' addresses: ${errorLine(err)}`)
    }
    const hosts = [...new Set([...HOST_ADDRESSES, ...gateways])]""", """    const databaseOf = async role => {
      const addresses = await docker.containerAddresses(pgName(role))
      if (addresses.length === 0) throw new Error(`${pgName(role)} has none`)
      return addresses
    }
    let gateways
    let baseAddresses
    let ownDbs
    try {
      gateways = await docker.networkGateways(networks.pr)
      baseAddresses = await databaseOf('base')
      ownDbs = (await databaseOf('pr')).map(address => `${address}:5432`)
    } catch (err) {
      return cannotTell(`could not find the panes' addresses: ${errorLine(err)}`)
    }
    const baseDbs = baseAddresses.map(address => `${address}:5432`)
    const hosts = [...new Set([...HOST_ADDRESSES, ...gateways])]
    // through the forwarder's proxy too: each host at the harness port, and
    // the base database, as CONNECT targets (an IPv6 address in brackets)
    const target = (address, port) => (address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`)
    const proxy = `${EGRESS.alias}:${EGRESS.port}`
    const vias = up ? ['--', proxy, ...hosts.map(host => target(host, canary.port)), ...baseAddresses.map(address => target(address, 5432))] : []""")
body2 = sub(body2, """      const run = docker.runProbe(probeName, networks.pr, PROBE_SCRIPT, [String(canary.port), canary.path, canary.expect, ...hosts, '--', ...baseDbs, '--', ...ownDbs], { timeoutMs: probeTimeoutMs, signal })""",
            """      const run = docker.runProbe(probeName, networks.pr, PROBE_SCRIPT, [String(canary.port), canary.path, canary.expect, ...hosts, '--', ...baseDbs, '--', ...ownDbs, ...vias], { timeoutMs: probeTimeoutMs, signal })""")
body2 = sub(body2, """    const { hits, vouched, done } = readProbe(out)
    found.push(...hits)
    if (!done) return cannotTell('the probe didn\\'t finish, so it can\\'t say what the PR pane reaches')""", """    const { hits, vouched, answered, done } = readProbe(out)
    found.push(...hits)
    if (!done) return cannotTell('the probe didn\\'t finish, so it can\\'t say what the PR pane reaches')
    // no answer from the proxy: its misses prove nothing
    if (up && !answered) return cannotTell(`the probe got no answer from the forwarder's proxy at ${proxy}, so it can't say what the proxy lets through`)""")

check = comment.replace('    // ', '  // ') + "  const check = async ({ signal, canary, up }) => {\n" + body2 + "  }\n\n"

new_method = """    // Whether the PR pane can reach the base pane: check, below. With the
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
    },
"""
s = s[:comment_start] + new_method + s[end:]
# 3. check goes just before the returned object
anchor = "  return {\n    networks,\n"
s = sub(s, anchor, check + anchor)
open(p, 'w').write(s)
print('ok')
