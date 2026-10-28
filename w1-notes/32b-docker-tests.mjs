
// --- #32: the PR pane on an internal network -------------------------------------

test('an internal network, an app with no host port, the forwarder and a network connect build exact argv', async () => {
  const exec = recordingExec()
  const docker = createDocker({ execFileFn: exec })
  await docker.createNetwork('qa-session-pr', { internal: true })
  await docker.runApp('qa-app-pr', 'ghcr.io/x/app:pr-7-abc', 'qa-session-pr', '/compose/.env.qa-pr', null)
  const config = { host: '0.0.0.0', forward: { listen: 3000, to: 'qa-app-pr:3000' }, proxy: { listen: 3128, allow: ['api.example.com'] } }
  await docker.runForwarder('qa-fwd-pr', 'node:22-alpine', 'qa-session-pr-edge', { hostPort: 3112, config, source: 'console.log(1)' })
  await docker.connectNetwork('qa-session-pr', 'qa-fwd-pr', { alias: 'qa-egress' })
  assert.equal(await docker.networkInternal('qa-session-pr'), false, 'docker answered nothing')
  assert.deepEqual(exec.calls, [
    ['docker', 'network', 'create', '--label', 'qa-conductor-session', '--internal', 'qa-session-pr'],
    ['docker', 'run', '-d', '--name', 'qa-app-pr', '--network', 'qa-session-pr', '--label', 'qa-conductor-session', '--cap-drop', 'NET_RAW', '--env-file', '/compose/.env.qa-pr', 'ghcr.io/x/app:pr-7-abc'],
    [
      'docker', 'run', '-d', '--name', 'qa-fwd-pr', '--network', 'qa-session-pr-edge', '--label', 'qa-conductor-session',
      '--cap-drop', 'ALL', '--read-only', '--security-opt', 'no-new-privileges', '--user', 'node',
      '-p', '127.0.0.1:3112:3000', '-e', `PANE_FORWARDER=${JSON.stringify(config)}`,
      '--entrypoint', 'node', 'node:22-alpine', '--input-type=module', '-e', 'console.log(1)',
    ],
    ['docker', 'network', 'connect', '--alias', 'qa-egress', 'qa-session-pr', 'qa-fwd-pr'],
    ['docker', 'network', 'inspect', '--format', '{{.Internal}}', 'qa-session-pr'],
  ])
  assert.equal(await createDocker({ execFileFn: recordingExec(['true\n']) }).networkInternal('qa-session-pr'), true)
  await assert.rejects(docker.runForwarder('qa fwd', 'node:22-alpine', 'x', { hostPort: 1, config, source: '' }), /unsafe container name/)
  await assert.rejects(docker.connectNetwork('x', 'qa fwd', { alias: 'a' }), /unsafe container name/)
})
