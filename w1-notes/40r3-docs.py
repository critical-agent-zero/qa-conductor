R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""  - the probe's `isolated`;
  - that the PR pane reaches neither the host, the base pane's database nor `169.254.169.254`;
  - its DNS;
  - the proxy's refusals;
  - a fallback refused under `QA_REQUIRE_ISOLATION=1`;
  - that teardown and sweep leave nothing.""",
     """  - the probe's `isolated`;
  - that the PR pane reaches neither the host's loopback, the base pane's database nor `169.254.169.254`, and has no direct route out (`1.1.1.1:443`, which the base pane reaches);
  - a host service on `0.0.0.0`: out of reach on Docker Engine 28 and later, and on Podman reached only at the PR network's own gateway, which the probe reports (its limits, below);
  - its DNS;
  - the proxy's refusals;
  - a fallback refused under `QA_REQUIRE_ISOLATION=1`;
  - that teardown leaves nothing, before any sweep.

  The job isn't a required check yet: making it one is a repository setting, for later."""),
    ("""  - **Every wait is bounded:** a connect takes at most 10 s, and a tunnel or an answer through which nothing has moved is closed: after 5 minutes, or up to about 10 where each side waits on the other, since the timer then looks twice. So is an answer the host has finished but the PR has stopped reading. One waiting on a slow reader that still reads isn't idle.""",
     """  - **Every wait is bounded:** a connect takes at most 10 s, and a tunnel or an answer through which nothing has moved is closed: after 5 minutes, or up to about 10 where each side waits on the other, since the timer then looks twice. So is an answer the host has finished but the PR has stopped reading. One waiting on a slow reader that still reads isn't idle, as long as each `idleMs` the reader frees some room: a plain-HTTP answer's PR side is timed on its own, and the kernel's buffers can hide a very slow reader's progress for longer, so such a reader can be cut."""),
    ("""  - **The host's own address on the PR pane's network.** An internal network keeps the PR pane off the host's loopback and off other networks, but not off the host's address on its own bridge (its gateway; on Podman, `host.containers.internal` too). So a host service bound to `0.0.0.0`, or to that bridge's address, is reachable from the PR pane. CI found this on Docker Engine and on Podman, and checks it on both:
    - **The probe reports it:** each session's probe finds a conductor reachable there and says `reachable`.""",
     """  - **The host's own address on the PR pane's network, on Podman and Docker Engine before 28.** An internal network keeps the PR pane off the host's loopback and off other networks, but there not off the host's address on its own bridge (its gateway; on Podman, `host.containers.internal` too). So a host service bound to `0.0.0.0`, or to that bridge's address, is reachable from the PR pane. CI found this on Docker Engine and on Podman.
    - **On Docker Engine 28 and later it is closed:** the internal network is created with an isolated gateway (`com.docker.network.bridge.gateway_mode_ipv4=isolated`, and `_ipv6`), so its bridge has no address of the host's, and not even a host service on `0.0.0.0` is reachable. An Engine that refuses the option gets a plain internal network, and one left over without it is made again. CI checks both runtimes.
    - **The probe reports it for the conductor's own port only:** each session's probe tries the harness port there, finds a conductor reachable and says `reachable`. Other host services on `0.0.0.0` aren't probed."""),
    ("""`rmForce` and `rmNetwork` (which reject unless docker says only that what they remove is already gone)""",
     """`rmForce` and `rmNetwork` (which reject unless docker says only that what they remove is already gone; `rmForce` removes one name at a time, since Podman before 5.1 stops a batch at a name already gone, removes none of the rest, and still exits 0)"""),
    ("""`createNetwork(name, { internal })`, `networkInternal(name)`,""",
     """`createNetwork(name, { internal, isolatedGateway })`, `networkInternal(name)`, `networkGatewayIsolated(name)`,"""),
])

edit('CHANGELOG.md', [
    ("""- **New in `createDocker`:** an `env` option, and `endpoint({ podman })`. `createNetwork(name, { internal })`, `networkInternal(name)`,""",
     """- **New in `createDocker`:** an `env` option, and `endpoint({ podman })`. `createNetwork(name, { internal, isolatedGateway })`, `networkInternal(name)`, `networkGatewayIsolated(name)`,"""),
    ("""  - **The forwarder bounds a plain-HTTP answer's PR side too:** an answer the host has finished, but the PR stopped reading, is closed once nothing moves.
""",
     """  - **The forwarder bounds a plain-HTTP answer's PR side too:** an answer the host has finished, but the PR stopped reading, is closed once nothing moves.
  - **On Docker Engine 28 and later the internal network's gateway is isolated,** so the PR pane can't reach the host's `0.0.0.0` services either. Podman and older Engines keep the README's limit.
  - **`rmForce` removes one name at a time,** so teardown and `sweep` remove every container under Podman before 5.1 (the podman-docker shim on Ubuntu 24.04), whose `rm -f a b c` stops at a name already gone and removes nothing.
"""),
])
print('ok')
