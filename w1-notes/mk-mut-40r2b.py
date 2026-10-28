import json
P = 'lib/adapters/provisioner-docker.mjs'
D = 'lib/docker.mjs'
T = ['test/provisioner-docker.test.mjs', 'test/docker.test.mjs']
m = [
    ('T1', P, "        const t = await internalNetwork(signal)\n        live(signal)\n        topology = t", "        topology = await internalNetwork(signal)"),
    ('T2', P, "      if (err?.name === 'AbortError' || signal?.aborted) throw aborted()", "      if (err?.name === 'AbortError') throw err"),
    ('T3', P, "      endpoint = await docker.endpoint({ podman: /podman/i.test(runtime.version) })", "      endpoint = await docker.endpoint()"),
    ('T4', P, "    if (endpoint !== 'local' && !/^(unix|npipe):\\/\\//i.test(endpoint)) {", "    if (!/^(unix|npipe):\\/\\//i.test(endpoint)) {"),
    ('T5', P, "hosts: /podman/i.test(runtime?.version ?? '') ? [] : null }", "hosts: /podman/i.test(runtime?.version ?? 'podman') ? [] : null }"),
    ('T6', P, "      if (Date.now() >= end) throw new Error(`the forwarder ${FORWARDER} wasn't ready within ${forwarderReadyMs} ms`)", "      if (true) throw new Error(`the forwarder ${FORWARDER} wasn't ready within ${forwarderReadyMs} ms`)"),
    ('T7', P, "    for (const end = Date.now() + forwarderReadyMs; ;) {\n      live(signal)\n", "    for (const end = Date.now() + forwarderReadyMs; ;) {\n"),
    ('T8', P, "      log.error(`[qa] the PR pane's internal network couldn't be set up", "      log.log(`[qa] the PR pane's internal network couldn't be set up"),
    ('E1', D, "      if (env.CONTAINER_HOST) return env.CONTAINER_HOST\n", ""),
    ('E2', D, "      const connection = named ? listed.find(c => c?.Name === named) : listed.find(c => c?.Default === true)", "      const connection = listed.find(c => c?.Default === true)"),
    ('E3', D, "      if (!podman || /^[a-z][a-z0-9+.-]*:\\/\\//i.test(context)) return context", "      if (!podman) return context"),
    ('E4', D, "      return connection ? String(connection.URI ?? '') : 'local'", "      return connection ? String(connection.URI ?? '') : 'unix://'"),
]
out = [{'id': i, 'file': f, 'old': o, 'new': n, 'tests': T} for (i, f, o, n) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-40r2b.json', 'w'), indent=1)
print(len(out))
