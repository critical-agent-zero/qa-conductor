# SPEC 29: notes (paused 2026-10-09, about 18:20 BST)

Order: a design comment on #29, posted as the bot, by about 19:30. No code, no branch, no PR.

Sources read: #29, and the owner's #8 decisions (comment 6077655730: H = b, close the gaps before #8. E = b, an egress allowlist that fails closed).

## State

| Step | State |
|---|---|
| Design A (capability-first) | done; notes in spec29/design-a/notes.md |
| Design B (network-first) | done, with sources; fetched files in spec29/design-b/ |
| Design C (minimal-change-first) | done; summary below |
| Fact-checker (code + runtime claims) | was STILL RUNNING at the pause (TaskStop wasn't allowed); it may write spec29/facts/. Read its result on resume. |
| Judging and synthesis | first draft: spec29-draft.md (= spec29/SPEC-29.md) |
| Accuracy pass on the draft | NOT DONE: the draft still has FACTS_PLACEHOLDER and SOURCES_PLACEHOLDER |
| Posted | NO |

## Design A (capability-first): key points

- **Per-browser records.** Each record holds three tokens: harness, base and PR. They live in memory only, so a restart revokes them. Each lasts 12 h (sliding); at most 32 are kept, oldest dropped first; lookup is by sha256.
- **The harness token is a header (`X-QA-Cap`)** kept in `localStorage` at the harness origin. SSE takes it as `?cap=`. Because the browser never attaches it on its own, it doesn't ride to other ports, which a cookie would.
- **The pane tokens are cookies**:
  - name `__Host-qa-<id>-<role>` on https, `qa-<id>-<role>` on http, where `<id>` is 8 hex characters of sha256(harnessOrigin);
  - attributes `HttpOnly; SameSite=Strict`, plus `Secure` on https.

  They're set by a one-time 60-second ticket, through `POST /api/pane-entry`, then `<pane>/__qa/enter?t=…&to=…`, then `303`.
- **Minting window:** `POST /api/enrol` only while:
  - the session is idle, or in error after a teardown that succeeded;
  - the sweep is done;
  - no boot or teardown is in flight.

  Otherwise it answers 409. `teardownSession` must start reporting failure (session.mjs ~L209 swallows errors today).
- **Invites:** `POST /api/invite` returns `#enrol=<ticket>` (10 minutes, in the fragment).
- **Check order on the harness:** identity gate → 421 → `refused()` → token → routes. A failure is 403 with `X-QA-Refusal: capability`.
- **Check order on the panes:** gate → 421 → `paneRefusal` → enter ticket or cookie → bridge → `onActivity` → forward.
- **Interactions:**
  - mirror unchanged;
  - `qa-*` cookie names reserved (`forwardClientCookies` refuses them);
  - the proxy drops `Clear-Site-Data`;
  - the expose probe is unchanged, since the identity gate answers first.
- **What it closes:** server-side PR code on all listeners, and the forged login (acceptance criterion 2).
- **On https / tailscale:** it also holds against a PR page and PR server working together (`Secure` cookies).
- **The gap on plain-http loopback:** cookies ignore ports, so a PR page can make the browser send the pane cookie to a PR-owned port.
- **Not covered:** the base app's published port (127.0.0.1:3111, provisioner-docker.mjs L194).
- **Process Provisioner:** declare `isolation: 'shared-host'`; #8 shows a banner.
- **Size:** about 400 lines of code (new lib/capability.mjs, about 150), about 400 lines of tests, about 50 lines of README.

## Design B (network-first): key points and sources

| Runtime | Conductor listeners (TCP 127.0.0.1) | Base app's port | `tailscale serve` on the node's own address |
|---|---|---|---|
| Native rootful Docker Engine | not reachable (M1) | not reachable | a 172.x source gets no identity |
| Docker Desktop | reachable via `host.docker.internal` (vpnkit Localhost, V; current Desktop is closed source, ✗ end-to-end) | reachable | reachable, with the owner's login if the node is untagged (T3) |
| Podman machine | reachable: gvproxy maps 192.168.127.254 to 127.0.0.1 (G) | reachable | |
| Rootless Docker (Linux) | not reachable: `--disable-host-loopback` is the default (R1); pasta `--no-map-gw` (R2) | not reachable | |
| Rootless Podman 5 (Linux) | not reachable: `--no-map-gw` (P1); `allow_host_loopback=false` (P2); `host.containers.internal` is the host's global address (P3) | not reachable | |
| Process Provisioner | reachable | reachable | reachable |

**The README overstates the rootless case** ("some rootless runtimes"): rootless runtimes on Linux don't forward the host's loopback by default.

**`serve` from the node itself:** tailscaled's local listener plus WhoIs on the node itself (T3) means a request from this host gets the owner's login unless the node is tagged.

Mechanisms:
- **N1, Unix sockets behind serve:** needs tailscale 1.94 or later (T1). From 1.98.10 and 1.102.1, a serve config with a Unix target needs root (T4). tailscaled sends `Host: localhost` and the real host in `X-Forwarded-Host` (T2). It doesn't work with macOS's sandboxed tailscaled ✗.
- **N2, refuse a request from the node itself:** when `X-Forwarded-For` is one of the node's own Tailscale IPs, answer 403 `self`. Or tag the node.
- **N3, 127.0.0.2:** opt-in. On macOS it needs a root `lo0` alias, lost on reboot.
- **N4, a probe container per boot on the PR network:** it tries `host.docker.internal`, `gateway.docker.internal`, `host.containers.internal`, 192.168.65.254, 10.0.2.2, 169.254.1.2, 192.168.127.254, the network gateway and the node's 100.x serve ports. It hits each listener and the base app's port, at `/.well-known/qa-canary/<nonce>`. A hit refuses the boot unless `QA_ALLOW_HOST_REACH=1`, which turns #8's data checks off.
- **N5, `--cap-drop NET_RAW`:** covers `userland-proxy: false`, where `route_localnet=1` (M2).

Sources:
- T1 https://github.com/tailscale/tailscale/commit/f4d34f38be
- T2 https://github.com/tailscale/tailscale/blob/v1.104.1/ipn/ipnlocal/serve.go
- T3 the same file, L107–135; node_backend.go L727
- T4 https://github.com/tailscale/tailscale/commit/fa542426e5
- V https://github.com/moby/vpnkit/blob/master/src/hostnet/slirp.ml
- G https://github.com/containers/gvisor-tap-vsock/blob/main/cmd/gvproxy/config.go L254
- R1 https://github.com/moby/moby/blob/master/contrib/dockerd-rootless.sh L23, L170
- R2 https://github.com/rootless-containers/rootlesskit/blob/master/pkg/network/pasta/pasta.go L177
- P1 https://github.com/containers/common/blob/main/libnetwork/pasta/pasta_linux.go L261–277
- P2 https://github.com/containers/common/blob/main/docs/containers.conf.5.md
- P3 https://passt.top/builds/latest/web/passt.1.html
- M1 https://github.com/moby/moby/blob/master/integration/network/bridge/iptablesdoc/generated/usernet-portmap-lo.md
- M2 https://github.com/moby/moby/blob/master/daemon/libnetwork/drivers/bridge/bridge_linux.go L905
- D1 https://docs.docker.com/enterprise/security/hardened-desktop/settings-management/settings-reference/
- D2 https://docs.docker.com/enterprise/security/hardened-desktop/air-gapped-containers/

## Design C (minimal-change-first): key points

- **The base app's host port** (127.0.0.1:3111) is reachable on Docker Desktop. A capability can't protect it; only a network block can (an `--internal` PR network with a forwarder).
- **Trust is asymmetric.** PR-side flags stay trusted. Base changes only ever excuse PR changes, so where the base isn't isolated they must never downgrade a flag.
- **M1, an isolation verdict per session:** a Provisioner `isolation()` returns `isolated`, `reachable` or `unknown`.
  - The Docker probe runs on the PR network with the pg image and `bash /dev/tcp` or `nc`.
  - Floors: darwin is never isolated; Docker Desktop in `docker info` is never isolated; a non-loopback `QA_BIND_HOST` is reachable.
  - The process Provisioner is reachable; a custom one is unknown. The verdict goes in `/api/state`.
- **M2, #8's rule:** unless isolated, the base never downgrades a flag; the comparison gets a banner; an "unexplained base change" raises an amber hint.
- **M3, trust `Tailscale-User-Login` only from a loopback peer socket not owned by the conductor's uid**: `/proc/net/tcp` on Linux, `lsof` on macOS. Note: this doesn't cover serve-from-self, where tailscaled itself makes the connection (Design B), so the draft drops M3 in favour of the capability.
- **M4:** `QA_REQUIRE_ISOLATION=1` refuses the boot.
- **M6:** Fetch Metadata on the pane proxies; recommended dropping it.
- **Rejected:**
  - the `--add-host` override, which is name-only;
  - inbound-log attribution, since headers are forgeable;
  - a capability without an out-of-band start.
- **Size:** about 250 lines of code, about 350 lines of tests.

## Synthesis (the draft's recommendation)

**Before #8:**
1. The capability (A), with the enrolment window and invites.
2. The probe and verdict (C M1, with B's N4 canary and address list), C's floors, #8's rule M2, and the opt-in strict mode.
3. The process Provisioner declares `shared-host`, and #8's comparison is advisory there.
4. `--cap-drop NET_RAW`.

**After #8:**
- the `--internal` PR network with a forwarder, paired with #8's egress allowlist (decision E);
- opt-in Unix sockets on Linux;
- a `sandbox-exec` recipe;
- an operator note to tag the node.

Owner questions:
- **A. Where the base app's port stays reachable:**
  - a) ★ capability + verdict, comparison advisory;
  - b) refuse by default;
  - c) hold #8 until D.
- **B. Capability bootstrap:**
  - a) ★ enrolment window + invites;
  - b) a Jupyter-style startup token;
  - c) both.
- **C. The process Provisioner:**
  - a) ★ supported, comparison advisory;
  - b) data checks off;
  - c) isolate first.

## Remaining on resume

1. Read the fact-checker's output, or rerun it on the draft. Verify every code claim (file:line) and every runtime claim. Fill in FACTS_PLACEHOLDER and SOURCES_PLACEHOLDER.
2. One adversarial read of the draft for accuracy and scannability. Check whether `/api/state` exposes pane landing URLs, and the `content-type` check on POSTs.
3. Post on #29 as the bot (GH_TOKEN from the agent-identity token file). Report the comment URL, the recommendation, the owner questions and what's unverified.
