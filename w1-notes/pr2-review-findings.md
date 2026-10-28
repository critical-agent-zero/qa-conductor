PR 2 reviewer findings (on 442b4ba; scripts in review/pr2/exp-probe.mjs, exp-strict.mjs)

F1 HIGH: probe fails open. Missing timeout/grep/cat or no /dev/tcp -> "probe done" only -> isolated.
  Fix: positive control (self target = qa-pg-pr addr:5432, require "self" line else unknown); preflight
  `command -v timeout grep cat >/dev/null && timeout 3 true && printf '%s\n' "$expect" | grep -qF -- "$expect" || exit 3`; doc the tools.
  Tests: real script with PATH holding only bash,cat,grep -> unknown; fake docker "probe done" without self -> unknown.
F2 HIGH: strict mode runs PR code before refusing (linux+127.0.0.1, function check -> start returns early;
  ensureBuilt install runs PR install scripts; seeds before panes). README:722 + config comment wrong.
  Fix: BuildConvention declares host code (createWorktreeBuild sets build.isolation='shared-host' when install set);
  checkIsolation('start') includes it -> strict refuses before ensureBuilt; verdict never better than shared-host.
  Doc Seeds/provisionDatabase/reserveServices must not run PR code.
  Test: strict, linux, check isolated, build declaring host code -> error at ensuring-image, no ensureBuilt. Non-strict -> shared-host.
F3 HIGH narrow: floors for 127.x != 127.0.0.1 give []. Fix host !== '127.0.0.1' -> unknown. Test 127.0.0.2 -> unknown.
F4 MED: podman-docker shim: `podman info` no .OperatingSystem -> runtime() throws -> unknown w/ banner reason.
  Fix: keep Podman match from version even when info fails -> reachable. Test probeDocker({version:'Client: Podman Engine', os: Error}) -> reachable.
F5 LOW: add 192.168.5.2 and host.rancher-desktop.internal to HOST_ADDRESSES; test argv.
F6 LOW: combine([]) and unknown verdict -> unknown.
F7 LOW: probe docker run no timeout -> execFile timeout ~30s -> unknown; test with injected small timeout.
F8 LOW docs: ping works w/o NET_RAW on Docker 20.10+ (ping_group_range); breaks raw/packet tools (tcpdump, arping, traceroute -I/-T, nmap -sS). CHANGELOG:54, README:473.
F9 NIT: doTeardown doesn't reset isolation -> set null; test /api/state isolation null after teardown.
F10 NIT: podman machine wording (gvproxy NATs 192.168.127.254 host.containers.internal, not gateway .1) README:213,:288,:520;
  darwin floor reason added for process/demo which run no containers; fromCheck({verdict:'shared-host'}) -> unknown (worse turned better);
  baseDb probes only first address -> pass all.
