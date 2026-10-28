R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('lib/docker.mjs', [
    ("""const dnsOf = dns => (dns ? ['--dns', dns] : [])""",
     """// A container's DNS server, and names it resolves from its hosts file
// (`name:address` each).
const HOST_ENTRY = /^[a-z0-9_-]+:[0-9a-f.:]+$/i
function dnsOf(dns, hosts = []) {
  for (const entry of hosts) if (!HOST_ENTRY.test(entry)) throw new Error(`unsafe host entry: ${JSON.stringify(entry)}`)
  return [...(dns ? ['--dns', dns] : []), ...hosts.flatMap(entry => ['--add-host', entry])]
}"""),
    ("""    async runMigrate(image, network, envFile, { name, dns = null } = {}) {""",
     """    async runMigrate(image, network, envFile, { name, dns = null, hosts = [] } = {}) {"""),
    ("""    async runApp(name, image, network, envFile, hostPort, { dns = null } = {}) {""",
     """    async runApp(name, image, network, envFile, hostPort, { dns = null, hosts = [] } = {}) {"""),
    ("""    async runProbe(name, network, script, args, { timeoutMs = 30_000, signal, dns = null } = {}) {""",
     """    async runProbe(name, network, script, args, { timeoutMs = 30_000, signal, dns = null, hosts = [] } = {}) {"""),
    ("""        'run', '--rm', '--name', name, '--network', network, ...dnsOf(dns), '--label', label, '--cap-drop', 'ALL',""",
     """        'run', '--rm', '--name', name, '--network', network, ...dnsOf(dns, hosts), '--label', label, '--cap-drop', 'ALL',"""),
    ("""    // Whether a container is running.
    async containerRunning(name) {""",
     """    // A container's IPv4 address on one network, or '' when it has none.
    async addressOn(name, network) {
      assertSafe(name, 'container name')
      assertSafe(network, 'network name')
      return (await run(['inspect', '--format', `{{with index .NetworkSettings.Networks "${network}"}}{{.IPAddress}}{{end}}`, name])).trim()
    },

    // Whether a container is running.
    async containerRunning(name) {"""),
])
# runMigrate and runApp: their own dnsOf lines take hosts too
s = open(R + 'lib/docker.mjs').read()
import re
mig = s.index('async runMigrate(')
app = s.index('async runApp(')
seg_m = s[mig:app]
assert seg_m.count('...dnsOf(dns),') == 1
seg_m = seg_m.replace('...dnsOf(dns),', '...dnsOf(dns, hosts),')
end_app = s.index('async runForwarder(')
seg_a = s[app:end_app]
assert seg_a.count('...dnsOf(dns),') == 1
seg_a = seg_a.replace('...dnsOf(dns),', '...dnsOf(dns, hosts),')
s = s[:mig] + seg_m + seg_a + s[end_app:]
open(R + 'lib/docker.mjs', 'w').write(s)

edit('lib/adapters/provisioner-docker.mjs', [
    ("""  // This boot's internal topology, once provisionDatabase set it up or fell
  // back: { up: true, dns } or { up: false, failure }.""",
     """  // This boot's internal topology, once provisionDatabase set it up or fell
  // back: { up: true, dns, hosts } or { up: false, failure }. `hosts` is null
  // on Docker, whose own DNS serves the network's names beside a --dns; on
  // Podman it is the names the PR pane needs, for its hosts file, once the
  // PR pane's database is up."""),
    ("""  // the DNS server for the PR pane's containers: none but on the topology
  const dnsFor = role => (role === 'pr' && internalUp() ? topology.dns : null)""",
     """  // the DNS server for the PR pane's containers, and its hosts file's
  // names: none but on the topology
  const dnsFor = role => (role === 'pr' && internalUp() ? topology.dns : null)
  const hostsFor = role => (role === 'pr' && internalUp() ? topology.hosts ?? [] : [])"""),
    ("""      // Podman's DNS answers nothing outside the network, and a --dns there
      // would replace it; Docker's forwards, so it gets one that can't answer
      const runtime = await docker.runtime().catch(() => null)
      return { up: true, dns: /podman/i.test(runtime?.version ?? '') ? null : NO_DNS }""",
     """      // Docker's DNS and Podman's both forward an internal network's outside
      // names (Podman's too: CI found it, on Podman 4.9), so the PR pane's
      // containers get a DNS server that can't answer. On Docker its own DNS
      // still serves the network's names; on Podman a --dns replaces Podman's
      // DNS, so the names the pane needs go in its hosts file
      const runtime = await docker.runtime().catch(() => null)
      return { up: true, dns: NO_DNS, hosts: /podman/i.test(runtime?.version ?? '') ? [] : null }"""),
    ("""      await docker.runPg(pg, net, { password, dns: dnsFor(paneRef.role) })
      await docker.waitHealthyPg(pg, {})""",
     """      await docker.runPg(pg, net, { password, dns: dnsFor(paneRef.role) })
      await docker.waitHealthyPg(pg, {})
      // on Podman, the names the PR pane resolves from its hosts file
      if (paneRef.role === 'pr' && internalUp() && topology.hosts !== null) {
        const [db, egress] = [await docker.addressOn(pg, net), await docker.addressOn(FORWARDER, net)]
        if (!db || !egress) throw new Error(`the PR pane's database or forwarder has no address on ${net}`)
        topology.hosts = [`${pg}:${db}`, `${EGRESS.alias}:${egress}`]
      }"""),
    ("""{ timeoutMs: probeTimeoutMs, signal, dns: dnsFor('pr') }""",
     """{ timeoutMs: probeTimeoutMs, signal, dns: dnsFor('pr'), hosts: hostsFor('pr') }"""),
    ("""{ name: migrateName(paneRef.role), dns: dnsFor(paneRef.role) }""",
     """{ name: migrateName(paneRef.role), dns: dnsFor(paneRef.role), hosts: hostsFor(paneRef.role) }"""),
    ("""reserved[name].port, { dns: dnsFor(paneRef.role) })""",
     """reserved[name].port, { dns: dnsFor(paneRef.role), hosts: hostsFor(paneRef.role) })"""),
])
print('ok')
