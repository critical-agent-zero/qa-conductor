import json, sys
# usage: pick-mut.py <in.json> <out.json> <id prefix>...
src, out, ids = sys.argv[1], sys.argv[2], set(sys.argv[3:])
m = json.load(open(src))
json.dump([x for x in m if x['id'].split()[0] in ids], open(out, 'w'), indent=1)
print(len(ids))
