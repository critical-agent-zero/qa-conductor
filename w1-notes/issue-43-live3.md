Run #32's remaining checks: the internal network on Docker Desktop and Podman machine, and sandbox-exec on macOS 14
----
#32 asks for checks that its unit tests can't make. CI now makes some of them:
- **`sandbox-exec` on macOS 15** (#32's step 3): CI's `macos-sandbox` job (#41) runs the README's profile through `sandbox-exec` on GitHub's macOS 15 runner, 30 rounds of every try, on every pull request. The job is advisory, not a required check, until it runs reliably.
- **The internal network on Linux:** CI's `docker-integration` job (#40) runs it against Docker Engine, and against Podman through its Docker-compatible socket.

**What is left:**
- **The internal network on Docker Desktop and on Podman machine** (#32's first acceptance criterion). GitHub's runners have neither, so it needs the owner's machines: a Mac with Docker Desktop, and a Mac with Podman machine. Section 1.
- **`sandbox-exec` on macOS 14** (#32's step 3). The same CI job runs there, but with the profile's earlier `localhost:<port>` form its macOS 14 runner let a named port (`BASE_APP`) through, over `localhost`, in 2 of 5 runs, while `127.0.0.1` to the same port got `EPERM` in the same process. The cause is unproven: a quirk of GitHub's runner, or a Seatbelt miss. The profile now denies `*:<port>` (#41, round 3), which also shuts IPv4-mapped IPv6 (`::ffff:127.0.0.1`), which got past the old form on macOS 12. Section 2.

Each section has its exact commands and what they must print. Post the outputs here, or say which ones differ. The commands work in zsh, macOS's default shell, and in bash.

## 1. The PR pane on an internal network: Docker Desktop and Podman machine

From #32's acceptance criteria: with the Docker Provisioner's `internal` option (#40), the probe reports `isolated` on Docker Desktop and on Podman machine. #40's tests use a fake `docker` only. Its README section, "The PR pane on an internal network", has these steps as its check by hand.

**Setup.** Run the conductor with the Docker Provisioner and `internal: { egress: ['example.org'] }`. The other options keep their defaults:
- networks `qa-session-base` and `qa-session-pr`;
- host ports `3111` and `3112`;
- harness port `3100`.

Boot any PR, and run these while it is up. On Podman, read `host.containers.internal` for `host.docker.internal`.

**How to read a curl check.** In 1b and 1c, only a curl error is a pass, and the `echo $?` after it must print one of these:
- `6`: the name didn't resolve;
- `7`: the connect failed;
- `28`: it timed out.

ANY answer from the conductor means the PR pane's network reached the host, and is a fail. That includes `421: unrecognised Host header` and `403: …`.

| # | Command | Must print or do |
|---|---|---|
| 1a | The harness chip | `isolated` |
| 1b | `docker run --rm --network qa-session-pr curlimages/curl -sS -m 3 http://host.docker.internal:3100/qa/; echo $?` | a curl error, then `6`, `7` or `28`. No answer from the conductor |
| 1c | By address: `docker run --rm --network qa-session-pr curlimages/curl -sS -m 3 http://192.168.65.254:3100/qa/; echo $?` on Docker Desktop, or `http://192.168.127.254:3100/qa/` on Podman machine | as 1b |
| 1d | `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' qa-pg-base`, then `docker run --rm --network qa-session-pr busybox nc -zw3 <that address> 5432; echo $?` | `1` |
| 1e | `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com; echo $?`, as the PR pane's containers resolve it (on Docker and on Podman) | no address for `example.com`, then a non-zero exit code |
| 1f | `docker run --rm --network qa-session-pr busybox nslookup example.com; echo $?`, as a container without `--dns` resolves it | either is fine, but say which. An answer means the runtime's DNS forwards the internal network's outside names, as CI found Podman 4.9's does on Linux; the PR pane's own containers are covered by their `--dns` (1e, 1j) |
| 1g | `docker run --rm --network qa-session-pr curlimages/curl -sS -m 5 -o /dev/null -w '%{http_connect}\n' -x http://qa-egress:3128 https://example.com` | `403` on stdout, and `curl: (56) CONNECT tunnel failed, response 403` on stderr. Then `docker logs qa-fwd-pr` has a line refusing `example.com:443` |
| 1h | `docker run --rm --network qa-session-pr curlimages/curl -sS -m 5 -o /dev/null -w '%{http_connect} %{http_code}\n' -x http://qa-egress:3128 https://example.org/` | `200 200` |
| 1i | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3112/api/health`, on the Mac | `200`: the PR app is still reachable through the forwarder |
| 1j | `docker inspect -f '{{.HostConfig.Dns}}' qa-app-pr` | `[192.0.2.1]`, on both |

If 1a isn't `isolated`, its reasons say why. Post them, with `docker version` and `docker logs qa-fwd-pr`.

## 2. `sandbox-exec` on macOS 14

From #32's step 3: "check first that `sandbox-exec` still works on macOS 14 and 15". The profile in #41's README section, "A `sandbox-exec` profile for the process Provisioner (macOS)", is checked on macOS 12 by hand and by its docs test, and on macOS 15 by CI. On macOS 14, CI's runner hasn't held reliably (above).

**Setup.** Save the README's `pr-pane.sb` (the `*:<port>` form, from #41's round 3) where only root can write it:

```sh
sudo mkdir -p /usr/local/etc/qa-conductor
sudo cp pr-pane.sb /usr/local/etc/qa-conductor/pr-pane.sb
```

Then start throwaway listeners, in a second terminal, and leave them running:
- on 3190, a port the profile names here as `HARNESS`;
- on 3199, one it doesn't name.

Neither is a conductor port, so a conductor on its defaults can keep running.

```sh
node -e "for (const [port, host] of [[3190, '127.0.0.1'], [3190, '::1'], [3199, '127.0.0.1']]) require('net').createServer(s => { s.on('error', () => {}); s.end('hi') }).listen(port, host)"
```

**The probe, saved in a shell variable:**

```sh
P="require('net').connect(+process.argv[1], process.argv[2]).on('connect', function () { console.log('connected'); this.destroy() }).on('error', e => console.log(e.code))"
```

**The sandbox's parameters, as an array.** zsh doesn't split an unquoted `$S` into words, so a flat string would hand `sandbox-exec` one argument and get its usage message:

```sh
S=(-D HARNESS=3190 -D BASE_PROXY=3101 -D PR_PROXY=3102 -D BASE_APP=3103 -D BASE_DB=3104 -f /usr/local/etc/qa-conductor/pr-pane.sb)
```

| # | Command | Must print |
|---|---|---|
| 2a | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3190 127.0.0.1` | `EPERM` |
| 2b | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3190 ::1` | `EPERM` |
| 2c | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3190 localhost` | `EPERM` |
| 2c2 | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3190 ::ffff:127.0.0.1` | `EPERM`: an IPv4-mapped IPv6 address, which got past the old `localhost:<port>` form |
| 2d | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3199 127.0.0.1` | `connected` (a port the profile doesn't name) |
| 2e | `node -e "$P" 3190 127.0.0.1` (no sandbox) | `connected` |
| 2f | `sandbox-exec "${S[@]}" /usr/bin/curl -sv http://127.0.0.1:3190/; echo $?` | `* Immediate connect fail for 127.0.0.1: Operation not permitted`, then `7`. A closed port would say `Connection refused` |
| 2g | `sandbox-exec -D HARNESS=3190 -f /usr/local/etc/qa-conductor/pr-pane.sb /usr/bin/true; echo $?` | `string-append: argument 2 must be: string`, then `65`: with a parameter missing, the profile doesn't load |

**Where this was run.** On macOS 12.7.6, in zsh 5.8.1, 2a to 2g print exactly that, and 2c2 with the `*:<port>` form. The profile was a scratch copy, not the root-owned path. Run 2a to 2d a few times: on CI's macOS 14 runner, the miss came in some runs and not others.
- The first version of this issue gave `S` as a flat string, and its run used bash 3.2, which splits an unquoted `$S`.
- In zsh that form prints `sandbox-exec`'s usage for 2a–2d and 2f, so the array form replaced it.

Post `sw_vers` and your shell (`echo $0`) with the outputs. If `sandbox-exec` itself fails on 14 or 15, post its stderr.

## Done when

- 1a to 1j hold on Docker Desktop and on Podman machine;
- on macOS 14, either 2a to 2g (with 2c2) hold by hand, run a few times, or CI's `macos-sandbox` job passes on `macos-14` in 10 runs in a row, 30 rounds each, with the `*:<port>` form.

Where one doesn't hold, file what it printed here. The README's "Where it is checked" lines in #40's section, and "Checked" in #41's, are then updated to say what was run where.



