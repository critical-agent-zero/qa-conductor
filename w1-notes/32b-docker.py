p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/lib/docker.mjs'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b, 1)


sub("""    async runApp(name, image, network, envFile, hostPort) {
      return run([
        'run', '-d',
        '--name', name,
        '--network', network,
        '--label', label,
        ...NO_RAW,
        '--env-file', envFile,
        '-p', `127.0.0.1:${hostPort}:3000`,
        image,
      ])
    },""", """    // hostPort null publishes nothing: on an internal network (#32) the
    // forwarder publishes the app's port in its place.
    async runApp(name, image, network, envFile, hostPort) {
      return run([
        'run', '-d',
        '--name', name,
        '--network', network,
        '--label', label,
        ...NO_RAW,
        '--env-file', envFile,
        ...(hostPort === null ? [] : ['-p', `127.0.0.1:${hostPort}:3000`]),
        image,
      ])
    },

    // The PR pane's forwarder (lib/forwarder.mjs, #32), on `network`, an
    // ordinary one: `source` run with node, its config in PANE_FORWARDER. It
    // publishes its port 3000, which it pipes to the PR app, on the host's
    // loopback. No capabilities, a read-only root, no privilege gain, not
    // root, and no mounts.
    async runForwarder(name, image, network, { hostPort, config, source }) {
      assertSafe(name, 'container name')
      return run([
        'run', '-d',
        '--name', name,
        '--network', network,
        '--label', label,
        '--cap-drop', 'ALL', '--read-only', '--security-opt', 'no-new-privileges', '--user', 'node',
        '-p', `127.0.0.1:${hostPort}:3000`,
        '-e', `PANE_FORWARDER=${JSON.stringify(config)}`,
        '--entrypoint', 'node',
        image,
        '--input-type=module', '-e', source,
      ])
    },

    // A running container joins another network, under `alias` there too.
    async connectNetwork(network, container, { alias }) {
      assertSafe(container, 'container name')
      return run(['network', 'connect', '--alias', alias, network, container])
    },""")
sub("""    async createNetwork(name) {
      return run(['network', 'create', '--label', label, name])
    },""", """    // `internal`: a network with no route off itself (#32).
    async createNetwork(name, { internal = false } = {}) {
      return run(['network', 'create', '--label', label, ...(internal ? ['--internal'] : []), name])
    },

    // Whether a network is internal, as Docker and Podman report it.
    async networkInternal(name) {
      return (await run(['network', 'inspect', '--format', '{{.Internal}}', name])).trim() === 'true'
    },""")
open(p, 'w').write(s)
print('ok')
