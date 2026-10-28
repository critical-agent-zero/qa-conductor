**Independent delta review (orchestrator) of `fcec44a..8252ede`: APPROVE**

Two reviewers checked this round, one for security and one for the fixes and tests. **Every earlier item is fixed. Nothing of high or medium severity remains, and judgment call A is upheld.**

**What was checked:**
- **Podman (the earlier HIGH):** both of Podman's wordings are accepted now. The noise filter drops only the `Command failed` line, the shim banner and warn/info/debug lines. Error lines are kept, a stderr that is only noise still rejects, and any line the filter doesn't know fails closed. Docker Engine's wording still passes, and "in use", "busy", "active endpoints" and daemon errors still reject.
- **Picker after a restart (the earlier MEDIUM):** checked in headless Chromium against the demo. After a restart and ↻, 5 rows show with no error text, and the token has changed.
- **Pane-token rotation:** live in Chromium, session 1's pane cookie gets 200 before teardown and 403 `capability` after it. Pane tokens can't call `/api/pane-entry`, so a lifted one can't fetch the next session's. Rotating again at ready also covers tokens handed out during boot.
- **Judgment call A (no `Referrer-Policy`):** the landing hop after `/__qa/enter` arrives as `same-site` with `Referer: <harness origin>/`, never the `/__qa/enter?t=` URL, and `document.referrer` is the harness origin. `paneRefusal` needs that Referer, so `no-referrer` would break pane entry. The earlier repro was an artifact of the Node client.
- **The enrol wait:** after the up-to-3 s wait, `enrolmentShut()` is checked again and `enrol()` follows synchronously. A boot that starts during the wait shuts the window, so a try that started while the window was open can't enrol after the boot began.
- **Retry spacing** uses `performance.now()`.
- **Event streams:** an LRU-dropped browser's stream is ended before any write.
- **Upgrade requests:** cases are added.
- **Docs:** the plain-http loopback wording is now qualified.
- **Tests and mutants:** 675/675, CI green. The mutants for the fixes were killed, apart from the gaps listed below.

**Follow-ups (low or nit, not blocking; can go in a small follow-up PR):**
- **Low: every tokenless `POST /api/enrol` that waits leaves a `Promise.race` reaction on the shared sweep or teardown promise,** freed only when that promise settles. With a hung docker CLI and no timeout, a loopback caller in a loop can grow memory. Subscribe once per pending promise, or cap concurrent waiters.
- **Low: the settling loop (a teardown and then its cleanup) has no test.** Mutant E4 survives.
- **Unspent pane-entry tickets survive `rotatePanes`** and redeem to the new session's token. Only an enrolled browser can hold one, so this isn't a hole. Drop unspent enter tickets on rotation.
- **The "error lines are kept" claim isn't pinned** (mutant P5).
- **The retry gap runs from start to start,** so a run that takes 5 s or more to fail can be followed at once. Stamp the settle time too.
- **Two untested paths:** the early end when `res` closes (E6), and Open QA when re-enrolment fails (H6).

