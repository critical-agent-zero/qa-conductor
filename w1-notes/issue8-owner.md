**Owner decisions on the design's open questions (2026-10-09)**

| | Question | Decision |
|---|---|---|
| A | Baseline points | **b) seeded and ready.** The boot delta covers migrations and sign-in; the session delta covers the reviewer's actions. |
| B | Values in the Data panel | **a) shown,** with secret-like names and `classify` masked, and `pii` as fingerprints. |
| C | Verdict data summary | **c) never.** Data checks stay in the harness; verdict comments are unchanged. |
| D | MVP scope | **a) the inbound log, marks, the inspector, both diffs, divergence and flags,** plus the demo adapter. |
| E | Egress default once wired | **b) block hosts outside a consumer allowlist,** failing closed. Loopback and metadata are always refused. |
| F | HTTPS detail | **a) host level only (`CONNECT`), never intercepted.** |
| G | Keys and volatile fields | **a) key fields named in the snapshot, plus data rules.** |
| H | The base pane is reachable from PR code | **b) close the remaining gaps before shipping #8.** |

**What changes in the design**

- **C = never.** Drop `dataSummary` and the verdict-comment controls row. Nothing from the capture reaches GitHub.
- **H.** #28 (#27) gives each Docker pane its own network and database password. #8 also waits for the remaining isolation gaps to close, so that a PR can't alter the base the diffs compare against. Those gaps are on Docker Desktop and some rootless runtimes, where a container reaches the host's loopback, and with the process Provisioner. They are tracked in a new issue (linked below).

Remaining isolation gaps: #29.

