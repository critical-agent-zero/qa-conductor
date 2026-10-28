import json
P = 'lib/adapters/provisioner-docker.mjs'
D = 'lib/docker.mjs'
F = 'lib/forwarder.mjs'
TP = ['test/provisioner-docker.test.mjs']
TD = ['test/docker.test.mjs']
TF = ['test/forwarder.test.mjs']
m = [
    # medium 1: the fallback capped at unknown
    ('P1', P, "verdict: out.verdict === 'isolated' ? 'unknown' : out.verdict,", "verdict: out.verdict,", TP),
    ('P2', P, "if (inside && topology && !topology.up) {", "if (false) {", TP),
    ('P3', P, "      log.error(`[qa] the PR pane's internal network couldn't be set up (${failure}): it runs on an ordinary network, and its egress isn't restricted`)\n", "", TP),
    # medium 2: DNS
    ('P4', P, "return { up: true, dns: /podman/i.test(runtime?.version ?? '') ? null : NO_DNS }", "return { up: true, dns: NO_DNS }", TP),
    ('P5', P, "return { up: true, dns: /podman/i.test(runtime?.version ?? '') ? null : NO_DNS }", "return { up: true, dns: null }", TP),
    ('P6', P, "const dnsFor = role => (role === 'pr' && internalUp() ? topology.dns : null)", "const dnsFor = role => (internalUp() ? topology.dns : null)", TP),
    ('P7', P, "{ timeoutMs: probeTimeoutMs, signal, dns: dnsFor('pr') }", "{ timeoutMs: probeTimeoutMs, signal }", TP),
    ('P8', P, "await docker.runPg(pg, net, { password, dns: dnsFor(paneRef.role) })", "await docker.runPg(pg, net, { password })", TP),
    ('P9', P, "{ name: migrateName(paneRef.role), dns: dnsFor(paneRef.role) }", "{ name: migrateName(paneRef.role) }", TP),
    ('P10', P, "reserved[name].port, { dns: dnsFor(paneRef.role) })", "reserved[name].port)", TP),
    # lows: up from read-backs
    ('P11', P, "      if (!(await docker.networkInternal(net))) throw new Error(`${net} was created but isn't internal`)\n", "", TP),
    ('P12', P, "      await forwarderReady(signal)\n", "", TP),
    ('P13', P, "if (!(await docker.containerRunning(FORWARDER))) throw new Error(`the forwarder ${FORWARDER} isn't running`)", "", TP),
    ('P14', P, "if (Date.now() >= end) throw new Error(`the forwarder ${FORWARDER} wasn't ready within ${forwarderReadyMs} ms`)", "if (Date.now() >= end) return", TP),
    ('P15', P, "if (paneRef.role !== 'pr' || !internalUp()) return tail", "return tail", TP),
    ('P16', P, "if (paneRef.role !== 'pr' || !internalUp()) return tail", "if (!internalUp()) return tail", TP),
    # the shim
    ('P17', P, "if (runtime.osError && !/podman/i.test(runtime.version)) return", "if (runtime.osError) return", TP),
    # the proxy control for every target
    ('P18', P, "      if (silent.length) {\n", "      if (false) {\n", TP),
    ('P19', P, "if (silent.length === asked.length) return", "if (silent.length === asked.length && false) return", TP),
    ('P20', P, "if ((kind === 'proxied' || kind === 'refused') && where) answered.add(where)", "if (kind === 'proxied' && where) answered.add(where)", TP),
    # the fallback's undo
    ('P21', P, """      try {
        await docker.rmNetwork(net)
      } catch (rmErr) {
        throw new Error(`the PR pane's internal network couldn't be set up (${failure}), nor removed: ${errorLine(rmErr)}`)
      }""", "      await docker.rmNetwork(net).catch(() => {})", TP),
    ('P22', P, "        if (await docker.networkInternal(net)) throw new Error(`the PR pane's internal network couldn't be set up (${failure}), and a network ${net} is still there, and internal`)\n", "", TP),
    # nit: base teardown
    ('P23', P, "const withForwarder = paneRef.role === 'pr' && inside !== null", "const withForwarder = inside !== null", TP),
    # docker.mjs
    ('D1', D, "const dnsOf = dns => (dns ? ['--dns', dns] : [])", "const dnsOf = dns => []", TD),
    ('D2', D, "return (await run(['inspect', '--format', '{{.State.Running}}', name])).trim() === 'true'", "return true", TD),
    # forwarder: #39's round-3 items
    ('F1', F, "if (socket.isPaused() || peer?.writableNeedDrain) return socket.setTimeout(ms)", "if (false) return socket.setTimeout(ms)", TF),
    ('F2', F, "if (upRes?.isPaused() || res.writableNeedDrain) return upstream.setTimeout(idleMs)", "if (false) return upstream.setTimeout(idleMs)", TF),
    ('F3', F, "      client.on('error', () => reset(upstream))\n      upstream.on('error', () => reset(client))", "      client.on('error', () => upstream.destroy())\n      upstream.on('error', () => client.destroy())", TF),
    ('F4', F, "if (res.headersSent) return reset(res.socket)", "if (res.headersSent) return res.destroy()", TF),
    ('F5', F, "upRes.on('close', () => { if (!upRes.complete) reset(res.socket) })", "upRes.on('close', () => { if (!upRes.complete) res.destroy() })", TF),
    ('F6', F, "idleTimer(upstream, socket, idleMs, () => { reset(upstream); reset(socket) })", "idleTimer(upstream, socket, idleMs, () => { upstream.destroy(); socket.destroy() })", TF),
    ('F7', F, "else if (open) reset(socket) })", "else if (open) socket.destroy() })", TF),
    ('F8', F, "if (!to.host || /\\s/.test(String(forward.to)) ||", "if (!to.host ||", TF),
    ('F9', F, "const NOT_A_HOST = /[@/?#\\\\%\\s\\u2044\\u2215\\u29f5]/", "const NOT_A_HOST = /[@/?#\\\\%\\s]/", TF),
    ('F10', F, "socket.on('error', () => reset(upstream))", "socket.on('error', () => upstream?.destroy())", TF),
    ('F11', F, "socket.on('close', () => upstream?.destroySoon())", "socket.on('close', () => {})", TF),
]
out = [{'id': i, 'file': f, 'old': o, 'new': n, 'tests': t} for (i, f, o, n, t) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-40.json', 'w'), indent=1)
print(len(out))
