// Waiting a while on a shared promise, from many callers at once: a try to
// enrol waits on the sweep or teardown in flight (lib/server.mjs), and
// anything on loopback may send such tries, in a loop.
//
// Each waiter is an entry in a Set kept for that promise, and the promise
// gets one reaction, put on it by the first waiter, however many wait. A
// waiter that stops waiting (its time is up, or its response closed)
// removes itself, so it leaves nothing on a promise that never settles, as
// a Promise.race per waiter would until it did.

const waiters = new WeakMap() // promise -> Set of wake functions

// Resolves (to undefined) once `promise` settles, either way, or `ms` have
// passed, or `res` emits 'close', whichever comes first. The timer holds no
// process up.
export function waitOn(promise, ms, res) {
  let wakes = waiters.get(promise)
  if (wakes === undefined) {
    const all = new Set()
    wakes = all
    waiters.set(promise, all)
    const wakeAll = () => { waiters.delete(promise); for (const wake of [...all]) wake() }
    promise.then(wakeAll, wakeAll)
  }
  const set = wakes
  return new Promise(resolve => {
    const wake = () => {
      clearTimeout(timer)
      set.delete(wake)
      res.off('close', wake)
      resolve()
    }
    const timer = setTimeout(wake, ms)
    timer.unref()
    set.add(wake)
    res.once('close', wake)
  })
}

// How many wait on `promise` now.
export function waitingOn(promise) {
  return waiters.get(promise)?.size ?? 0
}
