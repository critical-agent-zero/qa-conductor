#32 asks for two things that nothing in this repository can check: its tests run no real Docker and no `tailscale`, and its CI runs on Linux. #41 closes #32 with them tracked here instead.

**These checks need the owner's machines:**
- a Mac with Docker Desktop;
- a Mac with Podman machine;
- Macs on macOS 14 and 15.

Each check below has its exact commands and what they must print. Post the outputs here, or say which ones differ. The commands work in zsh, macOS's default shell, and in bash.

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
| 1e | `docker run --rm --network qa-session-pr --dns 192.0.2.1 busybox nslookup example.com; echo $?` (on Podman, leave out `--dns`) | no address for `example.com`, then a non-zero exit code |
| 1f | `docker run --rm --network qa-session-pr busybox nslookup example.com; echo $?` | as 1e. On Docker Desktop and Podman, an answer here would be new; say so |
| 1g | `docker run --rm --network qa-session-pr curlimages/curl -sS -m 5 -o /dev/null -w '%{http_connect}\n' -x http://qa-egress:3128 https://example.com` | `403` on stdout, and `curl: (56) CONNECT tunnel failed, response 403` on stderr. Then `docker logs qa-fwd-pr` has a line refusing `example.com:443` |
| 1h | `docker run --rm --network qa-session-pr curlimages/curl -sS -m 5 -o /dev/null -w '%{http_connect} %{http_code}\n' -x http://qa-egress:3128 https://example.org/` | `200 200` |
| 1i | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3112/api/health`, on the Mac | `200`: the PR app is still reachable through the forwarder |
| 1j | `docker inspect -f '{{.HostConfig.Dns}}' qa-app-pr` | Docker Desktop: `[192.0.2.1]`. Podman: `[]` |

If 1a isn't `isolated`, its reasons say why. Post them, with `docker version` and `docker logs qa-fwd-pr`.

## 2. `sandbox-exec` on macOS 14 and 15

From #32's step 3: "check first that `sandbox-exec` still works on macOS 14 and 15". The profile in #41's README section, "A `sandbox-exec` profile for the process Provisioner (macOS)", was checked on macOS 12 only.

**Setup.** Save the README's `pr-pane.sb` where only root can write it:

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
| 2d | `sandbox-exec "${S[@]}" "$(command -v node)" -e "$P" 3199 127.0.0.1` | `connected` (a port the profile doesn't name) |
| 2e | `node -e "$P" 3190 127.0.0.1` (no sandbox) | `connected` |
| 2f | `sandbox-exec "${S[@]}" /usr/bin/curl -sv http://127.0.0.1:3190/; echo $?` | `* Immediate connect fail for 127.0.0.1: Operation not permitted`, then `7`. A closed port would say `Connection refused` |
| 2g | `sandbox-exec -D HARNESS=3190 -f /usr/local/etc/qa-conductor/pr-pane.sb /usr/bin/true; echo $?` | `string-append: argument 2 must be: string`, then `65`: with a parameter missing, the profile doesn't load |

**Where this was run.** On macOS 12.7.6, in zsh 5.8.1, 2a to 2g print exactly that. The profile was a scratch copy, not the root-owned path.
- The first version of this issue gave `S` as a flat string, and its run used bash 3.2, which splits an unquoted `$S`.
- In zsh that form prints `sandbox-exec`'s usage for 2a–2d and 2f, so the array form replaced it.

Post `sw_vers` and your shell (`echo $0`) with the outputs. If `sandbox-exec` itself fails on 14 or 15, post its stderr.

## Done when

- 1a to 1j hold on Docker Desktop and on Podman machine;
- 2a to 2g hold on macOS 14 and on macOS 15.

Where one doesn't hold, file what it printed here. The README's "Checked" lines in #40's and #41's sections are then updated to say what was run where.
