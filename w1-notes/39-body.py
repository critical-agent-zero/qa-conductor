W = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/'
s = open(W + 'pr32a-body.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, a[:90]
    s = s.replace(a, b, 1)


sub("It is based on `main` (`24d048b`), not on the #8 stack: 2 commits, 2 files, +548 −0.",
    "It is based on `main` (`24d048b`), not on the #8 stack: 3 commits, 2 files, +911 −0.\n\n**Round 2:** `39998e2` fixes the review of `a0fc244`; the answer, item by item, is in the comments.")
sub("""  - Without a port, an entry allows only 80 and 443.
  - Anything else throws: a bad port, `localhost`, `*.com`, a URL, a private address. A typo never opens more than was meant.""",
    """  - Without a port, an entry allows only 80 and 443.
  - Entries are compared as the URL parser has them, so `0x7f.1` is 127.0.0.1. An IPv6 entry goes in brackets, with no zone.
  - Anything else throws: a bad port, `localhost`, a name only this host or its network has (`*.localhost`, `*.internal`, `*.local`, …), `*.com`, a URL, a private address in any form. A typo never opens more than was meant.
  - A wildcard is as wide as written: with no public suffix list, `*.github.io` admits every site under it.""")
sub("""  - the IPv4-mapped and IPv4-compatible forms of all of these.""",
    """  - the IPv4-compatible forms of all of these. An IPv4-mapped address is judged as its IPv4 address.""")
sub("""- **C. The forwarder connects to the address it checked,** never to the name again, so a second DNS answer can't swap in a private one.""",
    """- **C. The forwarder connects to the address it checked,** never to the name again, so a second DNS answer can't swap in a private one. The guarantee is per address, not per host: inside a tunnel it doesn't inspect, SNI and Host can name any site served from a listed name's addresses. So don't list a name on a shared CDN's addresses.""")
sub("""- **E. Refusals say why and are logged:** each one answers `403` with `X-QA-Egress: refused` and a reason, and logs one line `qa-egress refused <host>:<port>: <reason>`. A host that can't be reached answers `502`.""",
    """- **E. Refusals say why and are logged:** each one answers `403` with `X-QA-Egress: refused` and a reason, and logs one line `qa-egress refused <host>:<port>: <reason>`, an IPv6 host bracketed, at most 300 characters. A host that can't be reached answers `502` with `X-QA-Egress: failed`, on both paths; after a CONNECT's `200`, a failure just ends the tunnel.
- **H. Every wait is bounded:** a connect (10 s), and a tunnel or an answer that goes idle (5 min), on either side. `close()` ends every connection. The inbound forward is half-open both ways.""")
sub("""A bad config exits 1, so the Provisioner finds no forwarder and leaves the PR pane on its ordinary network.""",
    """A bad config exits 1, so the Provisioner finds no forwarder and leaves the PR pane on its ordinary network. The whole config is checked before anything listens.""")
sub("- **`test/forwarder.test.mjs`:** 8 tests, on loopback only.", "- **`test/forwarder.test.mjs`:** 18 tests, on loopback only.")
sub("- **Tests:** 723 passed on Node 24 and on Node 22 (`npm test`). New here:", "- **Tests:** 733 passed on Node 24 and on Node 22 (`npm test`). New here:")
sub("""- **Every socket test is bounded** (10 s), and a child that doesn't exit is killed. An early mutant made a bad config listen rather than exit, and hung the run.""",
    """- **Every socket test is bounded** (10 s), cleans up with `t.after` (which runs after a timeout too), and a child that doesn't exit is killed. An early mutant made a bad config listen rather than exit, and hung the run.""")
sub("""  - no log line, a bad config that doesn't exit, and a one-label wildcard.""",
    """  - no log line, a bad config that doesn't exit, and a one-label wildcard.

  Round 2 added 25 more on its fixes and the review's survivors, all killed.""")
open(W + 'pr32a-body.md', 'w').write(s)
print('ok')
