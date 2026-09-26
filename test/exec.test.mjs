import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeExecFileFn } from '../lib/exec.mjs'

test('resolves the { stdout } shape createDocker destructures', async () => {
  const execFileFn = makeExecFileFn()
  const out = await execFileFn('node', ['-e', "process.stdout.write('hello')"])
  assert.deepEqual(out, { stdout: 'hello' })
  // the exact consumption pattern used by docker.mjs run()
  const { stdout } = out
  assert.equal(stdout.split('\n')[0], 'hello')
})

test('rejects with command, message and stderr on failure', async () => {
  const execFileFn = makeExecFileFn()
  await assert.rejects(
    () => execFileFn('node', ['-e', "process.stderr.write('boom'); process.exit(3)"]),
    err => err.message.includes('node') && err.message.includes('boom'),
  )
})

test('the rejection also carries stdout, stderr and the exit code; the message is unchanged', async () => {
  const execFileFn = makeExecFileFn()
  const err = await execFileFn(process.execPath, ['-e', "process.stdout.write('out-line'); process.stderr.write('err-line'); process.exit(3)"])
    .then(() => assert.fail('should reject'), e => e)
  assert.equal(err.stdout, 'out-line')
  assert.equal(err.stderr, 'err-line')
  assert.equal(err.code, 3)
  // same shape as before: "<cmd> <first arg>: <execFile message>\n<stderr>"
  assert.match(err.message, /^.+ -e: Command failed: [\s\S]*\nerr-line$/)
})
