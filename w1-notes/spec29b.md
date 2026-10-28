# #29 PR 2 — the per-session isolation verdict (spec)

Branch agent/w1-issue-29b from #30's head fcec44a (stacked; draft PR "Depends on #30"). Owner: A=a (verdict + advisory), C=a (process Provisioner supported, advisory).

## Verdicts
`isolated` | `reachable` | `unknown` | `shared-host`, ranked in that order; combining takes the worst. Only `isolated` lets #8 trust the base-vs-PR comparison.

## Seam (Provisioner, optional `isolation`)
- `'shared-host'` (string): both panes run as one user on one host (process Provisioner, demo).
- function `isolation({ signal, canary: { port, path, expect } }) → { verdict, reasons }`, verdict isolated|reachable|unknown. Called once both panes' databases exist, before any migrate or launch.
- absent: `unknown` ("the Provisioner has no isolation check").
- bad return / throw: `unknown` with the reason.

## Core
- bootSession: `deps.checkIsolation({ stage })`: `start` right after entering ensuring-image (before subscribeBuild/ensureBuilt), `panes` after the cloning loop (both databases up), before `migrating`. A throw fails the boot (normal failure path, teardown).
- server: floors (only raise):
  - `platform === 'darwin'` → reachable ("on macOS, containers run in a VM that forwards the host's loopback");
  - cfg.host not loopback → reachable ("the conductor listens on <host>, which containers can reach");
  - cfg.host loopback but not IPv4 127.x → unknown (the pane apps are published on 127.0.0.1, which a probe of <host> can't speak for).
- start: known = floors + declared shared-host + missing check. Recorded at once unless a function check is pending. Strict (cfg.requireIsolation, QA_REQUIRE_ISOLATION=1) and known non-isolated → throw before ensureBuilt.
- panes: function check with a fresh canary nonce (only answered during the call) → combine with floors → record + broadcast; strict → throw unless isolated.
- canary: `GET /__qa/canary/<nonce>` on the harness port, before the identity gate, answers `qa-canary <nonce>` only while a probe runs.
- /api/state `isolation: { verdict, reasons, checkedAt } | null` (reset at boot start); SSE `{ kind: 'isolation', verdict, reasons }`; `ready` carries it.
- startConductor `platform` option (test seam, default process.platform).

## Docker Provisioner `isolation()`
1. live(signal). Runtime: `docker version` (plain) /podman/i → reachable; `docker info --format {{.OperatingSystem}}` /docker desktop/i → reachable; either command failing → unknown.
2. `docker network inspect` the PR network's gateway; `docker inspect` qa-pg-base's address.
3. `docker run --rm --name qa-probe-pr --label L --network <pr> --cap-drop ALL --entrypoint bash <pg image> -c SCRIPT probe PORT PATH EXPECT hosts… -- <basePg>:5432` — no -p, no mounts. Hosts: host.docker.internal, gateway.docker.internal, host.containers.internal, host.lima.internal, 192.168.65.254, 192.168.65.2, 192.168.127.254, 10.0.2.2, 169.254.1.2, 172.17.0.1, the PR network's gateway. Parallel, `timeout 3` each.
4. Output: `listener <host>` (canary answered) → reachable; `open <ip:port>` → reachable; no `probe done` or the run failing → unknown; else isolated.
- teardown removes `qa-probe-pr` with the PR pane.
- `--cap-drop NET_RAW` on runPg, runMigrate, runApp.

## Not probed (judgment)
tailscale serve ports: every path through them ends at a conductor listener, which #30's capability guards. Base app container by address: not up yet; its network is the database's.

## UI
Header chip (#isolationChip) from /api/state, the isolation event and ready: isolated / not isolated / isolation unknown / shared host, reasons as title.

## Docs
README: seam + contracts; Security "Isolation verdicts" with the per-provisioner table (what #8 can promise); runtime names (Docker Desktop, Podman machine forward host loopback; rootless Docker/Podman on Linux don't by default; Podman networks not isolated); QA_REQUIRE_ISOLATION row; /api/state + SSE; Docker section (probe, cap-drop); process section (shared-host). CHANGELOG under Unreleased.
