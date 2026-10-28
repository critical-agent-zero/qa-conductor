## Design: keeping PR code out of the base pane (#29)

Design only, no code yet. It comes from three independent designs (capability-first, network-first, minimal-change-first), compared and merged, then two accuracy checks.
- **Code claims** cite `main` at `de9ec5d`, or #28's head `135acd5` where #28 changes the Docker Provisioner.
- **Runtime claims** cite the upstream source or docs listed under **Sources** at the end.
- **✗** marks a claim I couldn't verify. **✗e2e** marks one read from source but not run end to end. Both are listed under **Unverified**.

### TL;DR

- **No single measure closes the gap.**
  - A capability protects the conductor's own three listeners on every container runtime. With the process Provisioner, it only raises the bar, since the panes run as the same user.
  - It can't protect the base app's own published port. Docker Desktop and Podman machine leave that reachable from the PR container (vpnkit and gvproxy source, plus a test on Docker Desktop 4.15; current releases ✗).
  - It can't protect the base pane's containers on Podman either, where the networks aren't isolated.
- **Recommendation (★), before #8:**
  1. **A per-browser capability on every conductor listener,** minted only while no PR code can be running. It closes the harness, its API, both pane proxies, and logins forged or obtained through the local `tailscale serve`, on every container runtime.
  2. **An isolation check for each session.** A probe from the PR pane's network tells #8 whether the base pane is out of reach. Where it isn't, #8's base-vs-PR comparison is advisory, and the base pane's changes can never excuse a PR change. A strict mode can refuse the boot instead.
  3. **The process Provisioner is declared not isolated,** so #8's comparison is advisory there.
- **After #8:** make the base pane unreachable on Docker Desktop, Podman machine and Podman, by putting the PR pane on an `--internal` network with a forwarder. That pairs with #8's egress allowlist ([the owner's decision E](https://github.com/critical-labs/qa-conductor/issues/8#issuecomment-6077655730)).

### 1. The threat

The conductor runs three HTTP servers: the harness with its API, the base pane proxy and the PR pane proxy (`lib/server.mjs:469`, `:567-587`). All three listen on `cfg.host`, which is `127.0.0.1` by default (`:51`, `:689`). Each pane's app is published on `127.0.0.1:<hostPort>` (`lib/docker.mjs:168` at `main`, `:194` at `135acd5`), and nothing in the conductor gates that port.

What server-side PR code can reach, per runtime, once #28 gives each Docker pane its own network:

