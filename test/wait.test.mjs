// Waiting a while on a shared promise (lib/wait.mjs): what a try to enrol
// does with the sweep or teardown in flight. Anything on loopback may send
// such tries, many at once, so waiting must leave nothing behind.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { waitOn, waitingOn } from '../lib/wait.mjs'

// A promise that counts the reactions put on it.
class Counted extends Promise {
  then(...args) {
    Counted.thens = (Counted.thens ?? 0) + 1
    return super.then(...args)
  }
}

// The waiters' timers hold no process up, by design: in the conductor its
// servers do. Here, a test that waits on a timer holds it up itself.
function holdUp(t) {
  const alive = setInterval(() => {}, 1_000)
  t.after(() => clearInterval(alive))
}

function deferred(Kind = Promise) {
  let resolve, reject
  const promise = new Kind((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('a settled promise, or a rejected one, wakes every waiter', async t => {
  holdUp(t)
  const ok = deferred()
  const res = new EventEmitter()
  const waits = [waitOn(ok.promise, 60_000, res), waitOn(ok.promise, 60_000, res)]
  assert.equal(waitingOn(ok.promise), 2)
  ok.resolve('ignored')
  assert.deepEqual(await Promise.all(waits), [undefined, undefined])
  assert.equal(waitingOn(ok.promise), 0)
  assert.equal(res.listenerCount('close'), 0)

  const bad = deferred()
  const wait = waitOn(bad.promise, 60_000, new EventEmitter())
  bad.reject(new Error('the sweep failed'))
  assert.equal(await wait, undefined)

  // one that comes once it has settled doesn't wait at all
  const began = Date.now()
  await waitOn(ok.promise, 5_000, new EventEmitter())
  await waitOn(bad.promise, 5_000, new EventEmitter())
  assert.ok(Date.now() - began < 1_000, `${Date.now() - began} ms`)
})

// Promise.race would put a reaction on the shared promise per waiter, kept
// until it settles: with a hung docker CLI, tries in a loop grow memory.
test('the shared promise gets one reaction however many wait, and a waiter whose time is up leaves nothing', async t => {
  holdUp(t)
  Counted.thens = 0
  const hung = deferred(Counted)
  const before = Counted.thens
  const waits = []
  for (let i = 0; i < 50; i++) waits.push(waitOn(hung.promise, 5, new EventEmitter()))
  await Promise.all(waits)
  assert.equal(Counted.thens - before, 1)
  assert.equal(waitingOn(hung.promise), 0, 'every waiter gone at its time')
  // and once more after they left: still the one
  await waitOn(hung.promise, 5, new EventEmitter())
  assert.equal(Counted.thens - before, 1)
})

test('a waiter whose response closes stops waiting at once, and leaves nothing', async t => {
  holdUp(t)
  const hung = deferred()
  const res = new EventEmitter()
  const began = Date.now()
  const wait = waitOn(hung.promise, 60_000, res)
  assert.equal(res.listenerCount('close'), 1)
  res.emit('close')
  await wait
  assert.ok(Date.now() - began < 1_000)
  assert.equal(waitingOn(hung.promise), 0)
  assert.equal(res.listenerCount('close'), 0)
})

test('waiting holds no process up', async () => {
  const timers = () => process.getActiveResourcesInfo().filter(r => r === 'Timeout').length
  const hung = deferred()
  const before = timers()
  const res = new EventEmitter()
  const wait = waitOn(hung.promise, 60_000, res)
  assert.equal(timers(), before)
  res.emit('close')
  await wait
})
