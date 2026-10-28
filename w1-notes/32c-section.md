
### Hardening opt-ins

Three more ways to narrow what the PR pane can reach, each opt-in, with what it does and doesn't guarantee. None of them changes the [isolation verdict](#isolation-verdicts): the probe and the declarations decide that. With the Docker Provisioner, the first is its [internal network](#the-pr-pane-on-an-internal-network).

#### A `sandbox-exec` profile for the process Provisioner (macOS)

**What it guarantees:** the PR pane's processes can't open a TCP connection to the ports the profile names on this Mac's loopback, over IPv4 or IPv6:
- the conductor's three (`QA_HARNESS_PORT`, `QA_BASE_PROXY_PORT`, `QA_PR_PROXY_PORT`);
- the base pane's service and database ports.

**What it doesn't:**
- The PR pane still runs as you. It can read and write your files (your browser's profile, which holds the capability, included), signal your processes, and use Unix sockets and every loopback port the profile doesn't name.
- So the verdict stays `shared-host`, and the trust gate is still the boundary.

**The profile** denies each port it is given. `sandbox-exec` checks a deny that names a port, but an allow after a broader deny doesn't reopen anything, so the profile names what to shut rather than what to open:

```scheme
; pr-pane.sb: no TCP to these loopback ports (IPv4 and IPv6)
(version 1)
(allow default)
(deny network-outbound (remote ip (string-append "localhost:" (param "HARNESS"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "BASE_PROXY"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "PR_PROXY"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "BASE_APP"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "BASE_DB"))))
```

**Wire it in through `command`.** The boot launches the base pane's database and services before the PR pane's, so `command` can note the base pane's ports and pass them to the PR pane's sandbox. `sandbox-exec` runs the command in its own place, with the same pid, so teardown still signals the server's group:

```js
import path from 'node:path'
import { createProcessProvisioner } from '@critical-labs/qa-conductor/adapters/provisioner-process'

const conductorPorts = { HARNESS: '3100', BASE_PROXY: '3101', PR_PROXY: '3102' }  // match QA_*_PORT
const basePorts = {}

const provisioner = createProcessProvisioner({
  stateDir: '/var/lib/qa-conductor/acme-widget',
  database: {
    command: ({ paneRef, port }) => {
      if (paneRef.role === 'base') basePorts.BASE_DB = String(port)
      return { cmd: '/usr/bin/java', args: ['-jar', 'DynamoDBLocal.jar', '-inMemory', '-port', String(port)], cwd: '/opt/dynamodb-local' }
    },
    ready: async () => {},
    handle: ({ port }) => ({ dsn: `http://127.0.0.1:${port}`, db: {} }),
  },
  command: ({ ref, port, paneRef }) => {
    const server = { cmd: path.join(ref, 'node_modules/.bin/tsx'), args: ['packages/api/src/dev.ts'] }
    if (paneRef.role === 'base') {
      basePorts.BASE_APP = String(port)
      return { ...server, cwd: ref, env: { PORT: String(port) } }
    }
    const params = Object.entries({ ...conductorPorts, ...basePorts }).flatMap(([name, value]) => ['-D', `${name}=${value}`])
    return {
      cmd: '/usr/bin/sandbox-exec',
      args: [...params, '-f', '/var/lib/qa-conductor/pr-pane.sb', server.cmd, ...server.args],
      cwd: ref,
      env: { PORT: String(port) },
    }
  },
})
```

With more than one base service, note each port and add a line per port to the profile.

**Checked:**
- On macOS 12, a process under this profile got `EPERM` for each named port, over `127.0.0.1`, `::1` and `localhost`, and connected to the others.
- It isn't checked here on macOS 14 or 15, where Apple still ships `sandbox-exec` but calls it deprecated. Check yours while a session runs: `sandbox-exec -D HARNESS=3100 -D BASE_PROXY=3101 -D PR_PROXY=3102 -D BASE_APP=<port> -D BASE_DB=<port> -f pr-pane.sb /usr/bin/curl -sS http://127.0.0.1:3100/qa/` must fail with "Operation not permitted", and the same `curl` without `sandbox-exec` must answer.

#### Tag the conductor's Tailscale node

**What it guarantees:** in tailscale mode, a request that reaches `tailscale serve` from the conductor's own node carries no `Tailscale-User-Login`, so the [identity gate](#security) refuses it.
- `tailscale serve` sets no identity headers for traffic from a tagged device.
- On a node a person owns, the same request carries the owner's login, which is usually in `QA_ALLOWED_LOGINS`. That covers code on this host using the node's tailnet name or address, or a container that reaches it.

**What it doesn't:**
- Code on this host can still reach the conductor's loopback ports directly and send any login it likes. There, as everywhere, the [capability](#security) is what turns it away.
- Reviewers' own devices are unaffected: their requests still carry their logins.

**How:**
- In the tailnet policy, give the tag an owner (`"tagOwners": { "tag:qa-conductor": ["<your login>"] }`).
- Grant the reviewers access to the tag on the harness and pane ports (`8444`, `8443` and `10000` by default). A policy that grants each person their own devices no longer covers a tagged node.
- Then tag the node, with `tailscale up --advertise-tags=tag:qa-conductor` or from the admin console.
- `QA_ALLOWED_LOGINS` stays the reviewers' logins.

**Checked:** not here: nothing in this repository runs `tailscale`. Check it from the conductor's host while it runs: `curl -sS -o /dev/null -w '%{http_code}\n' https://<machine>.<tailnet>.ts.net:8444/qa/api/state` should print `403`, and the response should carry `X-QA-Refusal: identity`. Untagged, it gets past the gate (and is then refused for want of a capability).

#### Unix-socket listeners (Linux, not yet supported)

**What it would guarantee:** with the harness and both pane proxies listening on Unix sockets behind `tailscale serve`, there would be no TCP listener for a pane to reach. A container that reaches the host's loopback, or a process pane, would find nothing there, and a socket's file mode would decide who can connect.

**Why not yet:**
- The conductor listens only on TCP (`QA_BIND_HOST` and the three ports), so it can't take this step.
- `tailscale serve` can proxy to a `unix:` target, but #32 records two catches:
  - since Tailscale v1.100, a socket target needs root or an operator who can use sudo;
  - the backend then gets `Host: localhost`.
- So supporting it means more than a socket. The conductor would need to take the harness and pane origins from its config, rather than the `Host` header, for its [same-origin](#security) and pane request checks.

**Today:** the Docker Provisioner's [internal network](#the-pr-pane-on-an-internal-network) closes the same path for container panes. The PR pane then can't reach the host's loopback at all.