| Runtime | Conductor listeners (TCP `127.0.0.1`) | Base app's published port | Base pane's containers by address | Gets a real login through `tailscale serve` on the node's own address |
|---|---|---|---|---|
| Native Docker Engine, rootful, default iptables | no [moby-bridge, moby-49325] | no [engine-ports] | no (#28) | no: a `172.x` source gets no identity [ts-serve] |
| Docker Desktop (macOS, Windows) | **yes**, via `host.docker.internal`: vpnkit forwards the host address to the host's `127.0.0.1` [vpnkit], and a test on 4.15 for macOS confirms it [agentbox]. Current releases ✗ | **yes** (inferred) | no | **yes**, the owner's login if the node is untagged [ts-serve, ts-node] ✗e2e |
| Podman machine (macOS; Windows ✗) | **yes**: gvproxy NATs `192.168.127.254` to the host's `127.0.0.1` [gvproxy] | **yes** | **yes** (below) | **yes** ✗e2e |
| Rootless Docker on Linux | **no**: `--disable-host-loopback` is the default [rootless-sh], and the pasta driver adds `--no-map-gw` [rk-pasta] | no | no | **yes** ✗e2e |
| Rootless Podman 5 on Linux | **no**: pasta gets `--no-map-gw` unless the operator opts in [podman-pasta], and slirp4netns defaults `allow_host_loopback` to false [podman-net] | no | **yes**: Podman creates networks without `isolate=true` (#28 README) | **yes** ✗e2e |
| Process Provisioner (Linux, macOS) | **yes**: same user, same host (`lib/adapters/provisioner-process.mjs:356` sets no uid) | **yes** | **yes** | **yes** ✗e2e |

**A note on the last column.** The conclusion that a request from the node itself gets the owner's login comes from tailscale's code: `nodeByAddr` includes the node itself. tailscale's own comment at `serve.go:1116` says the opposite, that local-machine traffic gets no identity. I haven't run it end to end.

**A clarification for the README.** Its Security section, and #28's Known limits, speak of "some rootless runtimes" reaching the host's loopback. They should name them. By default, rootless Docker and rootless Podman on Linux don't. Docker Desktop and Podman machine do.

What each listener gives a caller that reaches it:

| Listener | What PR code gets today |
|---|---|
| **Base pane proxy** | The base app, **signed in as the operator** through the base pane's cookie jar (`lib/proxy.mjs:146-169`). A request with no `Sec-Fetch-*` and no `Origin` passes the pane guard as a non-browser client (`lib/request-guard.mjs:27`, `:88-89`). So PR code can change the base pane's data, which is exactly what #8 compares against. |
| **Harness and its API** | `GET /api/state`, and the SSE `ready` event, return each pane's sign-in `landingUrl`, the base pane's included (`server.mjs:248-251`, `:313`, `:487`). `POST /api/session` opens or takes over a session; `/api/teardown` ends it; `/api/verdict` posts a GitHub comment and label with the conductor's token. A JSON `content-type` is all a non-browser caller needs (`:54`, `:445`; `request-guard.mjs:41`). |
| **PR pane proxy** | Its own pane, signed in. That is harmless for isolation, but it keeps the session from idling out. |
| **Identity gate (tailscale mode)** | It checks only the header (`lib/identity.mjs:32-37`), so anything on loopback can send any `Tailscale-User-Login` and try logins until one passes. Through `serve` on the node's own address, a request from this host may get the owner's real login (above). |
| **Base app's published port** | The base app with no session. It is outside every conductor gate, and it usually gets the same env as the PR pane, unless the EnvTransform splits it. So PR code holds the base app's secrets and may be able to forge a base session. |

### 2. Options

| | What it does | Closes | Doesn't close | Cost |
|---|---|---|---|---|
| **A. Per-browser capability** | Every listener requires a secret that only an enrolled browser holds. | All three listeners, forged logins and logins through the local serve, on every container runtime | The base app's port; the base pane's containers on Podman; the process Provisioner (it raises the bar only). On plain-http loopback, a PR page and PR server working together can steal a pane cookie through the browser, because cookies ignore ports (RFC 6265 §8.5). | ~400 lines of code, ~400 of tests |
| **B1. Unix-socket listeners behind serve** | No TCP port for a runtime to forward to. | Listener reach, in tailscale mode only | None mode, the demo and `npm run qa` (browsers can't use sockets); the local serve; the base app's port | Socket targets need tailscale ≥1.94 [ts-unix], and since v1.100 root or a `sudo`-capable operator [ts-root]. The reconcile loop would become check-only, and every later serve write on the node would need root. serve then sends `Host: localhost`, with the real host only in `X-Forwarded-Host` [ts-serve], which the Host allowlist and the proxy's redirect logic would have to learn. Unclear for macOS's sandboxed tailscale app ✗ |
| **B2. Another loopback address** (`127.0.0.2`) | The forwarders map only `127.0.0.1` [vpnkit, gvproxy, passt]. | Listener and app reach, where it holds | Process Provisioner. Fragile: macOS needs a root `lo0` alias that doesn't survive a reboot; current Docker Desktop is closed source ✗ | small, plus operator setup |
| **C1. Isolation probe per session** | Before any PR code runs, a short-lived container on the PR network tries each listener's port at every host address the runtimes use. It also tries the base pane's container addresses (its database now) and the node's serve ports. | Nothing by itself: it tells #8 the truth | | ~110 lines |
| **C2. Detect the runtime and refuse** | `docker info` says "Docker Desktop" or rootless; Podman names itself in `version`. | | Brittle, a lower bound only. Useful as a floor under C1. | small |
| **C3. Override `host.docker.internal`** | `--add-host` | accidents only | the raw IP ✗, `gateway.docker.internal`, the route. Docker Desktop has no ordinary setting to turn the forwarding off; only Business-tier air-gapped containers can [dd-airgap] | small, but makes the panes differ |
| **D. `--internal` PR network + forwarder** | The PR pane gets no route off its network. A forwarder container publishes its app and carries egress through an allowlist that refuses the runtimes' host addresses (`192.168.65.254`, `192.168.127.254`, host-gateway), not only loopback and metadata. | Everything a container can reach, the base app's port and Podman's addresses included ✗ (not checked on Docker Desktop or Podman machine) | Process Provisioner | large. Pairs with #8's egress allowlist (decision E) |

How the recommended pieces fit what exists:

| | Capability (A) | Probe (C1) |
|---|---|---|
| **Pane iframes, new tab** | On the first navigation into each pane, a one-time ticket sets an `HttpOnly; SameSite=Strict` pane cookie. On https it is `Secure` with the `__Host-` prefix. On plain-http loopback it is a plain `HttpOnly` cookie, because Safari refuses `Secure` cookies on `http://localhost` and Chrome refuses the prefixes there [httpwg-2605]. Later loads are same-site when the harness and panes share a host, as in the default layouts, so they carry it. On a layout with different hosts, which README allows, the pane frames are cross-site and get no cookie. So the capability requires one site, and startup refuses any other layout. | none |
| **Mirroring** | postMessage only, so no change. `bridge.js` is same-origin, so it carries the cookie. | none |
| **Cookie jars (#29's "RT-9")** | Only the names listed in `forwardClientCookies` reach the app. `qa-*` names become reserved: `forwardClientCookies` refuses them, and an app's `Set-Cookie` with that name stays in the jar. The proxy drops `Clear-Site-Data`. | none |
| **Harness API, SSE** | A header token (`X-QA-Cap`) kept in `localStorage` at the harness origin. That storage is per origin, port included, so the token never rides to another port. SSE takes it as `?cap=`, since `EventSource` can't set headers. | the verdict joins `/api/state` |
| **tailscale serve** | It is Go's `httputil.ReverseProxy`, which passes `Cookie` and `Set-Cookie` through unchanged [ts-serve]. It can't add a header of its own [ts-cli]. | a hit on the node's serve ports counts only if it carried a login |
| **Expose CLI probe** | Unchanged, as long as the identity gate still runs first: the probe passes only on `403` with `X-QA-Refusal: identity` (`lib/exposure.mjs:207-244`). | none |
| **Demo, `npm run qa`** | Plain http, host-only cookies, enrolment while idle: works. Nested self-QA over the tailnet ✗, not checked. | skipped (no Docker) |
| **homefree** (Docker Provisioner, Linux, tailscale mode) | A second layer. | expected `isolated` |
| **agent-identity** (process Provisioner, macOS) | Raises the bar only, since the panes run as the same user. | `not isolated`, by declaration |

**Minting the capability is the crux.** Anything that reaches loopback can "open the harness". So enrolment is open only while no PR code can be running:
- the session is idle, or in error after a teardown that succeeded;
- every boot started, aborted ones included, has settled, and a teardown ran after the last one settled. Or a check finds no labelled container running;
- the startup sweep succeeded. Today a failed sweep still lets boots through (`server.mjs:202-215`).

**Around enrolment:**
- **Invites:** an enrolled browser can hand out a one-time invite link, in the URL fragment, valid for 10 minutes.
- **Restarts:** tokens live in memory, so a restart revokes them all.
- **The remaining risk** is a PR process that outlives its teardown. That covers the process Provisioner, and any BuildConvention that installs PR code on the host, such as `build-worktree`, whose install scripts run as the reviewer.
- **A prerequisite:** teardown must start reporting failure. Today it swallows errors (`lib/session.mjs:247-255`, `server.mjs:355`).

**What a capability can't close:** the browser-side paths README already lists. The PR app can redirect the harness frame onto base pane URLs, and the mirror replays PR-pane input in the base pane. Both run in the reviewer's browser, which holds the capability.

**How the probe gets a hit:**
- It tries the conductor's listener ports at each host address. A canary route, answering only a per-probe nonce, confirms that the hit is this conductor. The canary also reports whether the request carried a login.
- The base app isn't up when the probe runs, before `runMigrate`. So the reach of its port is inferred from the listeners' reach on the same loopback.

### 3. The process Provisioner

Both panes run as one user on one host. The realistic choices:
1. **Declared not isolated** (★). The Provisioner reports `isolation: 'shared-host'`. #8 shows "baseline not isolated" and treats the comparison as advisory.
2. **A separate OS user per pane.** Loopback TCP stays open, and an unauthenticated store such as DynamoDB Local stays open too, so this doesn't help on its own. On Linux, an iptables `owner --uid-owner` drop works for loopback, but it needs root and a separate uid for the panes [iptables-ext].
3. **`sandbox-exec` on macOS:** deny outbound connections to the base pane's and the conductor's ports.
   - Seatbelt profiles can do it per port: Apple's own `application.sb` has `(deny network-outbound (remote ip "localhost:631"))`.
   - It is marked deprecated, and whether it still works on macOS 14 and 15 is ✗.
   - Consumers can already wrap their `command` in it, so a documented recipe is a follow-up.

**What #8 can promise:**

| | PR-side flags (what the PR did) | Base-vs-PR comparison |
|---|---|---|
| Docker, probe says isolated | unaffected by the base | trusted* |
| Docker, probe says reachable (Docker Desktop, Podman machine, Podman) | unaffected by the base | advisory: the base pane's changes never downgrade a PR flag |
| Process Provisioner | unaffected by the base | advisory, as above |
| Custom Provisioner without the check | unaffected by the base | advisory |

\*Still subject to what every runtime shares: one base env and external services, the mirror, and the harness frame's redirect. README's Security section and Known limits list these.

**Why the PR-side flags don't depend on the base pane:** after the ready baseline, only PR code and the reviewer, directly or through the mirror, touch the PR pane. That holds against a buggy PR. Against a hostile one, the trust gate stays the boundary. The base pane's changes matter only when they would excuse a PR change, so where the base can't be trusted, they don't.

### 4. Recommendation and phasing

**Before #8 ships:**
1. **The capability on all three listeners,** with the enrolment window and invites, and a single-site layout. That meets acceptance criteria 1 (the listeners) and 2 (forged logins).
2. **The probe (C1), with the runtime floors (C2):**
   - macOS and "Docker Desktop" are never `isolated`;
   - a non-loopback `QA_BIND_HOST` is `reachable`;
   - the verdict goes in `/api/state`.

   Plus #8's rule: unless the session is `isolated`, the base pane's changes never excuse a PR change. And `QA_REQUIRE_ISOLATION=1` refuses the boot instead.
3. **The process Provisioner declares `shared-host`,** and the README documents the table above. That meets acceptance criterion 3 if the owner accepts "advisory" (question C), and criterion 4.
4. **`--cap-drop NET_RAW` on the pane containers.** It costs almost nothing, though it breaks `ping`-style tools in the container. It covers crafted packets on Engine before 28 (or with its raw-table rule disabled), and with `userland-proxy: false`, where Docker sets `route_localnet` [moby-bridge] ✗.
5. **Name the runtimes in README** (the clarification above).

**After #8:**
- **The `--internal` PR network with a forwarder (D),** together with #8's egress allowlist.
- **Unix-socket listeners** as opt-in hardening on Linux.
- **A `sandbox-exec` recipe** for macOS.
- **An operator note to tag the conductor's node,** which stops serve from attaching the owner's login to local requests.

Rough size before #8: ~550 lines of code and ~750 of tests, in two or three PRs.

### 5. Acceptance criteria and test strategy

**The capability, with fakes in `server.test`:**
- **"PR code on loopback"** is a raw `node:http` client that sends:
  - a loopback `Host`, which the allowlist always admits;
  - a forged allowed login;
  - `Sec-Fetch-Site: same-origin`;
  - the harness `Origin`.

  It hits every API route, SSE, both proxies, `bridge.js` and the pane-entry route (`/__qa/enter`). Each answers `403` with `X-QA-Refusal: capability`. The fake upstream sees no request, the GitHub fake gets no comment, and the activity clock doesn't move. This runs in none and tailscale modes.
- **Enrolment is refused** while booting, while ready, while tearing down, while an aborted boot hasn't settled, after a failed sweep, and after a failed teardown. Tokens are refused after a restart.
- **The browser flow:**
  - enrolment, then the pane-entry ticket, then `303` with `Set-Cookie`, then the request is forwarded with no `qa-` name in the upstream `Cookie`;
  - a reused ticket is refused;
  - a reserved name in `forwardClientCookies`, or a layout with different hosts, makes startup throw.

**The probe, through the Docker fake's recorded argv:**
- It runs on the PR network after the PR network exists and before `runMigrate`, with `--rm`, the label, no `-p` and no mounts.
- A canary hit gives `reachable`. A hit on the base pane's database address gives `reachable`. A serve hit counts only when the canary reports a login. If the probe can't run, the verdict is `unknown`.
- The darwin and Docker Desktop floors hold even with no hit. Strict mode fails the boot before any PR code runs.

**#8:** data-diff fixtures where the base made the same delete: red when not isolated, amber when isolated.

**Manual, documented, not run here (no Docker locally):**
- On Docker Desktop and on Podman machine, from a container on `qa-session-pr`:
  - `curl -si -H 'Host: 127.0.0.1:<port>' -H 'Tailscale-User-Login: <you>' http://host.docker.internal:<port>/qa/api/state` answers `403 capability`, and so does the same against both pane ports. A container's own `Host` would get 421 from the allowlist first.
  - The harness shows "not isolated".
- On rootless Podman, the probe reports `reachable` through the base pane's database address.
- On native Linux Docker Engine, the probe reports `isolated`.

### 6. Open questions for the owner

- **A. What "closed before #8" means where the base pane stays reachable (Docker Desktop, Podman machine, Podman).**
  - a) ★ The capability plus the per-session check. The comparison is trusted only when isolated, and advisory otherwise.
  - b) As a), but refuse to boot a non-isolated session by default, with an opt-out. Note that this refuses every macOS session, and agent-identity, unless they opt out.
  - c) Hold #8 until the `--internal` network design (D) closes the base pane on those runtimes.
