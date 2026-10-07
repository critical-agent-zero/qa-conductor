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

// As the README documents: execFile's error is the cause, and maxBuffer
// (64 MB by default) is the factory's, unless a call's own opts override it.
test('the rejection\'s cause is execFile\'s error, and maxBuffer bounds the output unless opts override it', async () => {
  const fails = await makeExecFileFn()(process.execPath, ['-e', 'process.exit(2)']).then(() => assert.fail('should reject'), e => e)
  assert.ok(fails.cause instanceof Error)
  assert.equal(fails.cause.code, 2)
  const write100 = [process.execPath, ['-e', "process.stdout.write('x'.repeat(100))"]]
  const small = makeExecFileFn({ maxBuffer: 10 })
  const over = await small(...write100).then(() => assert.fail('should reject'), e => e)
  assert.equal(over.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
  assert.equal((await small(...write100, { maxBuffer: 1000 })).stdout.length, 100)
})
