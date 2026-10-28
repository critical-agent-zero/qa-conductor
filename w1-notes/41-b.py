R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'
CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'
SETUP = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:100], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""- **Keep the profile where PR code can't write it:** the PR pane runs as you, so a profile in a directory you own can be rewritten before the next boot. For example, `sudo mkdir -p /usr/local/etc/qa-conductor`, then `sudo cp pr-pane.sb /usr/local/etc/qa-conductor/`: both stay root's.""",
     """- **Keep the profile where PR code can't write it:** the PR pane runs as you, so a profile in a directory you own can be rewritten before the next boot. For example:
  - `sudo mkdir -p /usr/local/etc/qa-conductor`, then `sudo cp pr-pane.sb /usr/local/etc/qa-conductor/`;
  - then `sudo chown -R root:wheel /usr/local/etc/qa-conductor`, `sudo chmod 755 /usr/local/etc/qa-conductor` and `sudo chmod 644 /usr/local/etc/qa-conductor/pr-pane.sb`, since `mkdir -p` leaves a directory that is already there as it was;
  - `ls -ld /usr/local/etc/qa-conductor /usr/local/etc/qa-conductor/pr-pane.sb` should then show `root` for both, and no `w` but the owner's."""),
    ("""- **Every parameter the profile names must be passed.** One missing, such as `BASE_DB` with no database, makes the profile fail to load: `sandbox-exec` exits 65 (`string-append: argument 2 must be: string`), and the pane doesn't start. Drop that line from the profile instead.""",
     """- **Every parameter the profile names must be passed.** One missing, such as `BASE_DB` with no database, makes the profile fail to load: `sandbox-exec` exits 65 (`string-append: argument 2 must be: string`), and the pane doesn't start. Drop that line from the profile instead.
- **`sandbox-exec` can't nest.** A conductor that itself runs under a sandbox (an app's own, say) can't start the PR pane under this profile: `sandbox-exec` exits 71, with `sandbox_apply: Operation not permitted`."""),
    ("""- It isn't checked here on macOS 14 or 15: that is tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43), with the steps. Check yours while a session runs, with the ports you use:""",
     """- On macOS 14 and 15, CI's `macos-sandbox` job runs the same check on every pull request, on GitHub's macOS 14 and macOS 15 runners: `test/docs.test.mjs` takes this profile from this section and runs it through `sandbox-exec`, and the job fails if the test was skipped. Check yours while a session runs, with the ports you use:"""),
    ("""**Checked:** not here: nothing in this repository runs `tailscale`. Check it from the conductor's host while it runs: `curl -sS -o /dev/null -D - https://<machine>.<tailnet>.ts.net:8444/qa/api/state | grep -i '^x-qa-refusal'`. Both a tagged and an untagged node answer `403`, so read the header:
- `X-QA-Refusal: identity` when the node is tagged: the identity gate refused a request with no login;
- `X-QA-Refusal: capability` when it isn't: the owner's login got past the gate, and only the capability refused it.""",
     """**Checked:** not here: nothing in this repository runs `tailscale`. Check it from the conductor's host while it runs: `curl -sS -D - https://<machine>.<tailnet>.ts.net:8444/qa/api/state`. Every case answers `403`, so read its `X-QA-Refusal` header and its body:
- `X-QA-Refusal: identity` and `403: no Tailscale identity: …`: the node is tagged, and the identity gate refused a request with no login;
- `X-QA-Refusal: identity` and `403: <login> is not in QA_ALLOWED_LOGINS`: the node isn't tagged, and its owner isn't an allowed login. The header alone can't tell this from a tagged node;
- `X-QA-Refusal: capability` and a JSON body with `"refusal":"capability"`: the node isn't tagged, its owner's login got past the gate, and only the capability refused it."""),
    ("""**Today:** the Docker Provisioner's [internal network](#the-pr-pane-on-an-internal-network) is meant to close the same path for container panes: it gives the PR pane no route to the host's loopback. Each session's probe checks that it doesn't reach the conductor or the base pane there. Its check by hand on Docker Desktop and Podman machine is tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43).""",
     """**Today:** the Docker Provisioner's [internal network](#the-pr-pane-on-an-internal-network) closes the same path for container panes: it gives the PR pane no route to the host's loopback. Each session's probe checks that it doesn't reach the conductor or the base pane there. CI checks it on Linux, against Docker Engine and Podman, and its check by hand on Docker Desktop and Podman machine is tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43)."""),
])

JOB = """
  # The README's sandbox-exec profile on macOS 14 and 15 (#32): the docs test
  # runs it through sandbox-exec. QA_REQUIRE_SANDBOX makes the test fail
  # rather than skip where sandbox-exec can't run (none, or nested), and the
  # last step fails the job on any skip.
  macos-sandbox:
    runs-on: ${{ matrix.os }}
    timeout-minutes: 10
    strategy:
      fail-fast: false
      matrix:
        os: [macos-14, macos-15]
    steps:
      - uses: CHECKOUT
        with:
          persist-credentials: false
      - uses: SETUP
        with:
          node-version: 22
      - run: sw_vers
      - run: node --test --test-force-exit --test-reporter=spec test/docs.test.mjs | tee sbx.log
        shell: bash
        env:
          QA_REQUIRE_SANDBOX: "1"
      - run: grep -q "sandbox-exec profile shuts the ports it names" sbx.log && grep -qx 'ℹ skipped 0' sbx.log
""".replace('CHECKOUT', CHECKOUT).replace('SETUP', SETUP)
p = R + '.github/workflows/ci.yml'
s = open(p).read()
assert s.endswith("      - run: grep -qx 'ℹ skipped 0' it.log\n"), repr(s[-80:])
open(p, 'w').write(s + JOB)

p = R + 'test/package.test.mjs'
s = open(p).read()
a = """    "      - run: grep -qx 'ℹ skipped 0' it.log",
  ])"""
assert s.count(a) == 1, s.count(a)
pinned = [line for line in JOB.split('\n') if line.strip() and not line.strip().startswith('#')]
def jsq(line):
    masked = line.replace('@3d3c42e5aac5ba805825da76410c181273ba90b1', '@<sha>').replace('@820762786026740c76f36085b0efc47a31fe5020', '@<sha>')
    if "'" in masked:
        return '    "' + masked.replace('\\', '\\\\').replace('"', '\\"') + '",'
    return "    '" + masked + "',"
b = a[:-len('  ])')] + '\n'.join(jsq(line) for line in pinned) + '\n  ])'
s = s.replace(a, b)
open(p, 'w').write(s)
print('ok')
