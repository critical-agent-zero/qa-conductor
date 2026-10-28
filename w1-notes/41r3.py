R = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/'


def edit(path, pairs):
    s = open(R + path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:140], s.count(a))
        s = s.replace(a, b, 1)
    open(R + path, 'w').write(s)


edit('README.md', [
    ("""**What it guarantees:** the PR pane's processes can't open a TCP connection to the ports the profile names on this Mac's loopback, over IPv4 or IPv6:
- the conductor's three (`QA_HARNESS_PORT`, `QA_BASE_PROXY_PORT`, `QA_PR_PROXY_PORT`);
- the base pane's service and database ports.""",
     """**What it guarantees:** the PR pane's processes can't open a TCP connection to the port numbers the profile names, on any address: this Mac's loopback over IPv4 and IPv6, an IPv4-mapped IPv6 address (`::ffff:127.0.0.1`), `0.0.0.0` or another of the host's addresses. They are:
- the conductor's three (`QA_HARNESS_PORT`, `QA_BASE_PROXY_PORT`, `QA_PR_PROXY_PORT`);
- the base pane's service and database ports.

**The trade-off:** those port numbers are refused on every host, remote ones too. A PR pane that must reach, say, port 3100 on another machine can't while the conductor uses it."""),
    ("""  - `tailscale serve`'s ports on the node's tailnet address front the conductor too, and the profile names only loopback ports. The [capability](#security) still turns such a request away, and on a tagged node (below) the identity gate does first.""",
     """  - `tailscale serve`'s ports on the node's tailnet address front the conductor too, on port numbers the profile doesn't name. The [capability](#security) still turns such a request away, and on a tagged node (below) the identity gate does first."""),
    ("""**The profile** denies each port it is given, so it names what to shut rather than what to open. On macOS 12, `sandbox-exec` honoured a deny that names a port. An allow for one port after `(deny network-outbound (remote ip "localhost:*"))` didn't reopen it, although after a bare `(deny network-outbound)` it did. A profile that shuts everything and opens a list would depend on which form it used.""",
     """**The profile** denies each port it is given, on any address (`*:<port>`), so it names what to shut rather than what to open.
- **Why any address:** a deny on `localhost:<port>` refused `127.0.0.1`, `::1` and `localhost`, but on macOS 12 an IPv4-mapped IPv6 address, `::ffff:127.0.0.1`, reached every port it named, through the IPv4 listener.
- **Why not shut everything and open a list:** on macOS 12, an allow for one port after `(deny network-outbound (remote ip "localhost:*"))` didn't reopen it, although after a bare `(deny network-outbound)` it did. A profile that shuts everything and opens a list would depend on which form it used."""),
    ("""; pr-pane.sb: no TCP to these loopback ports (IPv4 and IPv6)
(version 1)
(allow default)
(deny network-outbound (remote ip (string-append "localhost:" (param "HARNESS"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "BASE_PROXY"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "PR_PROXY"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "BASE_APP"))))
(deny network-outbound (remote ip (string-append "localhost:" (param "BASE_DB"))))""",
     """; pr-pane.sb: no TCP to these port numbers, on any address
(version 1)
(allow default)
(deny network-outbound (remote ip (string-append "*:" (param "HARNESS"))))
(deny network-outbound (remote ip (string-append "*:" (param "BASE_PROXY"))))
(deny network-outbound (remote ip (string-append "*:" (param "PR_PROXY"))))
(deny network-outbound (remote ip (string-append "*:" (param "BASE_APP"))))
(deny network-outbound (remote ip (string-append "*:" (param "BASE_DB"))))"""),
    ("""**Checked:**
- On macOS 12.7.6, a process under this profile got `EPERM` for each named port, over `127.0.0.1`, `::1` and `localhost`, and connected to the others.
- Apple already marks `sandbox-exec` deprecated on macOS 12, and still ships it on 14 and 15.
- On macOS 14 and 15, CI's `macos-sandbox` job runs the same check on every pull request, on GitHub's macOS 14 and macOS 15 runners: `test/docs.test.mjs` takes this profile from this section and runs it through `sandbox-exec`, and the job fails if the test was skipped. Check yours while a session runs, with the ports you use:""",
     """**Checked:**
- **On macOS 12.7.6,** by hand and by `test/docs.test.mjs`: a process under this profile got `EPERM` for each named port, over `127.0.0.1`, `::1`, `localhost`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `127.1` and `0.0.0.0`, and connected to another port over each.
- **On macOS 15,** by CI's `macos-sandbox` job on GitHub's runner, on every pull request: it runs that docs test, 30 rounds of every try, and fails if the test was skipped.
- **On macOS 14, not yet.** The same job runs there, and with the earlier `localhost:<port>` form it let one named port through, over `localhost`, in 2 of 5 runs, though `127.0.0.1` to the same port got `EPERM` in the same process. Whether the `*:<port>` form holds there is tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43).
- **The job is advisory:** it isn't a required check, until it has run reliably on both.
- Apple already marks `sandbox-exec` deprecated on macOS 12, and still ships it on 14 and 15.
- **Check yours** while a session runs, with the ports you use:"""),
    ("""**Today:** the Docker Provisioner's [internal network](#the-pr-pane-on-an-internal-network) closes the same path for container panes: it gives the PR pane no route to the host's loopback. Each session's probe checks that it doesn't reach the conductor or the base pane there. CI checks it on Linux, against Docker Engine and Podman, and its check by hand on Docker Desktop and Podman machine is tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43).""",
     """**Today:** the Docker Provisioner's [internal network](#the-pr-pane-on-an-internal-network) is meant to close the same path for container panes: it gives the PR pane no route to the host's loopback. Each session's probe checks that it doesn't reach the conductor or the base pane there. CI runs the topology on Linux, against Docker Engine and Podman, where containers don't reach the host's loopback anyway. Its check by hand on Docker Desktop and Podman machine, where they do, is tracked in [#43](https://github.com/critical-labs/qa-conductor/issues/43)."""),
])

