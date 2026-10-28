8b engine review (reviewer agent, d907245; probes in review/8b/)

H1 flag severity by counts not items -> per item: keyed keys subset, unkeyed multiset, truncated pr<=base; column-dropped per field
H2 trustOf string vs {trusted} boolean -> trusted === true
M3 JSON-as-text secrets in clear -> parse '{'/'[' strings, mask via toJson
M4 secret/pii '' [] {} never 'cleared' -> unset values plain before classify (isSet fix: Date, bytes)
M5 SECRET_NAME misses: authorization cookie credentials pwd pin cvv jwt bearer access_key signing_key client_key dsn database_url signature
M6 diffBag ignores schema fields -> strip
M7 diff key = key used (null for bag)
M8 truncated equal count -> 'unknown' not 'same'; divergence carries truncated; count>rows => truncated; truncated w/o count -> problem
M9 soft delete 0/1, masked soft field -> softDelete fields never masked; unset = null false 0 ''
M10 proto-named collections/fields -> own-property put/get
M11 perf: memo classOf, compile globs once, bag push not spread
L: secret wins over pii; destructive exact rule wins, unknown entry keys rejected; lifecycle+changed => differs; schema changes in unkeyed/truncated divergence; nested Buffer/typed arrays in JSON; secret MAC with collection/field; limits null; throwing getters per collection
README: severity, JSON text, unset, truncated, trust type, column-dropped field
Test gaps: MASS_MIN_ROWS >=, maxChanged >, isUnsetCell false, cleared soft guard, schemaChanges, lifecycle override, countsOf truncated, keyed !truncated, bigint, invalid Date, volatile on key/fields, byteOffset, pii array type, flag sort by field, first destructive rule
