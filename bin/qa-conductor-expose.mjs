#!/usr/bin/env node
// qa-conductor-expose: ensure the conductor's tailscale serve mounts, or with
// --check only report drift. An operator and debug tool: the conductor's own
// reconcile loop owns the mounts, and no deploy runs this.
//
// It loads cfg as the conductor does (loadConfig, or the platform's own
// loader named by --config, so a .env.qa that leans on a platform's defaults
// loads too), builds the built-in tailscale adapter, and runs runExpose:
// mountsFor then reconcileExposure, the conductor loop's own pass. The pass
// and what it prints are in lib/exposure.mjs; this file parses flags, loads
// cfg and sets the exit code.

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { createTailscaleExposure } from '../lib/adapters/exposure-tailscale.mjs'
import { loadConfig } from '../lib/config.mjs'
import { makeExecFileFn } from '../lib/exec.mjs'
import { runExpose } from '../lib/exposure.mjs'

const USAGE = `Usage: qa-conductor-expose [--check] [--env FILE] [--config MODULE[#export]] [--tailscale BIN] [--socket PATH] [--help|-h]

Ensures the conductor's tailscale serve mounts (the harness under /qa at the
harness origin's port, each pane at / at its own origin's port), or with
--check only reports drift. It never removes a handler. The conductor's own
reconcile loop owns these mounts: this is for operators and debugging, and no
deploy needs to run it.

  --check                   report drift; change nothing
  --env FILE                the conductor's env file
                            (default: $QA_ENV_FILE, else ./.env.qa)
  --config MODULE[#export]  load the config by calling MODULE's export (default:
                            its default export) with the env file's path. MODULE
                            is a file path, from the working directory. Without
                            it, the core loadConfig reads the env file, which then
                            needs GITHUB_QA_TOKEN and QA_REPO like the conductor's
  --tailscale BIN           the tailscale CLI (default: QA_TAILSCALE_BIN in the env
                            file, else tailscale on PATH). On macOS, use the app's
                            /Applications/Tailscale.app/Contents/MacOS/Tailscale
                            when the one on PATH is older than the daemon
  --socket PATH             tailscaled's socket, passed as --socket=PATH
  -h, --help                print this and exit

Exit status: 0 every mount is in place (or QA_EXPOSURE=none), 1 drift remains
or tailscale failed, 2 a usage, config or mount layout error.
`

const OPTIONS = {
  check: { type: 'boolean' },
  env: { type: 'string' },
  config: { type: 'string' },
  tailscale: { type: 'string' },
  socket: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
}

// A usage or config error: what went wrong, then the usage, on stderr.
function refuse(message) {
  process.stderr.write(`qa-conductor-expose: ${message}\n\n${USAGE}`)
  return 2
}

// MODULE[#export]: the export is what follows the last #, when that is a name.
async function loadCfg(spec, envFile) {
  if (spec === undefined) return loadConfig(envFile)
  const [, file, name] = /^(.*)#([A-Za-z_$][\w$]*)$/.exec(spec) ?? [spec, spec, 'default']
  const mod = await import(pathToFileURL(path.resolve(file)).href)
  if (typeof mod[name] !== 'function') throw new Error(`--config ${spec}: ${file} has no function export named ${name}`)
  const cfg = await mod[name](envFile)
  if (cfg === null || typeof cfg !== 'object') throw new Error(`--config ${spec}: ${name}(${JSON.stringify(envFile)}) returned no config object`)
  return cfg
}

async function main(argv) {
  let opts
  try {
    opts = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }).values
  } catch (err) {
    return refuse(err.message)
  }
  if (opts.help) {
    process.stdout.write(USAGE)
    return 0
  }
  const envFile = opts.env ?? (process.env.QA_ENV_FILE || '.env.qa')
  let cfg, exposure
  try {
    cfg = await loadCfg(opts.config, envFile)
    exposure = createTailscaleExposure({
      execFileFn: makeExecFileFn(),
      bin: opts.tailscale ?? (cfg.env?.QA_TAILSCALE_BIN || 'tailscale'),
      socket: opts.socket ?? null,
    })
  } catch (err) {
    return refuse(err?.message ?? String(err))
  }
  return runExpose({ cfg, exposure, checkOnly: opts.check === true })
}

// exitCode, not exit(): stdout and stderr drain first.
main(process.argv.slice(2)).then(
  code => { process.exitCode = code },
  err => {
    process.stderr.write(`qa-conductor-expose: ${err?.stack ?? err}\n`)
    process.exitCode = 1
  },
)
