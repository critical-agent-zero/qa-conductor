R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:90])
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


INTERNAL_SECTION = """#### The PR pane on an internal network

With `internal`, the PR pane gets no route off its own network. So on Docker Desktop and Podman machine too it can reach neither the host's loopback, where the base app is published, nor the base pane, and the probe can find it `isolated`. It is off by default: it pulls a Node image and runs one more container, and what it does on each runtime can only be checked by hand (below).

```js
const provisioner = createDockerProvisioner({
  docker: createDocker({ execFileFn: makeExecFileFn() }),
  fsx: fs.promises,
  workDir: '/var/lib/qa-conductor',
  internal: { egress: ['api.example.com', '*.example.net'] },
})
```

- **The topology.**
  - **`qa-session-pr` is created `--internal`.** The PR pane's postgres, migrate run, app and probe join only it.
  - **The forwarder, `qa-fwd-pr`,** runs the package's `lib/forwarder.mjs` with `node` from `internal.image`. It starts on an ordinary network, `qa-session-pr-edge`, then joins `qa-session-pr` as `qa-egress`. It runs with `--cap-drop ALL`, `--read-only` and `--security-opt no-new-privileges`, as the image's `node` user, with no mounts. Its config is one env var, `PANE_FORWARDER`.
  - **Inbound:** the forwarder publishes `127.0.0.1:<hostPorts.pr>` and pipes each connection to `qa-app-pr:3000`. The PR app publishes nothing.
  - **Egress:** an HTTP proxy at `qa-egress:3128`. HTTPS goes through `CONNECT` and is never intercepted. The PR pane's env gets these, over the EnvTransform's:
    - `HTTP_PROXY` and `HTTPS_PROXY`, and their lowercase forms;
    - `NO_PROXY` (`localhost`, `127.0.0.1`, `::1`, `qa-pg-pr` and `qa-app-pr`);
    - `NODE_USE_ENV_PROXY=1`.

    An app that ignores them reaches nothing outside its network.
- **The allowlist, `egress`.**
  - **Entries:** `api.example.com` (that host), `*.example.com` (any host under it, not the domain itself) or a public IP address, each with an optional `:port`. Without a port, an entry allows 80 and 443. Anything else throws when the Provisioner is made.
  - **Empty, or `internal: true`:** no egress at all.
  - **What a request needs:** a host on the list, and every address it resolves to public. The forwarder connects to the address it checked, so a second DNS answer can't swap it.
  - **Always refused, listed or not:** loopback, private, link-local (cloud metadata), CGNAT and Tailscale, unique-local and the like, so every address a runtime gives the host.
  - **A refusal** answers `403` with `X-QA-Egress: refused` and a reason. The forwarder logs it (`docker logs qa-fwd-pr`).
- **The verdict.** With the topology up, the check's result says `internal: true`, and:
  - the probe decides alone. The runtime's own reasons (Docker Desktop's forwarding, Podman's networks) and the macOS floor give way to it. It tries the same addresses as ever, from the internal network;
  - the probe also asks the forwarder's proxy for each of them, as a `CONNECT`. One it lets through is a hit, and a proxy that doesn't answer at all makes the verdict `unknown`.
- **It fails closed.**
  - If the internal network, the forwarder's image, the forwarder or the join fails, the PR pane runs as it would without `internal`: on an ordinary network, its app published, no proxy.
  - The check's result then carries no `internal`, so the floors apply. A verdict that isn't `isolated` says why the topology couldn't be set up.
  - A forwarder that dies later takes the PR app's port with it: the pane goes down rather than open.
- **Cleanup:** `teardown` removes the forwarder and the edge network too, and `sweep` removes the edge network. An internal network left over is reused only when it is internal.
- **Its limits:**
  - Only the PR pane is internal. The base pane runs as before.
  - The forwarder listens on IPv4.
  - A private address can't be allowed, even for a listed host. An app that needs an internal service leaves `internal` off.
  - Only HTTP and HTTPS go out, through the proxy. An app reaches a host only if its HTTP client honours the proxy env: Node 24 does with `NODE_USE_ENV_PROXY=1`, and most clients read `HTTPS_PROXY`. Raw TCP to a database elsewhere, or SMTP, doesn't go out.
  - A runtime whose internal networks have no DNS can't resolve `qa-pg-pr` or `qa-egress` there, so the PR pane fails to boot.
- **Check it by hand, once per runtime.** The tests run no real Docker. Boot a PR, then while it runs:
  1. The harness chip should say `isolated`.
  2. From the PR pane's network, the host's loopback and the base pane's database must fail:
     - `docker run --rm --network qa-session-pr curlimages/curl -sS -m 3 http://host.docker.internal:<harness port>/qa/` (on Podman, `host.containers.internal`);
     - `docker run --rm --network qa-session-pr busybox nc -zw3 <an address of qa-pg-base> 5432`.
  3. Through the proxy, a host off the list gets `403`, and `docker logs qa-fwd-pr` says why: `docker run --rm --network qa-session-pr curlimages/curl -sS -m 5 -x http://qa-egress:3128 https://example.com`.
  4. A host on the list goes through, the same way.

"""

