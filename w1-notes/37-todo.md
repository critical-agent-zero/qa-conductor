# BABYSIT #34-#37 — DONE (2026-10-15)
- #34 07098b8 (approved, ready; body edited only: r3 carry-overs, evictions, grouping tests moved to #37)
- #35 79e3efc (draft), 774 tests
- #36 31056d0 (draft), 796 tests, CI green, reply 6196715593, body updated
- #37 16e03c1 (draft), 817 tests, CI green, reply 6197159535, body updated (merge b9dda96 of 8c)
- #38 1254845 untouched
Not fixed / trade-offs: #35 classify top-level only (documented); #36 no separate concurrency limiter (cache), per-call inspector budget (150 s documented), view build ~0.8 s once per snapshot at 4x10k rows; #34 nit: bad byte inside a run blocks toy-length encoded fullwidth @ (left; realistic lengths -> :token); #38 optional sort-pinning test + comment rewording for later.
NEXT: ISSUE 32 from agent/w1-issue-32a (231e8a3) per notes/32-status.md: per-test timeouts for the hanging mutant, then PR 1 "Part of #32".
