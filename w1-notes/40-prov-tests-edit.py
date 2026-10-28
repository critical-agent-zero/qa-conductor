p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/provisioner-docker.test.mjs'
s = open(p).read()


def sub(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:80], s.count(a))
    s = s.replace(a, b)


# makeSession: the forwarder's readbacks answer as a healthy topology unless a test says otherwise
sub("""function makeSession({ provisionerOptions = {}, answer } = {}) {
  const exec = recordingExec({ answer })""", """// What a healthy internal topology answers when read back: the network is
// internal, the forwarder runs and says it is ready. A test's own answer wins.
function topologyAnswers(args) {
  const c = args.join(' ')
  if (c === 'network inspect --format {{.Internal}} qa-session-pr') return 'true\\n'
  if (c === 'inspect --format {{.State.Running}} qa-fwd-pr') return 'true\\n'
  if (args[0] === 'logs' && args.at(-1) === 'qa-fwd-pr') return 'qa-forwarder ready\\n'
  return null
}

function makeSession({ provisionerOptions = {}, answer = () => null } = {}) {
  const exec = recordingExec({ answer: async (args, opts) => (await answer(args, opts)) ?? topologyAnswers(args) })""")

# probeDocker: answer only its own reads, and give a probe function its args
sub("""    if (args[0] === 'network' && args[1] === 'inspect') return gateway
    if (args[0] === 'inspect') return args.at(-1) === 'qa-pg-pr' ? pr : base
    if (args[0] === 'run' && args.includes('qa-probe-pr')) return typeof probe === 'function' ? probe(opts) : probe""",
    """    if (args[0] === 'network' && args[1] === 'inspect' && args.includes('{{range .IPAM.Config}}{{.Gateway}} {{end}}')) return gateway
    if (args[0] === 'inspect' && /^qa-pg-/.test(args.at(-1))) return args.at(-1) === 'qa-pg-pr' ? pr : base
    if (args[0] === 'run' && args.includes('qa-probe-pr')) return typeof probe === 'function' ? probe(opts, args) : probe""")

sub("""const probeArgs = call => call.args.slice(call.args.indexOf('probe') + 1)
""", """const probeArgs = call => call.args.slice(call.args.indexOf('probe') + 1)
// The targets the probe asks the forwarder's proxy for: past the third `--`,
// after the proxy itself.
const proxyTargets = args => {
  const own = args.slice(args.indexOf('probe') + 1)
  const parts = own.join('\\u0000').split('\\u0000--\\u0000').map(part => part.split('\\u0000'))
  return parts.length > 3 ? parts[3].slice(1) : []
}
// A clean probe with the topology up: its own database, and every target
// refused by the proxy.
const refusedAll = (lines = 'self 172.20.0.3:5432\\n') => (opts, args) => `${lines}${proxyTargets(args).map(t => `refused ${t}\\n`).join('')}probe done\\n`
""")

# the fallback test: the new reason
sub("""    assert.match(out.reasons.at(-1), /^the PR pane's internal network couldn't be set up \\((Error response from daemon: |pull node:22-alpine failed after 3 attempts).+\\), so it runs on an ordinary network$/, step)""",
    """    assert.match(out.reasons.at(-1), /^egress isn't restricted: the PR pane's internal network couldn't be set up \\((Error response from daemon: |pull node:22-alpine failed after 3 attempts).+\\)$/, step)""")

# the probe test: a clean probe refuses every target
sub("""  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ base: '172.19.0.2 fd00:19::2 \\n', pr: '172.20.0.3 fd00:20::3 \\n', probe: 'self 172.20.0.3:5432\\nself fd00:20::3:5432\\nrefused 172.19.0.2:5432\\nprobe done\\n' }) })""",
    """  const s = makeSession({ provisionerOptions: INTERNAL, answer: probeDocker({ base: '172.19.0.2 fd00:19::2 \\n', pr: '172.20.0.3 fd00:20::3 \\n', probe: refusedAll('self 172.20.0.3:5432\\nself fd00:20::3:5432\\n') }) })""")
sub("""  const clean = 'self 172.20.0.3:5432\\nrefused host.docker.internal:3100\\nprobe done\\n'""",
    """  const clean = refusedAll()""")
sub("""  assert.deepEqual(await verdict({}, 'self 172.20.0.3:5432\\nproxied 172.19.0.2:5432\\nprobe done\\n'), {""",
    """  assert.deepEqual(await verdict({}, (opts, args) => refusedAll()(opts, args).replace('refused 172.19.0.2:5432', 'proxied 172.19.0.2:5432')), {""")
sub("""  assert.equal((await verdict({}, 'listener host.docker.internal\\nself 172.20.0.3:5432\\nrefused 172.19.0.2:5432\\nprobe done\\n')).verdict, 'reachable')""",
    """  assert.equal((await verdict({}, refusedAll('listener host.docker.internal\\nself 172.20.0.3:5432\\n'))).verdict, 'reachable')""")
open(p, 'w').write(s)
print('ok')
