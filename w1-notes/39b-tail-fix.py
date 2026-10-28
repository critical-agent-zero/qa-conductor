p = '/Users/mc/Documents/GitHub/homefree/.claude/worktrees/qa-conductor-stage05/.worktrees/qa-team/w1/repo31/test/forwarder.test.mjs'
s = open(p).read()
start = s.index('async function tailAtClose(open) {')
end = s.index('\n}\n', start) + 3
new = """async function tailAtClose(open) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const { client, serverSide, peer, pre = 0 } = await open()
  let received = pre
  let sent = 0
  // what the forwarder has handed the client's socket of the host's bytes,
  // queued ones included (bytesWritten counts those)
  const offset = serverSide().bytesWritten
  const handed = () => serverSide().bytesWritten - offset
  const send = n => { peer.write(Buffer.alloc(n, 0x62)); sent += n }
  // every byte sent so far has reached the client's socket, or `ms` passed
  const through = async (ms = 2_000) => {
    for (const end = Date.now() + ms; handed() < sent && Date.now() < end;) await sleep(2)
  }
  // fill the kernel's buffers until the forwarder has to queue
  for (let i = 0; serverSide().writableLength === 0; i++) {
    if (i > 2_000) throw new Error('the kernel buffers never filled')
    send(64 * 1024)
    await sleep(5)
  }
  // read, a little at a time, until every byte sent has been handed on and
  // nothing is queued: the kernel's buffers stay nearly full
  for (let stable = 0; stable < 3;) {
    const chunk = client.read()
    if (chunk !== null) received += chunk.length
    await sleep(10)
    stable = handed() === sent && serverSide().writableLength === 0 && peer.writableLength === 0 ? stable + 1 : 0
  }
  // then a little at a time, each step handed on before the next, until a
  // few bytes are queued: fewer than the high-water mark, so nothing holds
  // the end back
  for (let i = 0; serverSide().writableLength === 0; i++) {
    if (i > 4_000) throw new Error('nothing queued')
    send(4 * 1024)
    await through()
  }
  assert.ok(serverSide().writableLength < 16 * 1024, String(serverSide().writableLength))
  peer.end()
  await sleep(150) // the forwarder sees the end, and the close
  await new Promise((resolve, reject) => {
    client.on('data', chunk => { received += chunk.length })
    client.on('end', resolve)
    client.on('error', reject)
    client.resume()
  }).catch(() => {})
  return { sent, received }
}
"""
s = s[:start] + new + s[end:]
open(p, 'w').write(s)
print('ok')