edit('CHANGELOG.md', [
    ("""  - **a `sandbox-exec` profile for the process Provisioner on macOS**, which shuts the PR pane out of the conductor's and the base pane's loopback ports. It was checked on macOS 12, and gives a check to run on 14 and 15, which #43 tracks;""",
     """  - **a `sandbox-exec` profile for the process Provisioner on macOS**, which shuts the PR pane out of the conductor's and the base pane's port numbers, on any address (IPv4-mapped IPv6 included; the same numbers on remote hosts too). It was checked on macOS 12, and on macOS 15 by CI's advisory `macos-sandbox` job. macOS 14 is tracked in #43;"""),
])

edit('test/docs.test.mjs', [
    ("""// The README's sandbox-exec profile, run as written, on a Mac: each port it
// names is refused over IPv4, IPv6 and localhost, another port isn't, and a
// parameter left out keeps the profile from loading.""",
     """// The README's sandbox-exec profile, run as written, on a Mac: each port it
// names is refused over IPv4, IPv6, localhost, IPv4-mapped IPv6 and other
// spellings of loopback, another port isn't, and a parameter left out keeps
// the profile from loading. QA_SANDBOX_ROUNDS (3 by default; CI's job asks
// for 30) repeats every try, so one pass means something."""),
    ("""test('the README\\'s sandbox-exec profile shuts the ports it names, over IPv4, IPv6 and localhost, and no other; a parameter left out keeps it from loading', { timeout: 60_000 }, async (t) => {""",
     """test('the README\\'s sandbox-exec profile shuts the ports it names, over IPv4, IPv6, localhost and IPv4-mapped IPv6, and no other; a parameter left out keeps it from loading', { timeout: 120_000 }, async (t) => {"""),
    ("""  const tries = [...names, 'OTHER'].flatMap(name => ['127.0.0.1', '::1', 'localhost'].map(host => [`${name} over ${host}`, host, ports[name]]))
  // Each try's outcome, and for one that connected, the address it reached,
  // with what localhost resolves to: CI's macOS 14 once connected over
  // localhost to a named port, so a failure says where
  const client = `
    const net = require('net')
    const tries = JSON.parse(process.argv[1])
    const out = {}
    const via = {}
    let left = tries.length + 1
    let localhost = null
    const done = () => { if (--left === 0) console.log(JSON.stringify({ out, via, localhost })) }
    require('dns').lookup('localhost', { all: true }, (err, list) => { localhost = err ? err.code : list.map(a => a.address); done() })
    for (const [name, host, port] of tries) {
      const socket = net.connect({ host, port }, () => { out[name] = 'connected'; via[name] = socket.remoteAddress; socket.destroy(); done() })
      socket.on('error', err => { out[name] = err.code ?? String(err); done() })
    }`
  const flags = names.flatMap(name => ['-D', `${name}=${ports[name]}`])
  const got = await runSandbox([...flags, '-f', file, process.execPath, '-e', client, JSON.stringify(tries)])
  assert.equal(got.code, 0, got.stderr)
  const { out, via, localhost } = JSON.parse(got.stdout)
  assert.deepEqual(out, Object.fromEntries(tries.map(([name]) => [name, name.startsWith('OTHER') ? 'connected' : 'EPERM'])), JSON.stringify({ via, localhost }))""",
     """  const HOSTS = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1', '::ffff:7f00:1', '127.1', '0.0.0.0']
  const tries = [...names, 'OTHER'].flatMap(name => HOSTS.map(host => [`${name} over ${host}`, host, ports[name]]))
  const rounds = Number(process.env.QA_SANDBOX_ROUNDS) || 3
  // Every try, `rounds` times, one round after another. Each outcome; for
  // one that broke the rule, what it reached (address and port), the
  // addresses Node tried in turn (localhost's fallback from ::1 to
  // 127.0.0.1, say), the round and its place in it, and what localhost
  // resolves to: CI's macOS 14 once connected over localhost to a named
  // port, so a failure says how
  const client = `
    const net = require('net')
    const [tries, rounds] = JSON.parse(process.argv[1])
    const out = {}
    const odd = []
    const one = (round, seq, [name, host, port]) => new Promise(resolve => {
      const socket = net.connect({ host, port })
      const record = outcome => {
        const want = name.startsWith('OTHER') ? 'connected' : 'EPERM'
        if (out[name] === undefined || out[name] === want) out[name] = outcome
        if (outcome !== want) odd.push({ name, round, seq, port, outcome, remote: socket.remoteAddress ? socket.remoteAddress + ':' + socket.remotePort : null, tried: socket.autoSelectFamilyAttemptedAddresses ?? null })
        socket.destroy()
        resolve()
      }
      socket.on('connect', () => record('connected'))
      socket.on('error', err => record(err.code ?? String(err)))
    })
    ;(async () => {
      for (let round = 0; round < rounds; round++) await Promise.all(tries.map((t, seq) => one(round, seq, t)))
      require('dns').lookup('localhost', { all: true }, (err, list) => console.log(JSON.stringify({ out, odd: odd.slice(0, 20), oddCount: odd.length, localhost: err ? err.code : list.map(a => a.address) })))
    })()`
  const flags = names.flatMap(name => ['-D', `${name}=${ports[name]}`])
  const got = await runSandbox([...flags, '-f', file, process.execPath, '-e', client, JSON.stringify([tries, rounds])], { timeout: 90_000 })
  assert.equal(got.code, 0, got.stderr)
  const { out, odd, oddCount, localhost } = JSON.parse(got.stdout)
  assert.deepEqual(out, Object.fromEntries(tries.map(([name]) => [name, name.startsWith('OTHER') ? 'connected' : 'EPERM'])), JSON.stringify({ rounds, oddCount, odd, localhost, ports }))
  assert.equal(oddCount, 0, JSON.stringify({ rounds, odd, localhost, ports }))"""),
])

edit('.github/workflows/ci.yml', [
    ("""        env:
          QA_REQUIRE_SANDBOX: "1"
""", """        env:
          QA_REQUIRE_SANDBOX: "1"
          QA_SANDBOX_ROUNDS: "30"
"""),
])
edit('test/package.test.mjs', [
    ("""    '          QA_REQUIRE_SANDBOX: "1"',
""", """    '          QA_REQUIRE_SANDBOX: "1"',
    '          QA_SANDBOX_ROUNDS: "30"',
"""),
])
print('ok')
