// The isolation verdict's pure parts (lib/isolation.mjs): the runtime
// floors, a Provisioner's declaration or check, and how they combine.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { VERDICTS, combine, declared, floors, fromCheck } from '../lib/isolation.mjs'

test('the verdicts, best to worst', () => {
  assert.deepEqual(VERDICTS, ['isolated', 'unknown', 'reachable', 'shared-host'])
})

test('floors: macOS, a bind off loopback, and a bind a probe of the IPv4 loopback can\'t speak for', () => {
  assert.deepEqual(floors({ host: '127.0.0.1', platform: 'linux' }), [])
  assert.deepEqual(floors({ host: '127.0.0.2', platform: 'linux' }), [])
  assert.deepEqual(floors({ host: undefined, platform: 'linux' }), [], 'the default bind is 127.0.0.1')
  assert.deepEqual(floors({ host: '127.0.0.1', platform: 'darwin' }), [{
    verdict: 'reachable',
    reason: 'on macOS, containers run in a VM that forwards the host\'s loopback (Docker Desktop, Podman machine), where the base app is published',
  }])
  for (const host of ['0.0.0.0', '192.168.1.5', '::']) {
    assert.deepEqual(floors({ host, platform: 'linux' }), [{ verdict: 'reachable', reason: `the conductor listens on ${host}, which containers can reach` }], host)
  }
  for (const host of ['::1', 'localhost']) {
    assert.deepEqual(floors({ host, platform: 'linux' }), [{
      verdict: 'unknown',
      reason: `the conductor listens on ${host}, not on 127.0.0.1 where the pane apps are published, so a probe of it can't speak for their ports`,
    }], host)
  }
  assert.equal(floors({ host: '0.0.0.0', platform: 'darwin' }).length, 2)
})

test('a Provisioner\'s declaration: shared-host, none (unknown), or a check still to run (null)', () => {
  assert.deepEqual(declared({ isolation: 'shared-host' }), { verdict: 'shared-host', reasons: ['both panes run as one user on this host'] })
  assert.deepEqual(declared({}), { verdict: 'unknown', reasons: ['the Provisioner has no isolation check'] })
  assert.deepEqual(declared({ isolation: 'isolated' }), { verdict: 'unknown', reasons: ['the Provisioner declares isolation "isolated", which only a check can show'] })
  assert.equal(declared({ isolation: async () => ({}) }), null)
})

test('a check\'s result: a known verdict with string reasons, else unknown', () => {
  assert.deepEqual(fromCheck({ verdict: 'isolated', reasons: [] }), { verdict: 'isolated', reasons: [] })
  assert.deepEqual(fromCheck({ verdict: 'reachable', reasons: ['a', 2, 'b'] }), { verdict: 'reachable', reasons: ['a', 'b'] })
  assert.deepEqual(fromCheck({ verdict: 'isolated' }), { verdict: 'isolated', reasons: [] })
  // a check can't declare shared-host: that is the Provisioner's own word
  for (const bad of [null, undefined, 'isolated', {}, { verdict: 'shared-host' }, { verdict: 'bogus' }]) {
    assert.deepEqual(fromCheck(bad), { verdict: 'unknown', reasons: ['the isolation check gave no verdict'] }, JSON.stringify(bad))
  }
  // an isolated verdict's reasons are dropped: none counts against it
  assert.deepEqual(fromCheck({ verdict: 'isolated', reasons: ['x'] }), { verdict: 'isolated', reasons: [] })
  assert.deepEqual(fromCheck({ verdict: 'unknown' }), { verdict: 'unknown', reasons: ['the isolation check gave no reason'] })
  assert.deepEqual(fromCheck({ verdict: 'reachable', reasons: [] }), { verdict: 'reachable', reasons: ['the isolation check gave no reason'] })
  assert.deepEqual(fromCheck(null), { verdict: 'unknown', reasons: ['the isolation check gave no verdict'] })
})

test('combining: the worst verdict, and every reason that isn\'t isolated\'s', () => {
  assert.deepEqual(combine([{ verdict: 'isolated', reasons: [] }]), { verdict: 'isolated', reasons: [] })
  assert.deepEqual(combine([{ verdict: 'isolated', reasons: [] }, { verdict: 'reachable', reason: 'floor' }]), { verdict: 'reachable', reasons: ['floor'] })
  assert.deepEqual(
    combine([{ verdict: 'unknown', reasons: ['probe'] }, { verdict: 'reachable', reason: 'floor' }, { verdict: 'unknown', reason: 'other' }]),
    { verdict: 'reachable', reasons: ['probe', 'floor', 'other'] },
  )
  assert.deepEqual(combine([{ verdict: 'shared-host', reasons: ['host'] }, { verdict: 'reachable', reason: 'floor' }]), { verdict: 'shared-host', reasons: ['host', 'floor'] })
  assert.deepEqual(combine([]), { verdict: 'isolated', reasons: [] })
})
