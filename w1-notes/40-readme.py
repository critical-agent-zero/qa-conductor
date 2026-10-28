p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/README.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:90], s.count(a))
    s = s.replace(a, b, 1)


# the options table: the two new options
sub("""| `internal` | `null` (off) | `true`, or `{ egress, image }`: the PR pane on an internal network, its only way in and out a forwarder ([below](#the-pr-pane-on-an-internal-network)). `egress` is the allowlist (default `[]`: no egress at all), `image` the forwarder's (default `node:22-alpine`). A bad entry or option throws |
""", """| `internal` | `null` (off) | `true`, or `{ egress, image }`: the PR pane on an internal network, its only way in and out a forwarder ([below](#the-pr-pane-on-an-internal-network)). `egress` is the allowlist (default `[]`: no egress at all), `image` the forwarder's (default `node:22-alpine`). A bad entry or option throws |
| `forwarderReadyMs` | `10000` | with `internal`: how long the forwarder may take to say it is ready before the topology counts as not set up |
| `log` | `console` | where the Provisioner logs, with `error(line)`: an `internal` topology that couldn't be set up |
""")

# teardown and sweep bullets
sub("""- `teardown` removes the pane's containers (a migrate run still in flight, and the PR pane's probe, among them) and their volumes, then its network and its env file.""",
    """- `teardown` removes the pane's containers (a migrate run still in flight, and the PR pane's probe, among them) and their volumes, then its network and its env file. With `internal`, the PR pane's also removes the forwarder and the edge network; the base pane's leaves them alone.""")
sub("""- `sweep` removes both env files, which hold an earlier run's env and passwords, then every container with `createDocker`'s `label` and both panes' networks.""",
    """- `sweep` removes both env files, which hold an earlier run's env and passwords, then every container with `createDocker`'s `label` (the forwarder among them), both panes' networks, and, only while `internal` is on, the PR pane's edge network.""")

# the egress bullet: nothing else, DNS included
sub("""    An app that ignores them reaches nothing outside its network.""",
    """    An app that ignores them reaches nothing outside its network. On Docker, the PR pane's containers also get `--dns 192.0.2.1`, an address nothing answers, so no name outside the network resolves for them ([its limits](#the-pr-pane-on-an-internal-network): DNS).""")

# the verdict, up or not, the fallback, cleanup
sub("""  - the probe decides alone. The runtime's own reasons (Docker Desktop's forwarding, Podman's networks) and the macOS floor give way to it. It tries the same addresses as ever, from the internal network;
  - the probe also asks the forwarder's proxy for each of them, as a `CONNECT`. One it lets through is a hit, and a proxy that doesn't answer at all makes the verdict `unknown`.
- **It fails closed.**
  - If the internal network, the forwarder's image, the forwarder or the join fails, the PR pane runs as it would without `internal`: on an ordinary network, its app published, no proxy.
  - The check's result then carries no `internal`, so the floors apply. A verdict that isn't `isolated` says why the topology couldn't be set up.
  - A forwarder that dies later takes the PR app's port with it: the pane goes down rather than open.
- **Cleanup:** `teardown` removes the forwarder and the edge network too, and `sweep` removes the edge network. An internal network left over is reused only when it is internal.""",
    """  - the probe decides alone. The runtime's own reasons (Docker Desktop's forwarding, Podman's networks, a `docker info` that fails under the podman-docker shim) and the macOS floor give way to it. It tries the same addresses as ever, from the internal network;
  - the probe also asks the forwarder's proxy for each of them, as a `CONNECT`. One it lets through is a hit. The proxy must answer for every one, proxied or refused: one it is silent on makes the verdict `unknown`, and the reason names it.
- **Up, or not.** The topology is up once `qa-session-pr` reads back as internal, and the forwarder is running and has logged that it is ready, within `forwarderReadyMs` (10 s). Triage's log tail for the PR app then ends with the forwarder's, under `[qa-fwd-pr]`.
- **If it can't be set up** (the internal network, the forwarder's image, the forwarder, the join or its readiness):
  - the PR pane runs as it would without `internal`: on an ordinary network, its app published, no proxy, and its egress isn't restricted;
  - the Provisioner logs that, through `log.error`: `[qa] the PR pane's internal network couldn't be set up (…): it runs on an ordinary network, and its egress isn't restricted`;
  - the check's result carries no `internal`, so the floors apply, and it is never better than `unknown`, with the reason `egress isn't restricted: the PR pane's internal network couldn't be set up (…)`. So `QA_REQUIRE_ISOLATION=1` refuses the session, and the harness's chip says why;
  - the undo must remove the internal network. When it can't, or finds an internal one still there as it makes the ordinary one, the boot fails instead.

  A forwarder that dies later takes the PR app's port with it: the pane goes down rather than open.
- **Cleanup:** the PR pane's `teardown` removes the forwarder and the edge network too, and the base pane's leaves them alone. `sweep` removes the forwarder with the other labelled containers, and the edge network only while `internal` is on: one an earlier run left before `internal` was turned off stays until `docker network rm qa-session-pr-edge`. An internal network left over is reused only when it is internal.""")

