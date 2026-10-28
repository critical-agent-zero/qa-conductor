# SPEC 29: fact sheet (from the accuracy checker, finished after the pause)

42 facts checked: 33 verified, 9 unverified or inferred.
- Code citations point to repo/ (main plus PR #28).
- Upstream sources were read on 2026-10-09, at these commits: docker/docs@18bbfeeb24, moby/moby@9fabd6dfbb, rootlesskit@10c6ba9565, tailscale@1e3097c9f2, container-libs@b4b65f5ba4, gvisor-tap-vsock@6dbb5d4fa0, vpnkit@dcfd7913e2.
- Fetched copies are in spec29/facts/.

## Four findings that change the issue's premises

- **Rootless Docker is safe by default.** It doesn't forward host loopback unless the operator opts out (B7).
- **Unix sockets behind serve need root or sudo since tailscale v1.100**, and serve then sends `Host: localhost` (B16, B17).
- **`/api/state` returns each pane's `landingUrl`.** So server-side PR code that reaches the API gets the base pane's sign-in link (A5).
- **The base app's own port is outside any conductor gate**: 127.0.0.1:3111 (A12, B2).

## A. Current code

1. [VERIFIED] **Three servers.**
   - The harness is at server.mjs:469; the base and PR pane proxies at :567-587.
   - All listen on `cfg.host` (:689), which defaults to 127.0.0.1 (:51, :74; config.mjs:186).
   - Their ports are 3100, 3101 and 3102 (config.mjs:187-191).
2. [VERIFIED] **The harness.**
   - It answers 421 to a bad Host (:470) and strips the `/qa` prefix (:476).
   - It serves `/` and `/harness.js` (:479-480).
   - GET: `/api/state`, `/api/prs`, `/api/exposure`, `/api/build-status`, `/api/verdict/preview`, and the SSE stream `/api/progress` (:510-516).
   - POST: `/api/session`, `/api/verdict`, `/api/teardown` (:517-556).
3. [VERIFIED] **The pane proxy's order:** Host 421 → `paneRefusal` 403 → `/__qa/bridge.js` → 503 if no session → forward to 127.0.0.1:<upstream> (proxy.mjs:289-365). The identity gate wraps it in tailscale mode (server.mjs:578).
4. [VERIFIED] **A request without Sec-Fetch-* or Origin counts as a non-browser client** and passes both API checks (request-guard.mjs:27, :41). The only extra condition is `Content-Type: application/json` on the three JSON POSTs (server.mjs:54, :445).
5. [VERIFIED] **`/api/state` and the SSE `ready` event return each pane's `landingUrl`** (server.mjs:248-255, :313, :487). POST `/api/verdict` posts the comment and label with the conductor's token (:549-550).
6. [VERIFIED] **The base and PR proxies serve a curl GET or POST** (request-guard.mjs:88-90) and forward it with the jar's cookies (proxy.mjs:146-158, :173), so the request is signed in as the operator.
7. [VERIFIED] **The identity gate checks only the header** (identity.mjs:32-37) and wraps all three servers (server.mjs:173, :469, :578).
   - curl with an allowed login is the same as none mode.
   - The 403 body echoes the login it was sent (identity.mjs:35), which makes it a guessing oracle.
   - The proxy strips `tailscale-*` headers before the app sees the request (proxy.mjs:169).
8. [VERIFIED] **The Host allowlist always passes loopback hosts** (proxy.mjs:39, :56-60; used again at server.mjs:470).
   - A `Host: 127.0.0.1:<port>` header passes.
   - A container's default `Host: host.docker.internal:…` gets 421, but a client can set any Host.
9. [VERIFIED] **The app gets the jar's cookies, plus `forwardClientCookies` names with valid values**; the jar wins a clash (proxy.mjs:141-158).
   - The browser's Cookie header is dropped (:167), and the app's Set-Cookie never reaches the browser (:200).
   - A capability cookie reaches the app only if its name is listed in `QA_FORWARD_CLIENT_COOKIES` (:154; config.mjs:223). No names are reserved today.
10. [VERIFIED] **The expose probe** sends GET `<target>/qa/api/state` (harness) or GET `<target>/` (panes) with no identity, and passes only on 403 with `X-QA-Refusal: identity` (exposure.mjs:212-244; identity.mjs:62-65).
    - Its targets are `http://<cfg.host>:<port>` (exposure.mjs:40, :59).
    - Any new gate placed before the identity gate breaks the probe.
11. [VERIFIED] **The process Provisioner.**
    - It finds free ports and runs health checks on 127.0.0.1 (provisioner-process.mjs:121-131, :155-156).
    - `command()` gets the port but not the host, so the actual bind is up to the consumer (:576).
    - `spawn` sets no uid or gid (:356), so panes run as the conductor's user (:17-19).
12. [VERIFIED] **Docker**: each pane's app is published with `-p 127.0.0.1:<hostPort>:3000` (docker.mjs:194; ports 3111 and 3112 at provisioner-docker.mjs:82). Postgres has no `-p` (docker.mjs:89-95).
13. [VERIFIED] **A capability can't close two browser-side paths** the README already documents: the harness-frame redirect (README:224) and the mirror (README:230).

## B. Runtimes

1. [VERIFIED] **Docker Desktop's docs** say only that `host.docker.internal` resolves to "the internal IP address of your host" and `gateway.docker.internal` to "the gateway IP of the Docker VM". The example server binds all interfaces, so the docs are silent on loopback (networking-how-tos.md:18-40).
2. [VERIFIED] **Docker Desktop reaches loopback-only listeners**: vpnkit forwards TCP for the host IP to the host's 127.0.0.1:port (vpnkit src/hostnet/slirp.ml:504, :549-557, :1318-1324).
   - A third-party test on Docker Desktop 4.15 for macOS reached a listener bound only to 127.0.0.1 (madarco/agentbox#403).
   - Inferred: the base app's port 3111 is reachable too.
3. [UNVERIFIED] **The same on current Docker Desktop**, where networking now runs in `com.docker.backend` (networking/_index.md:49). Windows and `gateway.docker.internal` are also unconfirmed (slirp.ml:1274-1306).
4. [VERIFIED] **There's no ordinary setting to turn this off.**
   - The only control is Business-tier "air-gapped containers": PAC files plus `transparentPorts`, with sign-in and Settings Management (air-gapped-containers.md:28-46, :189-191).
   - PAC blocking of host.docker.internal arrived in 4.29.0 (release-notes.md:3297).
5. [VERIFIED] **Docker Desktop host networking** was beta in 4.29.0 and GA in 4.34.0 (release-notes.md:3294, :2839).
   - It is an opt-in setting (settings.md:187) and applies to `--net=host` only.
   - It doesn't work with Enhanced Container Isolation (host.md:111-113).
6. [UNVERIFIED] **An `--add-host` override is name-only**, so it doesn't stop a connection by IP. The subnet defaults to 192.168.65.0/24 and can change (release-notes.md:1789).
7. [VERIFIED] **Rootless Docker**: `dockerd-rootless.sh` passes `--disable-host-loopback` by default.
   - Opting out takes `DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=false` (contrib/dockerd-rootless.sh:23-24, :170-173, :216).
   - RootlessKit's pasta driver then adds `--no-map-gw --tcp-ns=none --udp-ns=none` (pkg/network/pasta/pasta.go:177-179).
8. [VERIFIED] **The rootless network driver** is slirp4netns if installed, otherwise pasta, then vpnkit, then gvisor-tap-vsock (dockerd-rootless.sh:13-14, :125-145).
9. [VERIFIED] **Podman 5 slirp4netns**: `allow_host_loopback` defaults to false (v5.4.0 options/network.md:38). Podman 6 drops slirp4netns (rootlessnetns/netns_linux.go:158-159).
10. [VERIFIED] **Podman pasta (the default)** gets `--no-map-gw` unless `pasta_options` sets `--map-gw`, plus `-T none -U none` and `--map-guest-addr 169.254.1.2` (pasta_linux.go:173-186, :255-271; network.md:57-77). Bridge networks get the same (netns_linux.go:200-229).
11. [VERIFIED] **pasta**: `--map-guest-addr` maps to the host's global address, while `--map-host-loopback` arrives as 127.0.0.1 (passt.1:376-387, :407-413). Inferred: `host.containers.internal` can't reach a listener bound only to 127.0.0.1.
12. [VERIFIED] **Podman machine on macOS** (gvproxy) NATs 192.168.127.254 to 127.0.0.1, and both `host.containers.internal` and `host.docker.internal` resolve to that address (cmd/gvproxy/config.go:234-257, :395-419; podman issue #29785).
13. [VERIFIED] **Native rootful Linux**: with `-p 127.0.0.1:…`, "only the Docker host can access" the port (port-publishing.md:46-57).
    - Before 28.0.0, LAN neighbours could reach it. 28.0.0 (moby#49325) drops packets to loopback addresses that arrive on any interface but `lo`.
    - A firewalld reload removed that rule until a fix (CVE-2025-54388; 28.md:263). `DOCKER_INSECURE_NO_IPTABLES_RAW=1` disables it (:646).
14. [VERIFIED] **`route_localnet`** is set on the bridge only when the userland proxy is off (bridge_linux.go:905). A host service bound only to 127.0.0.1 and not published is unreachable from bridge containers.
15. [UNVERIFIED] On Engine before 28, a container with the default `CAP_NET_RAW` could craft packets to loopback-published ports.
16. [VERIFIED] **`tailscale serve unix:/path`**:
    - Linux, macOS and BSD only (serve_v2.go:143, :155-156).
    - First shipped in v1.94.0 (commit f4d34f38be); TCP forwarding to a Unix target in v1.102.0.
    - Since v1.100.0 (fa542426e5) it needs root, or an operator who can run `sudo tailscale`. The sandboxed macOS app is exempt.
17. [VERIFIED] **For a Unix target, serve sends `Host: localhost`** (ipn/ipnlocal/serve.go:894, :991-994) and the real host only in `X-Forwarded-Host` (:1089). That would make the Host allowlist and `isHarnessHost` pass as loopback. It would break the proxy's Referrer-Policy and redirect logic, which key on the request's Host (proxy.mjs:185-194, :228).
18. [VERIFIED] **Serve has no custom-header option** (serve_v2.go:241-253). It sets only:
    - `X-Forwarded-Host`, `-Proto` and `-For`;
    - `Tailscale-User-Login`, `-Name`, `-Profile-Pic` and `-Headers-Info` (none for tagged or local sources);
    - `Tailscale-Funnel-Request`;
    - `Tailscale-App-Capabilities` with `--accept-app-caps` (serve.go:1088-1175).
19. [VERIFIED] **Serve passes cookies through unchanged both ways**: it is Go's `httputil.ReverseProxy` (serve.go:976), which strips only hop-by-hop headers (reverseproxy.go:382-393).
20. [VERIFIED] **macOS `sandbox-exec`** is marked deprecated in its man page (macOS 12.7.6).
    - A Seatbelt profile can deny one loopback port.
    - Apple's own application.sb has `(deny network-outbound (remote ip "localhost:631"))`.
21. [UNVERIFIED] That `sandbox-exec` still works on macOS 14 and 15.
22. [VERIFIED] **iptables `owner --uid-owner`** matches only locally generated packets, in OUTPUT and POSTROUTING (man7 iptables-extensions). Loopback traffic passes OUTPUT, so a drop by uid works, but it needs root and a separate uid.
23. [VERIFIED] **Cookies ignore ports** (RFC 6265 §8.5), and ts.net is on the Public Suffix List, so hosts in one tailnet are same-site. One HttpOnly cookie on a hostname reaches all three listeners, and PR pane scripts can't read it.
24. [VERIFIED] **`__Host-`** requires Secure, no Domain and Path=/ (rfc6265bis, httpwg#2605; MDN set-cookie:170, :223).
25. [VERIFIED as of 2023] **On http://localhost**:
    - Chrome accepts Secure cookies but rejects `__Host-` and `__Secure-`;
    - Firefox accepts all three;
    - Safari rejects Secure cookies, and so both prefixes (httpwg/http-extensions#2605).

    So the loopback layout needs a plain HttpOnly cookie.
26. [UNVERIFIED] The Chrome 89 and Firefox 75 version numbers come from secondary sources only.

## Notes for the draft (to apply on resume)

- **The capability's check order**: it must not run before the identity gate, or the expose probe breaks (A10). Design A already puts the gate first.
- **The threat table**: add `landingUrl` from `/api/state` and the SSE `ready` event (A5), and the 403's echoed login as a guessing oracle (A7).
- **Cookie names**: pane cookies on http loopback can't use `__Host-` or Secure in Safari or Chrome (B25), so use a plain HttpOnly cookie there. Design A already does.
- **Unverified list**:
  - B3: current Docker Desktop, Windows, and `gateway.docker.internal`;
  - B6: the `--add-host` IP bypass;
  - B11: inferred;
  - B15: CAP_NET_RAW;
  - B21: `sandbox-exec` on macOS 14 and 15;
  - B26: browser version numbers;
  - design B's ✗e2e marks: serve from the node itself, and the 127.0.0.2 behaviour on current Docker Desktop.
