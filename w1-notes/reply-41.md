**Round 1, item by item: all fixed in `d908a01`.** It merges #40's new head, `20f945b`, which carries #40's round 2 and `main` at `561bd84`. Against `20f945b`, this PR changes only `README.md`, `CHANGELOG.md` and `test/docs.test.mjs`: 3 files, +184 −4.

**1. "Fixes #32" left two of #32's checks untracked.** Kept "Fixes #32", and filed **#43**, "Run #32's checks by hand: the internal network on Docker Desktop and Podman machine, sandbox-exec on macOS 14/15".
- **What #43 holds:** the exact commands for each check and what each must print. It says they need the owner's machines.
  - **The internal network:** 9 checks on each of Docker Desktop and Podman machine:
    - the chip;
    - the host's loopback;
    - the base database;
    - DNS with and without `--dns`;
    - a host off the list (`403`) and one on it (`200 200`);
    - the PR app through the forwarder;
    - `HostConfig.Dns`.
  - **`sandbox-exec`:** 7 checks on each of macOS 14 and 15:
    - `EPERM` over `127.0.0.1`, `::1` and `localhost`;
    - another port connecting;
    - no sandbox connecting;
    - `curl -sv`'s "Operation not permitted";
    - exit 65 with a parameter missing.

    I ran those 7 here on macOS 12.7.6, and each printed what #43 says it must.
- **Where #43 is named:**
  - this PR's body;
  - the README's "Checked" bullets for the profile;
  - the internal network's "Check it by hand" bullet;
  - the Unix-socket section's "Today";
  - both CHANGELOG entries.

**2. Name #42.** Done.
- The Unix-socket section ends its "Why not yet" with "Tracked in #42", and the CHANGELOG bullet says so too.
- The body no longer offers to file an issue.
- The Tailscale 1.94 note is added, attributed to #32: "Issue #32 records that this takes Tailscale 1.94 or later, and two catches".

**Lows:**
- **"An allow after a broader deny doesn't reopen anything."** Narrowed to what was checked. On macOS 12, an allow for one port after `(deny network-outbound (remote ip "localhost:*"))` didn't reopen it, but after a bare `(deny network-outbound)` it did. A shut-all-then-open profile would therefore depend on which form it used. That is why this one names what to shut.
- **The macOS 14/15 check now shows `EPERM`.**
  - The main check is a `node -e` connect under the profile, which prints `err.code`. It must print `EPERM`, and `connected` without the sandbox. A closed port would print `ECONNREFUSED`.
  - The `curl -sv` form expects `Immediate connect fail for 127.0.0.1: Operation not permitted`. The README notes that `curl -sS` alone can't tell the two apart.
- **The tag check prints the header:** `curl -sS -o /dev/null -D - …/qa/api/state | grep -i '^x-qa-refusal'`. It reads `identity` when the node is tagged and `capability` when it isn't. The README says both nodes answer `403`.
- **Routes around the profile** are in "What it doesn't", under "Routes around it":
  - the BuildConvention's install step runs PR code before the pane, outside the profile;
  - `tailscale serve`'s ports on the tailnet address front the conductor, and the profile names loopback ports only. The capability still refuses such a request, and on a tagged node the identity gate refuses it first;
  - a file the PR pane writes can change what an unsandboxed process runs later, the profile included if it's writable.
- **"Can't reach the host's loopback at all"** is hedged. The internal network "is meant to close the same path… Each session's probe checks that it doesn't reach the conductor or the base pane there", and its check by hand is tracked in #43.

**Nits:**
- **A missing `-D` parameter:** the README says every parameter the profile names must be passed. One missing fails to load (`sandbox-exec` exits 65, `string-append: argument 2 must be: string`) and the pane doesn't start. So drop that line from the profile instead.
- **Deprecated on macOS 12:** "Apple already marks `sandbox-exec` deprecated on macOS 12, and still ships it on 14 and 15."
- **A root-owned path:** the example now uses `/usr/local/etc/qa-conductor/pr-pane.sb`, with `sudo mkdir -p` and `sudo cp`. The README says why: the PR pane runs as you, so it could rewrite a profile in a directory you own before the next boot.

**A regression test for the profile:** `test/docs.test.mjs` takes the scheme block from the README section and runs it through `/usr/bin/sandbox-exec` with a `node` client.
- **What it checks:**
  - each of the five named ports is refused with `EPERM` (IPv4 for four; IPv6 and `localhost` for the fifth);
  - another port connects;
  - the profile with a parameter left out exits 65.
- **Where it runs:** on macOS only. Elsewhere, CI included, it is skipped.
- **Mutation:** 3 README mutants are killed: a deny line dropped, `localhost:` narrowed to `127.0.0.1:`, and a bare `(deny network-outbound)` added.

**Tests:** 804/804 on Node 24 and on Node 22, `node --test --test-force-exit`. That is #40's 803 plus the profile test. CI is green on Node 22 and 24 at `d908a01`.
