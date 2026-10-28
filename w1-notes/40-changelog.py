p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/CHANGELOG.md'
s = open(p).read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b, 1)
sub("""  - **The allowlist, `internal.egress`:** host names, `*.domains` and public addresses, with an optional port (80 and 443 without one), checked as the Provisioner is made. Empty by default: no egress. A request goes out only to a listed host whose every address is public, and to the address checked. HTTPS is never intercepted.
  - **The verdict:** the check's result says `internal: true` once the topology is up. Then the probe decides, through the forwarder's proxy too, in place of the macOS floor and the Docker Desktop and Podman reasons.
  - **It fails closed:** if any of it can't be set up, the PR pane runs as it would without `internal`, the floors apply, and a verdict that isn't `isolated` says why.
""", """  - **The allowlist, `internal.egress`:** host names, `*.domains` and public addresses, with an optional port (80 and 443 without one), checked as the Provisioner is made. Empty by default: no egress. A request goes out only to a listed host whose every address is public, and to the address checked. HTTPS is never intercepted.
  - **No DNS out:** on Docker, the PR pane's containers run with `--dns 192.0.2.1`, which nothing answers, so an Engine with CVE-2024-29018 can't resolve their outside names through the host. Podman's DNS answers none there already.
  - **The verdict:** the check's result says `internal: true` once the topology is up: the network reads back internal, and the forwarder runs and says it is ready. Then the probe decides, through the forwarder's proxy too, which must answer for every address it tries, in place of the macOS floor and the Docker Desktop and Podman reasons.
  - **If it can't be set up,** the PR pane runs as it would without `internal`, and its egress isn't restricted. That is logged, the floors apply, and the verdict is never better than `unknown`, saying why, so `QA_REQUIRE_ISOLATION=1` refuses. An undo that can't remove the internal network fails the boot.
  - **Triage** adds the forwarder's log tail to the PR app's.
""")
sub("""- **New in `createDocker`:** `createNetwork(name, { internal })`, `networkInternal(name)`, `runForwarder(name, image, network, { hostPort, config, source })` and `connectNetwork(network, container, { alias })`. `runApp` publishes nothing when `hostPort` is `null`.""",
    """- **New in `createDocker`:** `createNetwork(name, { internal })`, `networkInternal(name)`, `containerRunning(name)`, `runForwarder(name, image, network, { hostPort, config, source })` and `connectNetwork(network, container, { alias })`. `runApp` publishes nothing when `hostPort` is `null`. `runPg`, `runMigrate`, `runApp` and `runProbe` take `dns`.
- **New in `createDockerProvisioner`:** `forwarderReadyMs` and `log`.""")
open(p, 'w').write(s)
print('ok')