# the limits: DNS
sub("""  - Only HTTP and HTTPS go out, through the proxy. An app reaches a host only if its HTTP client honours the proxy env: a Node.js that supports `NODE_USE_ENV_PROXY` does with it set, and most other clients read `HTTPS_PROXY`. Raw TCP to a database elsewhere, or SMTP, doesn't go out.
  - A runtime whose internal networks have no DNS can't resolve `qa-pg-pr` or `qa-egress` there, so the PR pane fails to boot.""",
    """  - Only HTTP and HTTPS go out, through the proxy. An app reaches a host only if its HTTP client honours the proxy env: a Node.js that supports `NODE_USE_ENV_PROXY` does with it set, and most other clients read `HTTPS_PROXY`. Raw TCP to a database elsewhere, or SMTP, doesn't go out.
  - **DNS.** Docker Engine before 23.0.11, 25.0.0 to 25.0.4, and 26.0.0-rc1 to rc3, with the host's resolver on its loopback (systemd-resolved, dnsmasq), resolves an internal network's outside names through the host, so PR code could carry data out in its queries (CVE-2024-29018). So on Docker the PR pane's containers run with `--dns 192.0.2.1`, the advisory's workaround: names on the network still resolve, through Docker's own DNS, and an outside one gets no answer. The forwarder resolves the hosts it lets through itself. Podman's DNS answers nothing outside an internal network, and a `--dns` would replace it, so there it gets none. A container you start on `qa-session-pr` yourself gets no `--dns`: upgrade an affected Engine anyway.
  - A runtime whose internal networks have no DNS can't resolve `qa-pg-pr` or `qa-egress` there, so the PR pane fails to boot.""")

# the check by hand: DNS
sub("""     - `docker run --rm --network qa-session-pr busybox nc -zw3 <an address of qa-pg-base> 5432`.
""", """     - `docker run --rm --network qa-session-pr busybox nc -zw3 <an address of qa-pg-base> 5432`;
     - an outside name, as the PR pane's containers resolve it: `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com` (on Podman, without `--dns`);
     - and as any container there resolves it: `docker run --rm --network qa-session-pr busybox nslookup example.com`. If this one answers, on Docker, the Engine has CVE-2024-29018 ([DNS](#the-pr-pane-on-an-internal-network), above): the PR pane's own containers are covered by their `--dns`, but upgrade it.
""")
open(p, 'w').write(s)
print('ok')

s = open(p).read()
sub("""`createNetwork(name, { internal })`, `networkInternal(name)`, `rmLabelledNetwork(name)`""",
    """`createNetwork(name, { internal })`, `networkInternal(name)`, `containerRunning(name)`, `rmLabelledNetwork(name)`""")
sub("""`runPg`, `runMigrate` and `runApp` run their containers with `--cap-drop NET_RAW`.""",
    """`runPg`, `runMigrate` and `runApp` run their containers with `--cap-drop NET_RAW`. They and `runProbe` take a `dns` option, the container's DNS server (`--dns`).""")
open(p, 'w').write(s)
print('ok 2')
