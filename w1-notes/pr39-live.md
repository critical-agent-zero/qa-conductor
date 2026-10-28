Part of #32. This is the first of three PRs, per the design in #32 (comment 6195734695):
- **1, this PR:** `lib/forwarder.mjs`, the conductor-owned forwarder: the inbound forward to the PR app, and the egress proxy with its allowlist. It is tested in-process and not wired in yet.
- **2:** the Docker Provisioner's opt-in `internal` topology, which runs this file in a container. It also adds the probe's check through the proxy, the floors, and the README (topology, guarantees, manual checks per runtime).
- **3:** the docs-only opt-ins (Unix-socket listeners, a `sandbox-exec` recipe, tagging the node). Only PR 3 is marked as completing issue 32.

It is based on `main` (`24d048b`), not on the #8 stack: 3 commits, 2 files, +911 −0.

**Round 2:** `39998e2` fixes the review of `a0fc244`; the answer, item by item, is in the comments.

## Judgment calls (conservative defaults; say if you want another)

- **A. One allowlist, failing closed** (#8 decision E). An entry is a host name (`api.example.com`), `*.domain` (any host under it, not the domain itself) or a public IP address, each with an optional `:port`.
  - Without a port, an entry allows only 80 and 443.
  - Entries are compared as the URL parser has them, so `0x7f.1` is 127.0.0.1. An IPv6 entry goes in brackets, with no zone.
  - Anything else throws: a bad port, `localhost`, a name only this host or its network has (`*.localhost`, `*.internal`, `*.local`, …), `*.com`, a URL, a private address in any form. A typo never opens more than was meant.
  - A wildcard is as wide as written: with no public suffix list, `*.github.io` admits every site under it.
  - The default list is empty, which means no egress at all.
- **B. Private addresses are always refused, even for a listed host.** A request goes out only when every address the host resolves to is public. That rules out:
  - loopback, private ranges, link-local (`169.254.169.254`, cloud metadata), CGNAT and Tailscale (`100.64.0.0/10`);
  - unique-local, site-local and multicast addresses;
  - unspecified, documentation, benchmarking and reserved addresses;
  - NAT64, 6to4 and Teredo;
  - the IPv4-compatible forms of all of these. An IPv4-mapped address is judged as its IPv4 address.

  That covers every address a container runtime gives the host (`192.168.65.254`, `192.168.127.254`, `host.docker.internal`'s). Only global unicast IPv6 (`2000::/3`) can pass. A consumer whose app needs an internal service leaves `internal` off (PR 2).
- **C. The forwarder connects to the address it checked,** never to the name again, so a second DNS answer can't swap in a private one. The guarantee is per address, not per host: inside a tunnel it doesn't inspect, SNI and Host can name any site served from a listed name's addresses. So don't list a name on a shared CDN's addresses.
- **D. HTTPS goes through `CONNECT` and is never intercepted** (#8 decision F). Plain `http://` is forwarded without the proxy's own headers (`Proxy-Authorization`, `Proxy-Connection` and the other hop-by-hop headers). Anything but an absolute `http://` request answers `400`, so the proxy can't be used as a web server.
- **E. Refusals say why and are logged:** each one answers `403` with `X-QA-Egress: refused` and a reason, and logs one line `qa-egress refused <host>:<port>: <reason>`, an IPv6 host bracketed, at most 300 characters. A host that can't be reached answers `502` with `X-QA-Egress: failed`, on both paths; after a CONNECT's `200`, a failure just ends the tunnel.
- **H. Every wait is bounded:** a connect (10 s), and a tunnel or an answer that goes idle (5 min), on either side. `close()` ends every connection. The inbound forward is half-open both ways.
- **F. It imports nothing but Node's own modules,** so PR 2 can run the file as it is in a stock `node:22-alpine` container: `node --input-type=module -e <file>`, with its config as JSON in `PANE_FORWARDER`. A bad config exits 1, so the Provisioner finds no forwarder and leaves the PR pane on its ordinary network. The whole config is checked before anything listens.
- **G. No CHANGELOG or README entry yet:** nothing uses the file until PR 2, which documents the feature as a whole.

## What changes

- **`lib/forwarder.mjs`** (internal, not an entry point):
  - `blockedAddress(address)`: why an address must not be connected to, or `null` for a public one;
  - `parseAllowlist(entries)` and `checkTarget(rules, host, port, lookup)`;
  - `createForwarder({forward, proxy, …})`: the inbound TCP forward and the HTTP/`CONNECT` egress proxy, with `lookup` and `connect` injectable for tests;
  - when `PANE_FORWARDER` is set, it runs from that config.
- **`test/forwarder.test.mjs`:** 18 tests, on loopback only. The DNS lookup and the outgoing connection are faked, so a public address the check passes is routed to a local server, and nothing leaves the machine.

## Tests and review

- **Tests:** 733 passed on Node 24 and on Node 22 (`npm test`). New here:
  - every refused range and its edges, including IPv4-mapped forms and zone IDs;
  - the allowlist's forms and every refused entry;
  - `checkTarget` against a fake resolver, with one private answer among public ones and a host that resolves to loopback;
  - `CONNECT` through to a listed host, and refused for a host off the list, `host.docker.internal`, loopback, Docker Desktop's host address, `[::1]`, the metadata address and an unlisted port. No refused target is ever connected to;
  - plain HTTP without the proxy's headers, and refusals for origin-form and `https://` requests;
  - a second DNS answer that would turn the host private;
  - the file run as the container will run it, with a bad config exiting 1.
- **Every socket test is bounded** (10 s), cleans up with `t.after` (which runs after a timeout too), and a child that doesn't exit is killed. An early mutant made a bad config listen rather than exit, and hung the run.
- **Mutation:** 19 hand mutants, all killed. They cover:
  - the IPv4-mapped unwrapping, the zone ID and the global-unicast check;
  - the CGNAT and metadata ranges;
  - one private answer among several, and a wildcard matching its apex;
  - any port, and an unlisted literal;
  - connecting to the name, or looking it up again at connect;
  - connecting after a refusal;
  - forwarding the proxy's headers, and allowing absolute `https://`;
  - an unchecked IP entry, and no default ports;
  - no log line, a bad config that doesn't exit, and a one-label wildcard.

  Round 2 added 25 more on its fixes and the review's survivors, all killed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MkcLhvB2oguJrgFNRVqAxy

