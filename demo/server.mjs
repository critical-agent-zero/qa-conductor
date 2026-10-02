// `npm run demo`: start demo mode on 127.0.0.1 and stop it cleanly on
// SIGINT, SIGTERM or SIGHUP (a second signal exits at once).
//
//   PORT                harness port (default 4100; 0 picks a free one)
//   QA_DEMO_SPEED       multiplier for the fake build and boot delays
//                       (default 1; 0 = instant, 2 = twice as slow)
//   QA_HARNESS_ORIGIN   the origin viewers open the harness at (default
//                       http://127.0.0.1:<port>)
//   QA_FRAME_ANCESTORS  comma-separated origins that may also frame the panes
//                       (self-QA sets both for its inner demos)
//
// The environment, process and startDemo are injected so the signal handling
// is testable; run directly, this file starts the demo.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { webOrigin } from '../lib/net.mjs'
import { startDemo } from './index.mjs'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

export function parseDemoEnv(env) {
  const set = key => env[key] !== undefined && env[key] !== ''
  const port = set('PORT') ? Number(env.PORT) : 4100
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be an integer 0-65535, got '${env.PORT}'`)
  const speed = set('QA_DEMO_SPEED') ? Number(env.QA_DEMO_SPEED) : 1
  if (!Number.isFinite(speed) || speed < 0) throw new Error(`QA_DEMO_SPEED must be a number >= 0, got '${env.QA_DEMO_SPEED}'`)
  const harnessOrigin = set('QA_HARNESS_ORIGIN') ? webOrigin(env.QA_HARNESS_ORIGIN, 'QA_HARNESS_ORIGIN') : null
  const frameAncestors = String(env.QA_FRAME_ANCESTORS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    .map(v => webOrigin(v, 'QA_FRAME_ANCESTORS'))
  return { port, speed, harnessOrigin, frameAncestors }
}

export async function runDemoCli({ env = process.env, proc = process, start = startDemo, log = console } = {}) {
  const opts = parseDemoEnv(env)
  const demo = await start({ ...opts, log })
  log.log(`[demo] open ${opts.harnessOrigin ?? `http://127.0.0.1:${demo.ports.harness}`}/ in a browser (Ctrl-C to stop)`)
  let stopping = false
  const onSignal = signal => {
    if (stopping) return proc.exit(1)
    stopping = true
    log.log(`[demo] ${signal}: stopping`)
    demo.stop().then(
      () => proc.exit(0),
      err => { log.error(`[demo] stop failed: ${err.message}`); proc.exit(1) },
    )
  }
  for (const signal of SIGNALS) proc.on(signal, onSignal)
  return demo
}

function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runDemoCli().catch(err => {
    console.error(`[demo] ${err.message}`)
    process.exit(1)
  })
}