edit('README.md', [
    # the seams: the Provisioner's new member
    ("`isolation` (`'shared-host'`, or `({signal, canary}) → {verdict, reasons}`) | Where panes run",
     "`isolation` (`'shared-host'`, or `({signal, canary}) → {verdict, reasons, internal?}`), `internal: true` when it means to put the PR pane on an internal network | Where panes run"),
    ("""  - The core raises the result to its floors and records it ([Isolation verdicts](#isolation-verdicts)). `bootSession` takes the call as `deps.checkIsolation({stage, signal})`, with `stage` `'start'` before the build and `'panes'` at this point; a throw fails the boot.""",
     """  - The core raises the result to its floors and records it ([Isolation verdicts](#isolation-verdicts)). `bootSession` takes the call as `deps.checkIsolation({stage, signal})`, with `stage` `'start'` before the build and `'panes'` at this point; a throw fails the boot.
  - **An internal network.** A Provisioner that means to put the PR pane on a network with no route off itself says so with `internal: true`. Then the macOS floor waits for its check, and is left out only when the check's result says `internal: true` too: the PR pane is on such a network, and the check's probe speaks for the VM's forwarding. The Docker Provisioner's `internal` option does this ([its section](#the-pr-pane-on-an-internal-network))."""),
    # the floors
    ("""  - on macOS, never better than `reachable`: containers run in a VM that forwards the host's loopback (left out for a Provisioner that declares `shared-host`, which runs none);""",
     """  - on macOS, never better than `reachable`: containers run in a VM that forwards the host's loopback. It is left out for a Provisioner that declares `shared-host`, which runs none, and when the check's result says the PR pane is on an internal network, as with the Docker Provisioner's [`internal`](#the-pr-pane-on-an-internal-network);"""),
    # the runtime table
    ("""| Process Provisioner (any host) | yes | yes, as the same user | `shared-host` |""",
     """| Docker Desktop or Podman machine, with the Docker Provisioner's [`internal`](#the-pr-pane-on-an-internal-network) | not from the PR pane, if its probe finds no way | no: the PR pane's network has no route off itself | `isolated`, once checked by hand |
| Process Provisioner (any host) | yes | yes, as the same user | `shared-host` |"""),
    # the Docker Provisioner's option
    ("""| `probeTimeoutMs` | `30000` | how long the isolation probe's `docker run` may take in all, after which the docker CLI is killed (`SIGKILL`), the probe container removed, and the verdict is `unknown`. A teardown or takeover during the probe stops it too |""",
     """| `probeTimeoutMs` | `30000` | how long the isolation probe's `docker run` may take in all, after which the docker CLI is killed (`SIGKILL`), the probe container removed, and the verdict is `unknown`. A teardown or takeover during the probe stops it too |
| `internal` | `null` (off) | `true`, or `{ egress, image }`: the PR pane on an internal network, its only way in and out a forwarder ([below](#the-pr-pane-on-an-internal-network)). `egress` is the allowlist (default `[]`: no egress at all), `image` the forwarder's (default `node:22-alpine`). A bad entry or option throws |"""),
    ("""The provisioner also has `networks`, `{ base, pr }` (frozen): the two network names.
""", """The provisioner also has `networks`, `{ base, pr }` (frozen): the two network names, and `internal`, whether the `internal` option is on.

""" + INTERNAL_SECTION),
    # the effect wrappers
    ("""`runMigrate`, `runApp`, `waitHealthyApp`, `psql`, `rmForce` and `rmNetwork` (which reject unless docker says only that what they remove is already gone), `createNetwork`, `rmLabelledNetwork(name)`""",
     """`runMigrate`, `runApp` (a `hostPort` of `null` publishes nothing), `waitHealthyApp`, `psql`, `rmForce` and `rmNetwork` (which reject unless docker says only that what they remove is already gone), `createNetwork(name, { internal })`, `networkInternal(name)`, `rmLabelledNetwork(name)`"""),
    ("""`containerAddresses(name)` (IPv4 and IPv6) and `runProbe(name, network, script, args, { timeoutMs, signal })` (default 30 s, then `SIGKILL`; `signal` stops it too).""",
     """`containerAddresses(name)` (IPv4 and IPv6) and `runProbe(name, network, script, args, { timeoutMs, signal })` (default 30 s, then `SIGKILL`; `signal` stops it too), and for an internal network `runForwarder(name, image, network, { hostPort, config, source })` and `connectNetwork(network, container, { alias })`."""),
    ("""`login`, `createDatabase`, `pipeDump`, `cloneDb`, `logsTail` and `runProbe` throw on a name that isn't letters, digits, `_` and `-`.""",
     """`login`, `createDatabase`, `pipeDump`, `cloneDb`, `logsTail`, `runProbe`, `runForwarder` and `connectNetwork` throw on a name that isn't letters, digits, `_` and `-`."""),
    # known limits
    ("""    - where containers can reach the host's loopback (Docker Desktop, Podman machine, and the Lima-based colima, Lima and Rancher Desktop), PR code can still reach the base pane's app, on its published port.""",
     """    - where containers can reach the host's loopback (Docker Desktop, Podman machine, and the Lima-based colima, Lima and Rancher Desktop), PR code can still reach the base pane's app, on its published port, unless the PR pane is on an [internal network](#the-pr-pane-on-an-internal-network)."""),
])

