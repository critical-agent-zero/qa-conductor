import json
F = 'lib/forwarder.mjs'
T = ['test/forwarder.test.mjs']
m = [
    ('P1', "        res.setTimeout(idleMs, () => reset(res.socket))\n", ""),
    ('R3', "        if (res.headersSent) return reset(res.socket)", "        if (res.headersSent) return res.destroy()"),
    ('R1', "      client.on('error', () => reset(upstream))", "      client.on('error', () => upstream.destroy())"),
    ('I14', "      upstream.on('socket', socket => idleTimer(socket, res.socket, idleMs, () => upstream.destroy(new Error('idle')), { waiting: () => Boolean(upRes?.isPaused() || res.writableNeedDrain) }))",
     "      upstream.setTimeout(idleMs, () => upstream.destroy(new Error('idle')))"),
    ('I15', "        idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })",
     "        socket.setTimeout(idleMs, () => { reset(socket); reset(upstream) }); upstream.setTimeout(idleMs, () => { reset(socket); reset(upstream) })"),
    ('I15b', "        idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })",
     "        upstream.setTimeout(idleMs, () => { reset(socket); reset(upstream) })"),
    ('I15c', "        idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })",
     "        socket.setTimeout(idleMs, () => { reset(socket); reset(upstream) })"),
    ('I16', "        idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })",
     "        idleTimer(upstream, socket, idleMs, () => { reset(socket); reset(upstream) })"),
    ('L1', "  createForwarder(config, { log: line => console.log(line) }).then(", "  createForwarder(config).then("),
    ('L2', "    err => { console.log(`qa-forwarder: ${err.message}`); process.exit(1) },", "    err => { console.error(`qa-forwarder: ${err.message}`); process.exit(1) },"),
]
out = [{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for (i, o, n) in m]
json.dump(out, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-40r2.json', 'w'), indent=1)
print(len(out))
