# BABYSIT round 2 (#35 79e3efc, #36 31056d0, #37 16e03c1) — order #35 -> #36 -> #37, merge up, then #32 PR 2
#34 frozen at 07098b8. 32b WIP at 93853dd (agent/w1-issue-32b-wip), not yet opened.

## #35 (comment 6197607839) — notes/v35b.md
- [ ] HIGH maxCollections cut: by rows (most first), rest count-only stubs (cap 10x), rest left out with named problem; flagChanges red unverified for base-diff collection PR diff lacks; divergence unknown when PR lacks
- [ ] Set/Map isSet by size; test 3 classes
- [ ] secretKeyIn linear: word-start lookbehind, skip without [:=], scan cap HELD_JSON_MAX; timing test
- [ ] escaped quotes, double-encoded (re-parse literal), brackets (user[password]=), XML <password>
- [ ] cache total cap 50,000 (cachedFields())
- [ ] lows: names ssh_key redis_url backup_codes; URL userinfo; Bearer; name/value pairs; rawHeaders
- [ ] updateId includes values
- [ ] both cut short unchanged -> amber unverified
- [ ] mutants: left decrement, untrusted both cut, field cap, key= text, nested digest key, hyphen forms, pii across field names
- [ ] nit README:400 list; docs + CHANGELOG
## #36 (comment 6197608494) — notes/v36b.md
- [ ] M1 late S1: baselineAt per pane; spans with differing windows complete:false + untrusted flags; settle every pane in that run
- [ ] M2 bound: cap flags per collection w/ per-kind counts; cut field lists in budget; cache failures; state true bound (CHANGELOG + judgment E)
- [ ] lows: per-span budget share + cut marker; await failed boot's close; errors.boot not overwritten (keep both; "coming" only with S0); tests R4 R5 R6 R13 R34
- [ ] FROM #37 r2 HIGH: red 'unreadable' flag for a span whose PR pane is missing; test via real capture with PR probe that throws/hangs
## #37 (comment 6197683565) — run/review-37b/findings.json
- [ ] HIGH: "The PR pane's changes are unknown" instead of "No destructive change."; Incomplete line per pane
- [ ] Low: escape \p{Zl}\p{Zp}
- [ ] Nits: JSON cut at 200 chars shows partial digest; mutants M29/C9, G11, G7, four strings not isolated, P8, P10; CHANGELOG:98 "a few hundred items" wrong (Actions up to 4,000 request rows)

## #39 (comment 6197922762) — after #37, before #32 PR 2 (32b stacks on #39: merge 32a into 32b after)
- [ ] MED idle CONNECT tunnel never closes PR socket: upstream close -> socket.destroy(), client idle timeout, test getConnections -> 0
- [ ] lows: status 000-099 crash -> 502 failed; add run/review-39/egress/mut/test/extra.test.mjs + net.connect spy test; 15/22 service mutants (list in comment); test file hang: track+destroy sockets in close(), t.after; plain-HTTP connect timer + idle timer; upstream cut mid-body hangs; after 200 a 502 into tunnel -> use 'failed' both paths; Connection-named headers dropped; allowHalfOpen on forward; validate whole config before listening, {} exits 1; wording HTTPS per address; canonicalize entries and CONNECT hosts (0x7f, *.localhost); test untested ranges
- [ ] nits: IPv6 entries compared as strings; dead clause + public suffixes; close() with forward connections; log line format/length
- orphan check: no node --test left behind (ps for ppid 1)
