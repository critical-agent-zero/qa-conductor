p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/integration/docker-internal.test.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""// It creates and removes the qa-* containers and networks on the runtime's
// host, builds a small app image, and pulls postgres:16, node:22-alpine and
// busybox. So it runs only when asked: QA_DOCKER_IT=1. Asked, it fails
// rather than skips when the runtime doesn't answer. QA_DOCKER_IT_CLI names
// the CLI to drive, words split on spaces (default `docker`; CI's Podman
// leg uses `sudo podman`).""", """// It creates and removes the qa-* containers and networks on the runtime's
// host, builds a small app image, and pulls postgres:16, node:22-alpine and
// busybox. So it runs only when asked: QA_DOCKER_IT=1. Asked, it fails
// rather than skips when the runtime doesn't answer. QA_DOCKER_IT_CLI names
// the command to drive, words split on spaces (default `docker`). CI's
// Podman leg drives the docker CLI against Podman's Docker-compatible
// socket, so `docker version` names Podman, as for any Podman user of this
// Provisioner who points the docker CLI there.""")
sub("""const [CLI, ...CLI_ARGS] = (process.env.QA_DOCKER_IT_CLI || 'docker').split(' ').filter(Boolean)
const PODMAN = /podman/.test(CLI) || CLI_ARGS.some(word => /podman/.test(word))
""", """const [CLI, ...CLI_ARGS] = (process.env.QA_DOCKER_IT_CLI || 'docker').split(' ').filter(Boolean)
""")
sub("""const answers = await cli('version').then(() => true, err => err)
const skip = !ASKED
  ? `QA_DOCKER_IT=1 isn't set: this test creates and removes the qa-* containers and networks on the runtime's host, so it runs only when asked (CI's docker-integration job asks)`
  : false
""", """const version = await cli('version').then(out => out, err => err)
const answers = typeof version === 'string'
const PODMAN = answers && /podman/i.test(version)
const firstLine = err => String(err?.message ?? err).split('\\n')[0]
const skip = ASKED
  ? false
  : `QA_DOCKER_IT=1 isn't set${answers ? '' : `, and no container runtime answers here (\\`${[CLI, ...CLI_ARGS].join(' ')} version\\`: ${firstLine(version)})`}: this test creates and removes the qa-* containers and networks on the runtime's host, so it runs only when asked (CI's docker-integration job asks)`
""")
sub("""test('a real runtime answers', { skip }, () => {
  assert.equal(answers, true, `QA_DOCKER_IT=1, but \\`${[CLI, ...CLI_ARGS].join(' ')} version\\` failed: ${answers?.message}`)
})""", """test('a real runtime answers', { skip }, () => {
  assert.equal(answers, true, `QA_DOCKER_IT=1, but \\`${[CLI, ...CLI_ARGS].join(' ')} version\\` failed: ${firstLine(version)}`)
})""")
# checks that go out of the pane: without the proxy env the PR pane gets,
# so they test the network, not the forwarder
sub("""// A command run in the PR (or base) pane's app container, as PR code would.
const inPane = (role, ...args) => succeeds('exec', `qa-app-${role}`, ...args)
const outOf = (role, ...args) => cli('exec', `qa-app-${role}`, ...args)""", """// A command run in the PR (or base) pane's app container, as PR code would.
// `direct` drops the proxy env the PR pane gets, so it tests the network,
// not the forwarder's refusals.
const NO_PROXY_ENV = 'unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY;'
const inPane = (role, ...args) => succeeds('exec', `qa-app-${role}`, ...args)
const direct = (role, command) => succeeds('exec', `qa-app-${role}`, 'sh', '-c', `${NO_PROXY_ENV} ${command}`)
const outOf = (role, ...args) => cli('exec', `qa-app-${role}`, ...args)""")
sub("""  const fetchIn = (role, ip) => inPane(role, 'wget', '-q', '-T', '3', '-O', '-', `http://${ip}:${canary.port}${canary.path}`)""",
    """  const fetchIn = (role, ip) => direct(role, `wget -q -T 3 -O - http://${ip}:${canary.port}${canary.path}`)""")
sub("""  assert.equal(await inPane('pr', 'wget', '-q', '-T', '3', '-O', '-', 'http://169.254.169.254/'), false, 'the PR pane reached 169.254.169.254')""",
    """  assert.equal(await direct('pr', 'wget -q -T 3 -O - http://169.254.169.254/'), false, 'the PR pane reached 169.254.169.254')""")
sub("""  // DNS: names on the network resolve, outside names don't
  assert.equal(await inPane('pr', 'nslookup', 'qa-egress'), true, 'qa-egress resolves on the internal network')
  assert.equal(await inPane('pr', 'nslookup', 'example.com'), false, 'an outside name resolved from the PR pane')""",
    """  // DNS: names on the network resolve, outside names don't (read from
  // what nslookup prints, not its exit code)
  const lookup = async name => outOf('pr', 'sh', '-c', `nslookup ${name} 2>&1; true`)
  assert.match(await lookup('qa-egress'), /Name:\\s+qa-egress/, 'qa-egress resolves on the internal network')
  const outside = await lookup('example.com')
  assert.doesNotMatch(outside, /Name:\\s+example\\.com/, `an outside name resolved from the PR pane:\\n${outside}`)""")
open(p, 'w').write(s)
print('ok')
