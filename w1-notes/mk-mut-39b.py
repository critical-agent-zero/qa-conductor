import json
F = 'lib/forwarder.mjs'
T = ['test/forwarder.test.mjs']
m = [
    ('V1 tunnel destroy', "if (open) socket.destroySoon() })", "if (open) socket.destroy() })"),
    ('V2 forward destroy', "upstream.on('close', () => client.destroySoon())", "upstream.on('close', () => client.destroy())"),
    ('V3 at allowed', "const NOT_A_HOST = /[@/?#\\\\%\\s]/", "const NOT_A_HOST = /[/?#\\\\%\\s]/"),
    ('V4 path allowed', "const NOT_A_HOST = /[@/?#\\\\%\\s]/", "const NOT_A_HOST = /[@?#\\\\%\\s]/"),
    ('V5 hash allowed', "const NOT_A_HOST = /[@/?#\\\\%\\s]/", "const NOT_A_HOST = /[@/?\\\\%\\s]/"),
    ('V6 space allowed', "const NOT_A_HOST = /[@/?#\\\\%\\s]/", "const NOT_A_HOST = /[@/?#\\\\%]/"),
    ('V7 backslash allowed', "const NOT_A_HOST = /[@/?#\\\\%\\s]/", "const NOT_A_HOST = /[@/?#%\\s]/"),
    ('V8 trim back', "  const s = String(text ?? '')\n", "  const s = String(text ?? '').trim()\n"),
    ('V9 connect after gone', "      if (socket.destroyed) return\n", ""),
    ('V10 http dials after gone', "      if (gone) return\n", ""),
    ('V11 http res close', "      res.on('close', () => { if (!res.writableFinished) upstream.destroy() })\n", ""),
    ('V12 connect timer', "      const connecting = setTimeout(() => upstream.destroy(new Error('timed out')), connectMs)\n      upstream.once('connect'", "      const connecting = setTimeout(() => {}, connectMs)\n      upstream.once('connect'"),
    ('V13 reset ignored', "      socket.on('error', () => upstream?.destroy())\n", "      socket.on('error', () => {})\n"),
    ('V14 listen failure kept', "    await Promise.all(servers.map(server => new Promise(resolve => (server.listening ? server.close(() => resolve()) : resolve()))))\n", ""),
    ('V15 default any port', "const DEFAULT_PORTS = [80, 443]", "const DEFAULT_PORTS = Array.from({ length: 65535 }, (_, i) => i + 1)"),
    ('V16 close ignored', "      socket.on('close', () => upstream?.destroySoon())\n", ""),
    ('V17 url parts unchecked', "    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null\n", ""),
]
json.dump([{'id': i, 'file': F, 'old': o, 'new': n, 'tests': T} for i, o, n in m],
          open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-39b.json', 'w'), indent=1)
print(len(m))