edit('CHANGELOG.md', [
    ("""### The Docker Provisioner
""", """### The PR pane on an internal network

- **The Docker Provisioner can put the PR pane on an internal network** (`internal`, off by default, #32). The PR pane can then reach neither the host's loopback nor the base pane, on Docker Desktop and Podman machine too, so its isolation probe can find it `isolated` there. README's [The PR pane on an internal network](README.md#the-pr-pane-on-an-internal-network) has the details and a check by hand for each runtime.
  - **The topology:** `qa-session-pr` is created `--internal`. A forwarder, `qa-fwd-pr`, runs the package's `lib/forwarder.mjs` in `node:22-alpine` with no capabilities, a read-only root and no mounts. It sits on an ordinary network, `qa-session-pr-edge`, and joins the internal one as `qa-egress`. It publishes the PR app on `127.0.0.1:<hostPorts.pr>`, and its HTTP proxy is the PR pane's only way out.
  - **The allowlist, `internal.egress`:** host names, `*.domains` and public addresses, with an optional port (80 and 443 without one), checked as the Provisioner is made. Empty by default: no egress. A request goes out only to a listed host whose every address is public, and to the address checked. HTTPS is never intercepted.
  - **The verdict:** the check's result says `internal: true` once the topology is up. Then the probe decides, through the forwarder's proxy too, in place of the macOS floor and the Docker Desktop and Podman reasons.
  - **It fails closed:** if any of it can't be set up, the PR pane runs as it would without `internal`, the floors apply, and a verdict that isn't `isolated` says why.
- **New in the seams:** a Provisioner's optional `internal: true`, and a check's result's `internal`. The macOS floor waits for such a Provisioner's check, and is left out only when its result says `internal: true`. `floors` takes `internal`.
- **New in `createDocker`:** `createNetwork(name, { internal })`, `networkInternal(name)`, `runForwarder(name, image, network, { hostPort, config, source })` and `connectNetwork(network, container, { alias })`. `runApp` publishes nothing when `hostPort` is `null`.
- **Nothing changes without `internal`.**

### The Docker Provisioner
"""),
])
print('ok')
