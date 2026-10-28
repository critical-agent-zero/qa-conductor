import json
D = 'lib/docker.mjs'
P = 'lib/adapters/provisioner-docker.mjs'
F = 'lib/forwarder.mjs'
TD = ['test/docker.test.mjs', 'test/provisioner-docker.test.mjs']
TF = ['test/forwarder.test.mjs']
m = [
    ('R1', D, """      let failure = null
      for (const name of names) {
        try {
          await run(['rm', '-f', '-v', name])
        } catch (err) {
          if (!onlyMissing(err, /no such container/i)) failure ??= err
        }
      }
      if (failure) throw failure""", """      if (!names.length) return
      try {
        await run(['rm', '-f', '-v', ...names])
      } catch (err) {
        if (!onlyMissing(err, /no such container/i)) throw err
      }""", TD),
    ('R2', D, "          if (!onlyMissing(err, /no such container/i)) failure ??= err", "          if (!onlyMissing(err, /no such container/i)) throw err", TD),
    ('G1', P, "  const isolatedGateway = engine !== null && engine >= 28", "  const isolatedGateway = engine !== null && engine >= 29", TD),
    ('G1b', P, "      const isolatedGateway = engine !== null && engine >= 28", "      const isolatedGateway = engine !== null && engine >= 29", TD),
    ('G2', P, "        .catch(err => (isolatedGateway && !exists(err) ? docker.createNetwork(net, { internal: true }) : Promise.reject(err)))\n", "", TD),
    ('G3', P, "          if (isolatedGateway && !(await docker.networkGatewayIsolated(net).catch(() => false))) {", "          if (false) {", TD),
    ('G4', P, "  const at = text.search(/^Server:/m)\n  if (at === -1) return null\n", "  const at = 0\n", TD),
    ('N1', D, "  /^exit status \\d+$/,", "  /exit status/,", TD),
    ('F1', F, "        res.setTimeout(idleMs, () => reset(res.socket))\n        upRes.pipe(res)", "        upRes.pipe(res)", TF),
]
out = []
for (i, f, o, n, t) in m:
    out.append({'id': i, 'file': f, 'old': o, 'new': n, 'tests': t})
R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'
keep = []
for x in out:
    c = open(R + x['file']).read().count(x['old'])
    if c != 1:
        print('miss', x['id'], c)
    else:
        keep.append(x)
json.dump(keep, open('/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/mut-40r3.json', 'w'), indent=1)
print(len(keep))
