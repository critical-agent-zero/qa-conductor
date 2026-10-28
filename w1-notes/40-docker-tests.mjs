
// #40's review: a DNS server for the PR pane's containers on an internal
// network (CVE-2024-29018), and whether the forwarder runs.
test('runPg, runMigrate, runApp and runProbe take a DNS server; containerRunning reads the container\'s state', async () => {
  const exec = recordingExec(['', '', '', '', 'true\n', ''])
  const docker = createDocker({ execFileFn: exec })
  await docker.runPg('qa-pg-pr', 'qa-session-pr', { password: 'pw', dns: '192.0.2.1' })
  await docker.runMigrate('m:1', 'qa-session-pr', '/e', { name: 'qa-migrate-pr', dns: '192.0.2.1' })
  await docker.runApp('qa-app-pr', 'a:1', 'qa-session-pr', '/e', null, { dns: '192.0.2.1' })
  await docker.runProbe('qa-probe-pr', 'qa-session-pr', 'true', [], { dns: '192.0.2.1' })
  assert.equal(await docker.containerRunning('qa-fwd-pr'), true)
  assert.equal(await docker.containerRunning('qa-fwd-pr'), false, 'docker answered nothing')
  for (const call of exec.calls.slice(0, 4)) {
    const at = call.indexOf('--dns')
    assert.ok(at !== -1 && call[at + 1] === '192.0.2.1' && call.indexOf('--network') < at, call.join(' '))
  }
  assert.deepEqual(exec.calls.slice(4), [
    ['docker', 'inspect', '--format', '{{.State.Running}}', 'qa-fwd-pr'],
    ['docker', 'inspect', '--format', '{{.State.Running}}', 'qa-fwd-pr'],
  ])
  // without one, the argv is as before
  const plain = recordingExec()
  await createDocker({ execFileFn: plain }).runApp('qa-app-pr', 'a:1', 'qa-session-pr', '/e', 3112)
  assert.equal(plain.calls[0].includes('--dns'), false)
  await assert.rejects(docker.containerRunning('qa fwd'), /unsafe container name/)
})