- **B. How a browser gets the capability.**
  - a) ★ An enrolment window, open only while no PR code can run, plus invite links from an enrolled browser.
  - b) A one-time token URL printed at startup (Jupyter-style), with no window.
  - c) Both.
- **C. The process Provisioner under #8.**
  - a) ★ Supported, with the comparison advisory. The PR-side flags are unaffected by the base.
  - b) #8's data checks are off for it.
  - c) Isolate it first (`sandbox-exec` or a separate user) before #8 supports it.

### Unverified

- **Current Docker Desktop** reaching loopback-only listeners. Its networking now runs in the closed-source `com.docker.backend`, so the evidence is vpnkit's source plus a third-party test on 4.15 for macOS. Windows and `gateway.docker.internal` are unconfirmed. That the base app's port is reachable there is inferred.
- **Podman machine on Windows.**
- **That a request from the node itself carries the owner's login through serve.** This comes from tailscale's code, against its own comment at `serve.go:1116`, and wasn't run end to end. That goes for every row of the last runtime column.
- **That `--add-host` doesn't stop a connection by IP:** it follows from how `/etc/hosts` works, but wasn't tested. Docker Desktop's subnet defaults to `192.168.65.0/24`, and can change.
- **That `host.containers.internal` under pasta reaches only the host's global address,** not `127.0.0.1`: inferred from `passt(1)`.
- **That crafted packets with the default `CAP_NET_RAW`** reach loopback-published ports on Engine before 28.
- **That `--internal` plus a forwarder blocks the host forwarder** on Docker Desktop and Podman machine.
- **That `sandbox-exec` still works** on macOS 14 and 15.
- **That macOS's sandboxed tailscale app can proxy to a Unix socket** outside its sandbox.
- **Minimum browser versions** for `Secure` cookies on `http://localhost`: only secondary sources give them. The behaviour itself is from the httpwg thread (2023).
- **Nested self-QA over the tailnet** with the capability.

