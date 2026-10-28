import json
N = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/notes/'
s = open(N + 'body-40-live3.md').read()


def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:100], s.count(a))
    s = s.replace(a, b, 1)


sub("`git diff --name-status 561bd84..5d2df65` lists only this PR's files: 15 files.", "`git diff --name-status 561bd84..102bc63` lists only this PR's files: 15 files.")
sub("is answered item by item in comment 6342340538.", "is answered item by item in comment 6342340538. Round 4 (round 3's review, comment 6346864438) is answered item by item in comment 6347150041, in `102bc63`.")
sub("""  - It boots both panes on the topology. It checks the probe's `isolated`, that nothing leaves the PR pane but through the allowlist, DNS, a fallback refused under `QA_REQUIRE_ISOLATION=1`, and that teardown and sweep leave nothing.
  - It runs only when `QA_DOCKER_IT=1` asks, and the job fails on any skip.""",
    """  - It boots both panes on the topology. It checks the probe's `isolated`, that nothing leaves the PR pane but through the allowlist (no direct route to `1.1.1.1:443`, which the base pane reaches; metadata with a control), DNS, a fallback refused under `QA_REQUIRE_ISOLATION=1`, and that teardown leaves nothing before any sweep.
  - It runs only when `QA_DOCKER_IT=1` asks, and the job fails on any skip or todo test.
  - **Not a required check yet:** the ruleset requires only `test (22)` and `test (24)`. Making both `docker-integration` legs required is a repository setting, for the owner after this lands; it would also let runner flakiness block unrelated PRs.""")
sub("""- **Q. A host service listening on `0.0.0.0` is reachable from the PR pane** (a limit CI found). It is reached at the PR network's gateway, the host's own address on that bridge. The probe reports it as `reachable`, naming the address, and the README states the limit: keep host services the PR pane mustn't reach off `0.0.0.0`.""",
    """- **Q. A host service listening on `0.0.0.0`** (a limit CI found; closed on Docker Engine 28 and later in round 4).
  - **On Docker Engine 28 and later,** `qa-session-pr` is created with an isolated gateway (`gateway_mode_ipv4/ipv6=isolated`). Its bridge then has no address of the host's, so the service is out of reach. `docker version` decides. An Engine that refuses the option gets a plain internal network, never the ordinary fallback, and a leftover network without the option is made again.
  - **On Podman and older Engines,** the PR pane still reaches it at the PR network's own gateway, the host's address on that bridge. The probe reports it as `reachable` for the conductor's own port, naming the address, and the README states the limit: keep host services the PR pane mustn't reach off `0.0.0.0`.
  - CI pins both.""")
sub("""- **S. Teardown under the podman-docker shim is a follow-up, and fails closed.** Podman's own `rm -f`, given a name that doesn't exist, exited 0 but removed none of the containers in a scratch CI run. So the pane's `network rm` fails and `teardown` rejects; `sweep` then removes the containers by id. A fix, and a CI leg for the shim, come in a follow-up.""",
    """- **S. `rmForce` removes one name at a time** (round 4). Podman before 5.1, which the podman-docker shim drives on Ubuntu 24.04 and Debian 12, stops `rm -f a b c` at the first name already gone, removes none of the rest, and exits 0. So a batched teardown left the PR's app, database and forwarder. Each name now goes alone, and the first real failure rejects once every name has been tried. A CI leg for the shim is still a follow-up.""")
sub("""- **Tests:** 811 passed and 0 failed on Node 24 and on Node 22""", """- **Tests:** 818 passed and 0 failed on Node 24 and on Node 22""")
sub("""  - round 3: 22, 20 killed. The survivors put a naive timer on the tunnel's PR side, or the idle timer on its host side, which loopback's buffers don't tell apart (comment 6342340538).""",
    """  - round 3: 22, 20 killed. The survivors put a naive timer on the tunnel's PR side, or the idle timer on its host side, which loopback's buffers don't tell apart (comment 6342340538);
  - round 4: 9, all killed: the batched `rm`, the gateway mode's threshold, refusal and reuse, the version's Server section, the noise regex, and the PR-side timer armed before the request is piped.""")
json.dump({'body': s}, open(N + 'body-40-new4.json', 'w'))
print('ok')
