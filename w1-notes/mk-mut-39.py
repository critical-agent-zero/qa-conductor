import json
F = 'lib/forwarder.mjs'
T = ['test/forwarder.test.mjs']
m = [
    ('W1 idle tunnel leaves client', "      upstream.on('close', () => { clearTimeout(connecting); if (open) socket.destroy() })", "      upstream.on('close', () => { clearTimeout(connecting) })"),
    ('W3 any status', "        if (!(upRes.statusCode >= 100 && upRes.statusCode <= 999)) { upRes.destroy(); upstream.destroy(); return failed() }\n", ""),
    ('W4 exact as suffix', ": host === r.host))", ": host.endsWith(r.host)))"),
    ('W5 last answer only', "  for (const address of addresses) {\n    const blocked", "  for (const address of addresses.slice(-1)) {\n    const blocked"),
    ('W6 CGNAT 16', "['100.64.0.0', 10,", "['100.64.0.0', 16,"),
    ('W7 wildcard any port', "rules.some(r => r.ports.includes(port) && (", "rules.some(r => ("),
    ('W8 lookup swapped', "const defaultLookup = host => dns.lookup(host, { all: true, verbatim: true })", "const defaultLookup = async () => [{ address: '93.184.216.34', family: 4 }]"),
    ('W9 connect swapped', "const defaultConnect = (port, address) => net.connect({ port, host: address })", "const defaultConnect = (port, address) => net.connect({ port, host: '127.0.0.1' })"),
    ('W10 host kept', "      headers.host = target.host\n", ""),
    ('W11 named kept', " && !named.has(k.toLowerCase())) out[k] = v", ") out[k] = v"),
    ('W12 no connect timer', "      const connecting = setTimeout(() => upstream.destroy(new Error('timed out')), connectMs)\n      upstream.on('socket'", "      const connecting = null\n      upstream.on('socket'"),
    ('W13 no http idle', "      upstream.setTimeout(idleMs, () => upstream.destroy(new Error('idle')))\n", ""),
    ('W14 cut not passed on', "        upRes.on('close', () => { if (!upRes.complete) res.destroy() })\n", ""),
    ('W15 head dropped', "        if (head?.length) upstream.write(head)\n", ""),
    ('W16 502 into tunnel', "if (!open && !socket.destroyed) answer(socket, 502,", "if (!socket.destroyed) answer(socket, 502,"),
    ('W17 502 refused', "answer(socket, 502, 'failed',", "answer(socket, 502, 'refused',"),
    ('W18 no half open', "net.createServer({ allowHalfOpen: true }, client =>", "net.createServer({ allowHalfOpen: false }, client =>"),
    ('W20 empty config', "  if (!forward && !proxy) throw new Error('the config must be an object with forward, proxy or both')\n", ""),
    ('W22 close leaves sockets', "      for (const socket of sockets) socket.destroy()\n", ""),
    ('W23 not canonical', "    return new URL(`http://${h}/`).hostname.replace(/\\.$/, '') || null", "    return h.toLowerCase().replace(/\\.$/, '') || null"),
    ('W24 private names', "    } else if (isPrivateName(name)) {", "    } else if (false) {"),
    ('W25 bare ipv6', "    if (given.includes(':') && !bracketed) throw", "    if (false) throw"),
    ('W26 log unbounded', "const LOG_MAX = 300", "const LOG_MAX = 100_000"),
    ('W27 log not bracketed', ": name.includes(':') ? `[${name}]` : name", ": name"),
    ('W28 pending ignored', "if (socket.pending) socket.once('connect', () => clearTimeout(connecting)); else clearTimeout(connecting)", "clearTimeout(connecting)"),
]
json.dump([{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for i, o, n in m],
          open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-39.json', 'w'), indent=1)
print(len(m))
