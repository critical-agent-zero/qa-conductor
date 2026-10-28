R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:120], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


SHIM_SETUP = [
    "      - if: matrix.runtime == 'podman-docker'",
    "        run: |",
    "          sudo systemctl stop docker.socket docker.service",
    "          printf '%s\\n' '#!/bin/sh' '[ -e /etc/containers/nodocker ] || echo \"Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.\" >&2' 'exec podman \"$@\"' | sudo tee /usr/local/bin/docker > /dev/null",
    "          sudo chmod 755 /usr/local/bin/docker",
]
RUN_OLD = "      - run: node --test --test-force-exit --test-reporter=spec test/integration/docker-internal.test.mjs | tee it.log"
RUN_NEW = "      - run: ${{ matrix.runtime == 'podman-docker' && 'sudo -E env \"PATH=$PATH\"' || '' }} node --test --test-force-exit --test-reporter=spec test/integration/docker-internal.test.mjs | tee it.log"

edit('.github/workflows/ci.yml', [
    ("        runtime: [docker, podman]\n", "        runtime: [docker, podman, podman-docker]\n"),
    ("""          sudo chmod a+rw /run/podman/podman.sock
""", """          sudo chmod a+rw /run/podman/podman.sock
""" + '\n'.join(SHIM_SETUP) + '\n'),
    (RUN_OLD + '\n', RUN_NEW + '\n'),
])


def js(line):
    # a pinned line, as test/package.test.mjs writes it
    if "'" in line and '"' not in line:
        return '    "' + line + '",'
    if "'" not in line:
        return "    '" + line + "',"
    return '    `' + line.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${') + '`,'


edit('test/package.test.mjs', [
    ("    '        runtime: [docker, podman]',\n", "    '        runtime: [docker, podman, podman-docker]',\n"),
    ("""    '          sudo chmod a+rw /run/podman/podman.sock',
""", """    '          sudo chmod a+rw /run/podman/podman.sock',
""" + '\n'.join(js(line) for line in SHIM_SETUP) + '\n'),
    ("    '" + RUN_OLD + "',\n", js(RUN_NEW) + '\n'),
])

edit('lib/docker.mjs', [
    ("""    // A network's gateways, and a container's addresses on its networks.
    async networkGateways(name) {
      return (await run(['network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Gateway}} {{end}}', name])).split(/\\s+/).filter(Boolean)
    },""", """    // A network's gateways, and a container's addresses on its networks.
    // Docker's format, else Podman's own (its CLI, as behind the
    // podman-docker shim, has no .IPAM).
    async networkGateways(name) {
      const out = await run(['network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Gateway}} {{end}}', name])
        .catch(err => run(['network', 'inspect', '--format', '{{range .Subnets}}{{.Gateway}} {{end}}', name]).catch(() => { throw err }))
      return out.split(/\\s+/).filter(Boolean)
    },"""),
])

edit('test/integration/docker-internal.test.mjs', [
    ("""// the command to drive, words split on spaces (default `docker`). CI's
// Podman leg drives the docker CLI against Podman's Docker-compatible
// socket, so `docker version` names Podman, as for any Podman user of this
// Provisioner who points the docker CLI there.""", """// the command to drive, words split on spaces (default `docker`). CI's
// Podman leg drives the docker CLI against Podman's Docker-compatible
// socket, so `docker version` names Podman, as for any Podman user of this
// Provisioner who points the docker CLI there. Its podman-docker leg puts
// the podman-docker shim's script first on PATH, as `docker`, and runs this
// as root, so the shim drives rootful Podman's own CLI."""),
    ("""const gatewayOf = async network => (await cli('network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Gateway}} {{end}}', network)).trim().split(/\\s+/).filter(Boolean)""",
     """const gatewayOf = async network => (await cli('network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Gateway}} {{end}}', network).catch(() => cli('network', 'inspect', '--format', '{{range .Subnets}}{{.Gateway}} {{end}}', network))).trim().split(/\\s+/).filter(Boolean)"""),
])

edit('README.md', [
    ("""runs [`test/integration/docker-internal.test.mjs`](test/integration/docker-internal.test.mjs) against Docker Engine, and against Podman through its Docker-compatible socket.""",
     """runs [`test/integration/docker-internal.test.mjs`](test/integration/docker-internal.test.mjs) against Docker Engine, against Podman through its Docker-compatible socket, and against Podman's own CLI behind the podman-docker shim."""),
])
print('ok')
