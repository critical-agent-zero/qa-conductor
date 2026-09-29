// Promisified execFile with the { stdout } resolution shape the docker module
// depends on (createDocker destructures { stdout } from every call). Kept as
// its own module so the shape is unit-tested rather than assumed by wiring.
//
// A failure rejects with an Error whose message is "<cmd> <first arg>:
// <execFile message>\n<stderr, first 2000 chars>" and which also carries the
// full `stdout`, `stderr` and exit `code`, so a caller can build its own log
// tail (an installer's output usually lands on stdout).
import { execFile } from 'node:child_process'

export function makeExecFileFn({ maxBuffer = 64 * 1024 * 1024 } = {}) {
  return (cmd, args, opts) => new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer, ...opts }, (err, stdout, stderr) => {
      if (err) reject(execError(cmd, args, err, stdout, stderr))
      else resolve({ stdout: String(stdout) })
    })
  })
}

function execError(cmd, args, err, stdout, stderr) {
  const out = new Error(`${cmd} ${args?.[0] ?? ''}: ${err.message}\n${String(stderr).slice(0, 2000)}`, { cause: err })
  return Object.assign(out, { stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: err.code })
}