### Sources

Read on 2026-10-09; local copies are kept with the design notes.
- [engine-ports] Docker docs, port publishing: a port published on `127.0.0.1` is reachable only from the Docker host. https://docs.docker.com/engine/network/port-publishing/
- [moby-49325] Engine 28.0 drops connections to loopback mappings that arrive from other interfaces. https://github.com/moby/moby/pull/49325 (also CVE-2025-54388, a firewalld-reload regression)
- [moby-bridge] `route_localnet` is set only without the userland proxy. https://github.com/moby/moby/blob/master/daemon/libnetwork/drivers/bridge/bridge_linux.go
- [vpnkit] vpnkit forwards the host address to the host's `127.0.0.1`. https://github.com/moby/vpnkit/blob/master/src/hostnet/slirp.ml
- [agentbox] A third-party test: Docker Desktop 4.15 on macOS reaching a listener bound only to `127.0.0.1`. https://github.com/madarco/agentbox/issues/403
- [dd-airgap] Docker Desktop air-gapped containers (Business tier). https://docs.docker.com/enterprise/security/hardened-desktop/air-gapped-containers/
- [gvproxy] Podman machine: `192.168.127.254` NATed to `127.0.0.1`. https://github.com/containers/gvisor-tap-vsock/blob/main/cmd/gvproxy/config.go
- [rootless-sh] Rootless Docker's default `--disable-host-loopback`. https://github.com/moby/moby/blob/master/contrib/dockerd-rootless.sh
- [rk-pasta] RootlessKit's pasta driver adds `--no-map-gw`. https://github.com/rootless-containers/rootlesskit/blob/master/pkg/network/pasta/pasta.go
- [podman-pasta] Podman's pasta arguments, `--no-map-gw` unless set. https://github.com/containers/common/blob/main/libnetwork/pasta/pasta_linux.go
- [podman-net] `allow_host_loopback` defaults to false. https://github.com/containers/common/blob/main/docs/containers.conf.5.md
- [passt] `--map-guest-addr`, `--map-host-loopback`. https://passt.top/builds/latest/web/passt.1.html
- [ts-serve] serve's reverse proxy, its forwarded and identity headers, and `Host: localhost` for Unix targets. https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go
- [ts-node] The node itself is known to `nodeByAddr`. https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/node_backend.go
- [ts-cli] serve's flags: no custom headers, and `unix:` targets. https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/serve_v2.go
- [ts-unix] Unix socket targets (first in v1.94.0). https://github.com/tailscale/tailscale/commit/f4d34f38be
- [ts-root] Unix targets need local admin (first in v1.100.0). https://github.com/tailscale/tailscale/commit/fa542426e5
- [httpwg-2605] `Secure` cookies and prefixes on `http://localhost`, by browser. https://github.com/httpwg/http-extensions/issues/2605
- [iptables-ext] `owner --uid-owner`. https://man7.org/linux/man-pages/man8/iptables-extensions.8.html
- RFC 6265 §8.5: cookies do not provide isolation by port. https://www.rfc-editor.org/rfc/rfc6265#section-8.5
