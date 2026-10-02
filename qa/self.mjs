// `npm run qa`: QA qa-conductor's own pull requests in its own harness.
//
// Each pane is a git worktree of this repo (base = main, PR = the PR head)
// running demo mode, so a UI change shows up side by side before it merges.
// The pieces are the package's own built-in adapters, imported through the
// same specifiers a consumer uses:
//   - build-worktree checks a PR out only after its trust gate passes (the
//     author has write access, and the head lives in this repo or the
//     author's own fork). There is no install step: the package has no
//     dependencies.
//   - provisioner-process runs `node demo/server.mjs` in each worktree with
//     only PATH, PORT, QA_DEMO_SPEED, QA_HARNESS_ORIGIN and
//     QA_FRAME_ANCESTORS in its environment, on 127.0.0.1.
//
//   .env.qa (or QA_ENV_FILE)  GITHUB_QA_TOKEN (required); optional QA_REPO,
//                             QA_BASE_REF (default main), QA_IDLE_MINUTES,
//                             QA_HARNESS_PORT and the other conductor keys
//   cache                     $XDG_CACHE_HOME/qa-conductor/<owner>-<name>
//                             (default ~/.cache/qa-conductor/...)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { startConductor } from '@critical-labs/qa-conductor'
import { loadConfig } from '@critical-labs/qa-conductor/config'
import { createGithub } from '@critical-labs/qa-conductor/github'
import { createWorktreeBuild } from '@critical-labs/qa-conductor/adapters/build-worktree'
import { createProcessProvisioner } from '@critical-labs/qa-conductor/adapters/provisioner-process'

export const SELF_REPO = 'critical-labs/qa-conductor'
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

// Where builds and the pidfile live: per repo, under the user's cache dir.
export function cacheDirFor(repo, env = process.env, home = os.homedir()) {
  const root = env.XDG_CACHE_HOME || path.join(home, '.cache')
  return path.join(root, 'qa-conductor', repo.replace('/', '-'))
}

// How a pane starts: demo mode straight from the checkout (the launch
// contract forbids package-manager wrappers), on the port the pane reserved.
export function selfQaCommand({ ref, port }, execPath = process.execPath) {
  return { cmd: execPath, args: ['demo/server.mjs'], cwd: ref, env: { PORT: String(port) } }
}

// `harnessOrigin` is this conductor's own harness origin. Each pane's demo
// harness is seen at the pane's public origin, framed by this harness, and
// CSP frame-ancestors checks every ancestor: the inner panes must allow both.
export function selfQaAdapters({ repo, github, cacheDir, baseRef = 'main', speed = '1', execPath = process.execPath, harnessOrigin = null }) {
  return {
    build: createWorktreeBuild({
      repo,
      cacheDir: path.join(cacheDir, 'build'),
      github,
      baseRef,
      install: null,
      servicesFor: dir => ({ app: dir }),
    }),
    provisioner: createProcessProvisioner({
      stateDir: path.join(cacheDir, 'state'),
      command: spec => selfQaCommand(spec, execPath),
      healthPath: '/',
      healthy: status => status === 200,
    }),
    seed: { databases: [], seedPane: async () => {} },
    envTransform: {
      derivePaneEnv: ({ pane }) => ({
        app: {
          PORT: String(pane.services.app.port),
          QA_DEMO_SPEED: speed,
          QA_HARNESS_ORIGIN: pane.publicOrigin,
          ...(harnessOrigin ? { QA_FRAME_ANCESTORS: harnessOrigin } : {}),
        },
      }),
    },
    auth: {
      requiresDb: false,
      establishSession: async ({ pane }) => ({ landingUrl: `${pane.publicOrigin}/` }),
    },
  }
}

export async function runSelfQa({ env = process.env, proc = process, log = console } = {}) {
  const file = env.QA_ENV_FILE || '.env.qa'
  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found: create it with GITHUB_QA_TOKEN=<a token that can read PRs and comment/label on ${SELF_REPO}>`)
  }
  const cfg = loadConfig(file, {
    defaults: {
      QA_REPO: SELF_REPO,
      QA_BASE_ORIGIN: 'http://127.0.0.1:3101',
      QA_PR_ORIGIN: 'http://127.0.0.1:3102',
    },
  })
  const github = createGithub({
    token: cfg.githubToken,
    repo: cfg.repo,
    qaLabels: [cfg.verdictLabels.accept, cfg.verdictLabels.reject],
  })
  const adapters = selfQaAdapters({
    repo: cfg.repo,
    github,
    cacheDir: cacheDirFor(cfg.repo, env),
    baseRef: cfg.env.QA_BASE_REF || 'main',
    harnessOrigin: cfg.harnessOrigin,
  })
  const conductor = startConductor({ cfg, github, fsx: { readFile: p => fs.promises.readFile(p) }, adapters, log })
  // On port 0 the origin is known once the harness listens, and logged then.
  const url = cfg.harnessOrigin ? `${cfg.harnessOrigin}/` : 'the "[qa] harness at" URL'
  log.log(`[qa] open ${url} (Ctrl-C to stop; panes are torn down on exit)`)

  let stopping = false
  const onSignal = signal => {
    if (stopping) return proc.exit(1)
    stopping = true
    log.log(`[qa] ${signal}: tearing down panes and stopping`)
    conductor.shutdown().then(
      () => proc.exit(0),
      err => { log.error(`[qa] shutdown failed: ${err.message}`); proc.exit(1) },
    )
  }
  for (const signal of SIGNALS) proc.on(signal, onSignal)
  return conductor
}

function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runSelfQa().catch(err => {
    console.error(`[qa] ${err.message}`)
    process.exit(1)
  })
}
