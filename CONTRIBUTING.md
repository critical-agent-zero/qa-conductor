# Contributing to qa-conductor

Thanks for helping. This file is for working on qa-conductor itself: running its tests, QA-ing a pull request in its own harness, and cutting a release. To use the package, read the [README](README.md). To report a vulnerability, follow [SECURITY.md](SECURITY.md), and don't describe it in an issue.

## Develop

```sh
git clone https://github.com/critical-labs/qa-conductor
cd qa-conductor
npm test
```

The suite runs on `node:test` with injected effects, so it needs no Docker, network or GitHub. CI runs it on Node 22 and 24, so don't use an API newer than Node 22. The package has no runtime dependencies, and a change shouldn't add one.

`npm run demo` runs the whole harness against fixture PRs and fake adapters (see the README's [Demo](README.md#demo)), which is the quickest way to see a UI change.

## Tests

Every change comes with tests, written first: a failing test, then the change that makes it pass. A few tests guard the repository itself, and fail on purpose when a change forgets something:
- `test/docs.test.mjs` keeps the README in step with the code: every entry point and every name it exports, every env file key the published code reads, every in-page link, the imports in its examples and its sample `.env.qa` files;
- `test/package.test.mjs` pins what the npm tarball carries, the CHANGELOG's release headings and links, and the publish workflow, and runs the tarball check in [Releasing](#releasing);
- `test/hygiene.test.mjs` refuses a real tailnet, a tailnet address, a path into a home directory, or the name of the private app the conductor was first built for. Fixtures use `tail1234.ts.net`, `100.64.0.1` and `/fake-home/...`.

## Commits and pull requests

- **Small, logical commits**, each one green. A pull request holds one change.
- **Commit messages** start with a lowercase conventional type and no scope: `fix: …`, `feat: …`, `docs: …`, `test: …`, `chore: …`. The subject says what is true once the commit lands (`fix: a pane's jar holds one session's cookies`); the body says why.
- **Signed commits.** Sign every commit with an SSH or GPG key that GitHub shows as verified (`git config commit.gpgsign true`).
- **The CHANGELOG.** Add a line under `## [Unreleased]` for anything a consumer would notice. A change that can break a consumer says so, and says how to migrate.
- **Security-relevant changes** update the README's [Security](README.md#security) section in the same pull request.

## QA this repo's own pull requests

```sh
(umask 077 && touch .env.qa)   # owner-only: it holds a token; .env* is gitignored
$EDITOR .env.qa                # GITHUB_QA_TOKEN=<token>
npm run qa                     # then open http://127.0.0.1:3100/qa/
```

The token reads PRs and comments and labels on this repository; the README's [Tokens](README.md#tokens) lists the permissions. qa-conductor QAs its own PRs with its own built-in adapters (`qa/self.mjs`):
- **Panes.** Each pane is a git worktree of this repo, base (`main`) and the PR head, running demo mode (`node demo/server.mjs`). A UI change shows up side by side before it merges.
- **Builds.** `build-worktree` checks a PR out only after the trust gate passes: the author has write access, and the head lives in this repo or the author's own fork. There is no install step, because the package has no dependencies.
- **Processes.** `provisioner-process` runs each pane on `127.0.0.1` with only `PATH`, `PORT`, `QA_DEMO_SPEED`, `QA_HARNESS_ORIGIN` and `QA_FRAME_ANCESTORS` in its environment.
- **Nested harnesses.** Each pane's demo harness is seen at the outer pane's origin, inside the outer harness, and CSP `frame-ancestors` checks every ancestor. So each inner demo gets `QA_HARNESS_ORIGIN=<the pane's origin>` and `QA_FRAME_ANCESTORS=<the outer harness origin>`, and its own panes render and mirror inside the outer pane. On `QA_HARNESS_PORT=0` the outer origin is the bound port's, read when a pane boots.
- **Where things live.** Builds and the pidfile are under `$XDG_CACHE_HOME/qa-conductor/critical-labs-qa-conductor`, defaulting to `~/.cache/...`.
- **Stopping.** Ctrl-C tears the panes down before exiting, and on a tailnet then removes the `tailscale serve` mounts (below).
- **On a tailnet.** To open self-QA from your other devices, set these in `.env.qa`, for a machine whose MagicDNS name is `<machine>.<tailnet>.ts.net`:
  - `QA_PUBLIC_HOST=<machine>.<tailnet>.ts.net`;
  - `QA_BASE_ORIGIN=https://<machine>.<tailnet>.ts.net:8443` and `QA_PR_ORIGIN=https://<machine>.<tailnet>.ts.net:10000` (self-QA defaults both to loopback, so set both);
  - `QA_ALLOWED_LOGINS=<your Tailscale login>`.

  That layout is tailscale mode, so self-QA passes the conductor the built-in tailscale [Exposure](README.md#exposure-optional) adapter. The conductor mounts the harness at `https://<machine>.<tailnet>.ts.net:8444/qa/` and the panes at `:8443` and `:10000` with `tailscale serve`, and restores them every `QA_EXPOSURE_INTERVAL_MINUTES`. `QA_TAILSCALE_BIN` names the CLI (default `tailscale`; on macOS, use the app's `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, since the one on `PATH` may be older than the daemon). To see drift from a shell, run `npm run expose -- --check`: the script passes `--config qa/self.mjs#loadSelfQaConfig`, which reads `.env.qa` with self-QA's defaults, such as `QA_REPO`, that the core `loadConfig` lacks (see the README's [Expose CLI](README.md#expose-cli)). A plain `npm run expose` restores them now while self-QA runs. Once it has stopped, the run refuses and exits `2`, since no gated conductor answers on its ports, so it can't put back the mounts self-QA just removed.

  From another device, the outer harness and each pane's demo harness render, but a demo's own panes are on this machine's loopback (`http://127.0.0.1:<port>`), so they render only in a browser on this machine.

  **Self-QA removes its mounts when it stops**, unlike the conductor itself. On Ctrl-C (or SIGTERM or SIGHUP), once the panes are down, it runs `tailscale serve --https=8444 --set-path=/qa off`, `tailscale serve --https=8443 off` and `tailscale serve --https=10000 off`, skipping any handler that no longer proxies to self-QA. A second Ctrl-C, a crash or a kill leaves them in place, and so does a command that fails, which is logged with the command to run: then remove them yourself with those commands. **Until the mounts are gone, whatever listens on the loopback ports they point at (`3100`–`3102` by default), such as a later loopback self-QA, is reachable from the tailnet with no identity gate.** `tailscale serve` picks the handler by the TLS server name and passes the client's `Host` through, so a tailnet device can send a loopback `Host`, which the `Host` allowlist and the API guard admit.

  **The identity gate is no boundary against the PR here.** The PR's demo runs as you, on this host, so it can reach the conductor on loopback and send any `Tailscale-User-Login` it likes. Only the trust gate keeps untrusted PR code out (see the README's [Security](README.md#security)).

`.env.qa` accepts the usual configuration keys, plus `QA_BASE_REF`, the branch the base pane runs (default `main`), and `QA_TAILSCALE_BIN`. `QA_ENV_FILE` points at a different file.

## Releasing

1. Bump `version` in `package.json` (there is no lockfile), turn the CHANGELOG's `## [Unreleased]` heading into `## [X.Y.Z] — YYYY-MM-DD` with its compare link (`compare/v<previous>...vX.Y.Z`) at the end of the file, add a new, empty `## [Unreleased]` heading above it and point the `[Unreleased]` link at the new tag (`compare/vX.Y.Z...HEAD`), and move the git-tag example under the README's [Install](README.md#install) to its tag. `test/package.test.mjs` fails until all of them agree, and on an `[Unreleased]` link with no heading of that name.
2. Open the release's section with a few lines on what it brings. If it can break a consumer, or changes what one sees, say so there, and after its changes add a `### Migrating from <previous>` list those lines link to: one numbered item per change, with what to do about it. Build the list from what ships, not from the CHANGELOG's lines alone: `git log v<previous>..main`, and `git diff v<previous>..main -- bin lib public package.json`.
3. Check the tarball itself, since the tests import the package from the checkout. `npm pack --dry-run` lists what it holds. Then run this block from the checkout: it packs the tarball into a fresh private directory, installs it in an empty project, loads every entry point and runs the bin, and stops at the first step that fails.
   ```sh
   (
     set -e
     dest="$(mktemp -d)"
     npm pack --pack-destination "$dest"
     consumer="$(mktemp -d)"
     cd "$consumer"
     npm init -y > /dev/null
     npm install --offline "$dest"/critical-labs-qa-conductor-*.tgz
     node -e 'const { exports } = require("@critical-labs/qa-conductor/package.json")
       Promise.all(Object.keys(exports).filter(key => key !== "./package.json").map(key => import(`@critical-labs/qa-conductor${key.slice(1)}`)))
         .then(() => console.log("every entry point loads"))'
     ./node_modules/.bin/qa-conductor-expose --help
   )
   ```
   It runs the bin from `node_modules/.bin`, never through `npx`. If the tarball lacked the bin, `npx` would look the name up on the registry, where anyone can claim it, and run what it found as you, without asking when stdin isn't a terminal. A fixed path in the shared `/tmp` is no safer: another local user could put a tarball there first. `test/package.test.mjs` runs this block too.
4. Once the release pull request is merged, tag `main`'s merge commit, as every earlier tag is, with a signed, annotated tag. Run `git fetch origin` and check that `git log -1 origin/main` is that merge, then `git tag -s vX.Y.Z origin/main -m "qa-conductor X.Y.Z: <what it brings>"` and `git push origin vX.Y.Z`. Name `origin/main`: without it the tag goes on whatever is checked out, such as the release branch's own commit, and the publish workflow's on-main check refuses that (step 5).
   - **If the check refuses a tag,** delete it and tag `main`'s merge commit again. Once the release-tag ruleset is on, only an admin can delete a `v*` tag: `gh api -X DELETE repos/critical-labs/qa-conductor/git/refs/tags/vX.Y.Z`. A refused tag staged nothing, so the version can be tagged again.
5. The [publish workflow](.github/workflows/publish.yml) runs two jobs.
   - **`test`** has no secrets and no `id-token`.
     - **First, before any checkout,** it checks that the tagged commit was `main` itself: an ancestor of `main` (`git merge-base --is-ancestor`), on its first-parent line, as a release's merge commit is. A tag put on any other commit by mistake stops here, before anyone is asked to approve it. That includes the release branch's own commit from step 4, even once `main` has merged it.
     - **Rebase merges:** with rebase merging allowed on `main`, a rebased pull request's commits land on its first-parent line, so they count as `main`.
     - **Then** it refuses a tag that isn't `v` plus the `package.json` version, runs the tests on the checkout, packs the tarball with `npm pack`, and keeps it as the run's artifact.
   - **`publish`** waits for a maintainer to approve the `npm-release` environment, whose deployment policy admits `v*` tags only.
     - **Before approving,** check the run's commit against data the run can't produce. `gh run view <run-id> -R critical-labs/qa-conductor --json headSha --jq .headSha` must equal `gh pr view <release PR> -R critical-labs/qa-conductor --json mergeCommit --jq .mergeCommit.oid`, or appear in `git fetch https://github.com/critical-labs/qa-conductor.git main && git rev-list --first-parent FETCH_HEAD`. That fetches from the canonical repository, never a fork's `origin`.
     - **Until it matches, the run's own results prove nothing,** `test` and both on-main checks included: a tag on another commit runs that commit's copy of the workflow.
     - **Once approved,** it:
       - checks the commit again, as `test` did;
       - downloads the tarball and checks that its file name is the tag's version;
       - checks that the tarball's `publishConfig` is exactly `package.json`'s, since npm applies any other key in it, a scoped registry or a proxy included, to the stage. It reads the manifest with the stage's own npm (its `pacote`), so a second `package.json` elsewhere in the archive can't hand npm a different one;
       - stages it on npm with provenance (`npm stage publish`).

       It checks out nothing and runs no code from the repository.
6. A maintainer approves the staged version on npmjs.com. Only then does it go live.

**What stops a direct publish.**
- **The approval and the token's home.** The workflow's npm token can only stage, and only the stage step gets it, in the job that runs no repository code. A tag runs the workflow file of the commit it names, so someone who can push tags could tag a commit whose workflow drops the checks. What holds against that is the approver comparing the run's SHA with `main`'s (step 5), and `NPM_TOKEN` living in the `npm-release` environment alone.
- **The workflow's checks catch mistakes:**
  - a tag on the wrong commit;
  - a tag that isn't the `package.json` version;
  - a tarball that isn't the tag's, or whose `publishConfig` adds anything.
- **The pin catches a stray token or permission.** `test/package.test.mjs` pins:
  - the workflow's trigger, jobs, permissions and steps;
  - both jobs' on-main checks, the tarball check and the `publishConfig` check, word for word.

  It fails:
  - on any npm or npx command other than the four the workflow runs (npm expands abbreviations such as `npm pub`);
  - on a gate that could be skipped or allowed to fail;
  - on the token or an `id-token` anywhere but the stage step and the publish job;
  - on a publish job without the environment, the on-main check or the `publishConfig` check.
- **The scripts are run in tests too:**
  - the on-main check, against a test repository, under GitHub's `bash -e` and under pipefail;
  - the tarball and `publishConfig` checks, against good and bad tarballs.
- **Text, not a parser.** The test reads the file as text, so it catches mistakes, not every way a shell can spell a command: the stage-only token is what refuses a plain publish.
