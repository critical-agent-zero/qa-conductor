import json
F = 'lib/forwarder.mjs'
TF = ['test/forwarder.test.mjs']
m = [
    ('D2c', "upstream.on('close', () => { clearTimeout(connecting); if (open) socket.destroySoon() })", "upstream.on('close', () => { clearTimeout(connecting) })"),
    ('D2b', "upstream.on('close', () => { clearTimeout(connecting); if (open) socket.destroySoon() })", "upstream.on('close', () => { clearTimeout(connecting); if (open) socket.end() })"),
    ('H5', "res.on('close', () => { if (!res.writableFinished) upstream.destroy() })", "res.on('close', () => { if (!res.headersSent) upstream.destroy() })"),
    ('F5', "upRes.on('close', () => { if (!upRes.complete) reset(res.socket) })", "upRes.on('close', () => { if (!upRes.complete) res.destroy() })"),
    ('F10', "socket.on('error', () => reset(upstream))", "socket.on('error', () => upstream?.destroy())"),
    ('I1',"idleTimer(socket, upstream, idleMs, () => { reset(socket); reset(upstream) })", "socket.setTimeout(idleMs, () => { reset(socket); reset(upstream) })"),
]
json.dump([{'id': i, 'file': F, 'old': o, 'new': n, 'tests': TF} for (i, o, n) in m], open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-40b.json', 'w'), indent=1)
print(len(m))
