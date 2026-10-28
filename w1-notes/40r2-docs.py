R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:120], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""A daemon that isn't on this host (the current context's endpoint, which `DOCKER_HOST` sets, isn't `unix://` or `npipe://`) makes it `unknown`.""",
     """A daemon that isn't on this host (the current context's endpoint, which `DOCKER_HOST` sets, isn't `unix://` or `npipe://`) makes it `unknown`. The podman-docker shim has no Docker context, so there the endpoint is Podman's own: `CONTAINER_HOST`, else the connection `CONTAINER_CONNECTION` names, else the default connection (`podman system connection list`); with none, Podman runs its containers on this host."""),
    ("""The forwarder logs it (`docker logs qa-fwd-pr`).""",
     """The forwarder logs it to stdout (`docker logs qa-fwd-pr`), so triage's log tail shows it."""),
    ("""  - **Every wait is bounded:** a connect takes at most 10 s, and a tunnel or an answer through which nothing has moved for 5 minutes is closed. One waiting on a slow reader that still reads isn't idle.""",
     """  - **Every wait is bounded:** a connect takes at most 10 s, and a tunnel or an answer through which nothing has moved is closed: after 5 minutes, or up to about 10 where each side waits on the other, since the timer then looks twice. So is an answer the host has finished but the PR has stopped reading. One waiting on a slow reader that still reads isn't idle."""),
    ("""  - **DNS.** Docker Engine before 23.0.11, 25.0.0 to 25.0.4, and 26.0.0-rc1 to rc3, with the host's resolver on its loopback""",
     """  - **DNS.** A Docker Engine without the fix (23.0.11, 25.0.5, 26.0.0 and later), with the host's resolver on its loopback"""),
    ("""**`docker`.** `createDocker({ execFileFn, label, postgres })` runs""", """**`docker`.** `createDocker({ execFileFn, label, postgres, env })` runs"""),
    ("""| `label` | `'qa-conductor-session'` | put on every container and network it creates; `sweepQaContainers()` removes whatever carries it |
""", """| `label` | `'qa-conductor-session'` | put on every container and network it creates; `sweepQaContainers()` removes whatever carries it |
| `env` | `process.env` | where `endpoint({ podman: true })` reads `CONTAINER_HOST` and `CONTAINER_CONNECTION` |
"""),
    ("""`endpoint()` (the current context's daemon endpoint)""",
     """`endpoint({ podman })` (the current context's daemon endpoint; with `podman` and no context, as under the podman-docker shim, Podman's own connection's URI, or `'local'` when it has none)"""),
])

edit('CHANGELOG.md', [
    ("""  - **Triage** adds the forwarder's log tail to the PR app's.
""", """  - **Triage** adds the forwarder's log tail to the PR app's. The forwarder writes every line to stdout, its refusals included, so the tail shows them.
  - **Under the podman-docker shim,** whose `docker context inspect` is Podman's, the daemon's endpoint is Podman's own connection, so the probe can decide there too.
  - **The forwarder bounds a plain-HTTP answer's PR side too:** an answer the host has finished, but the PR stopped reading, is closed once nothing moves.
"""),
    ("""- **New in `createDocker`:** `createNetwork(name, { internal })`,""", """- **New in `createDocker`:** an `env` option, and `endpoint({ podman })`. `createNetwork(name, { internal })`,"""),
])
print('ok')
