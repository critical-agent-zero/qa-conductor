p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/README.md'
s = open(p).read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("""With `internal`, the PR pane gets no route off its own network. So on Docker Desktop and Podman machine too it can reach neither the host's loopback, where the base app is published, nor the base pane, and the probe can find it `isolated`. It is off by default: it pulls a Node image and runs one more container, and what it does on each runtime can only be checked by hand (below).""",
    """With `internal`, the PR pane gets no route off its own network. So on Docker Desktop and Podman machine too it should reach neither the host's loopback, where the base app is published, nor the base pane, and the probe can find it `isolated`. It is off by default: it pulls a Node image and runs one more container.

**Where it is checked:**
- **Linux, in CI:** on every pull request, CI's `docker-integration` job runs [`test/integration/docker-internal.test.mjs`](test/integration/docker-internal.test.mjs) against Docker Engine, and against Podman through its Docker-compatible socket. It boots both panes on the topology, and checks:
  - the probe's `isolated`;
  - that the PR pane reaches neither the host, the base pane's database nor `169.254.169.254`;
  - its DNS;
  - the proxy's refusals;
  - a fallback refused under `QA_REQUIRE_ISOLATION=1`;
  - that teardown and sweep leave nothing.
- **Docker Desktop and Podman machine:** not yet checked on a real runtime. There, each session's probe still decides the verdict, and the check by hand below is tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43).""")
sub("""- **Check it by hand, once per runtime.** The tests run no real Docker. Boot a PR, then while it runs:
  1. The harness chip should say `isolated`.
  2. From the PR pane's network, the host's loopback and the base pane's database must fail:
     - `docker run --rm --network qa-session-pr curlimages/curl -sS -m 3 http://host.docker.internal:<harness port>/qa/` (on Podman, `host.containers.internal`);
     - `docker run --rm --network qa-session-pr busybox nc -zw3 <an address of qa-pg-base> 5432`;""",
    """- **Check it by hand** on a runtime CI doesn't run (Docker Desktop and Podman machine, tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43)). Boot a PR, then while it runs:
  1. The harness chip should say `isolated`.
  2. From the PR pane's network, the host's loopback and the base pane's database must fail. For a `curl` here, only a curl error passes: the `echo $?` after it must print `6` (no such name), `7` (no connect) or `28` (timed out). Any answer from the conductor, `421: unrecognised Host header` or `403: …` included, means the PR pane's network reached the host:
     - `docker run --rm --network qa-session-pr curlimages/curl -sS -m 3 http://host.docker.internal:<harness port>/qa/; echo $?` (on Podman, `host.containers.internal`);
     - by address too: `http://192.168.65.254:<harness port>/qa/` on Docker Desktop, `http://192.168.127.254:<harness port>/qa/` on Podman machine;
     - `docker run --rm --network qa-session-pr busybox nc -zw3 <an address of qa-pg-base> 5432; echo $?`, which must print `1`;""")
sub("""  3. Through the proxy, a host off the list gets `403`, and `docker logs qa-fwd-pr` says why: `docker run --rm --network qa-session-pr curlimages/curl -sS -m 5 -x http://qa-egress:3128 https://example.com`.""",
    """  3. Through the proxy, a host off the list gets `403` (`curl: (56) CONNECT tunnel failed, response 403`), and `docker logs qa-fwd-pr` says why: `docker run --rm --network qa-session-pr curlimages/curl -sS -m 5 -x http://qa-egress:3128 https://example.com`.""")
open(p, 'w').write(s)
print('ok')
