R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('test/provisioner-docker.test.mjs', [
    ("""  if (args[0] === 'logs' && args.at(-1) === 'qa-fwd-pr') return 'qa-forwarder ready\\n'
  return null
}""", """  if (args[0] === 'logs' && args.at(-1) === 'qa-fwd-pr') return 'qa-forwarder ready\\n'
  // on Podman, the addresses the PR pane's hosts file gets
  if (c === 'inspect --format {{with index .NetworkSettings.Networks "qa-session-pr"}}{{.IPAddress}}{{end}} qa-pg-pr') return '172.20.0.3\\n'
  if (c === 'inspect --format {{with index .NetworkSettings.Networks "qa-session-pr"}}{{.IPAddress}}{{end}} qa-fwd-pr') return '172.20.0.2\\n'
  return null
}"""),
    ("""test('with the topology up on Docker, the PR pane\\'s containers get an unroutable DNS server; not the base pane\\'s, not on Podman, not after a fallback', async () => {""",
     """test('with the topology up, the PR pane\\'s containers get an unroutable DNS server, and on Podman its names in their hosts file; not the base pane\\'s, not after a fallback', async () => {"""),
    ("""  // Podman: its DNS answers nothing outside the network, and a --dns there
  // would replace it
  const podman = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ version: 'Client: Podman Engine\\nServer: Podman Engine\\n', probe: refusedAll() }) })
  await bootSession(podman.deps, 7)
  assert.equal(runs(podman.exec).some(c => c.args.includes('--dns')), false)""",
     """  assert.equal(runs(s.exec).some(c => c.args.includes('--add-host')), false, 'Docker\\'s own DNS serves the network\\'s names')
  // Podman: its DNS forwards outside names too (CI found it), and a --dns
  // replaces it, so the names the pane needs are in its hosts file
  const podman = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ version: 'Client: Podman Engine\\nServer: Podman Engine\\n', probe: refusedAll() }) })
  podman.deps.checkIsolation = async ({ stage, signal }) => { if (stage === 'panes') await podman.provisioner.isolation({ signal, canary: CANARY }) }
  await bootSession(podman.deps, 7)
  const hostsOf = (exec, name) => {
    const call = runs(exec).find(c => (valueOf(c.args, '--name') ?? valueOf(c.args, '--env-file')).endsWith(name)).args
    return call.flatMap((a, i) => (a === '--add-host' ? [call[i + 1]] : []))
  }
  for (const name of ['qa-pg-pr', 'qa-migrate-pr', 'qa-app-pr', 'qa-probe-pr']) assert.equal(dnsOf(podman.exec, name), '192.0.2.1', name)
  for (const name of ['qa-migrate-pr', 'qa-app-pr', 'qa-probe-pr']) assert.deepEqual(hostsOf(podman.exec, name), ['qa-pg-pr:172.20.0.3', 'qa-egress:172.20.0.2'], name)
  for (const name of ['qa-pg-base', 'qa-app-base']) assert.deepEqual([dnsOf(podman.exec, name), hostsOf(podman.exec, name)], [null, []], name)
  // a PR database with no address on its network fails the boot, rather
  // than leave the pane unable to reach it
  const lost = makeSession({ provisionerOptions: INTERNAL, answer: (args, opts) => (args.join(' ').endsWith('qa-pg-pr') && args[0] === 'inspect' && args[2].startsWith('{{with') ? '\\n' : probeDocker({ version: 'Client: Podman Engine\\n' })(args, opts)) })
  await assert.rejects(lost.provisioner.provisionDatabase({ paneRef: { role: 'pr' }, databases: [] }), /the PR pane's database or forwarder has no address on qa-session-pr/)"""),
])

edit('test/docker.test.mjs', [
    ("""test('runPg, runMigrate, runApp and runProbe take a DNS server; containerRunning reads the container\\'s state', async () => {""",
     """test('runPg, runMigrate, runApp and runProbe take a DNS server, and all but runPg hosts entries; containerRunning and addressOn read the container', async () => {"""),
])
print('ok')
