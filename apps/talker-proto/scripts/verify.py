# verify.py <dump.json> <messages.json>: does the client's view hold exactly the server's transcript?
import json, sys
view = json.load(open(sys.argv[1]))
server = json.load(open(sys.argv[2]))
v = [(e["id"], e["kind"]) for e in view["entries"]]
s = [(e["id"], e["kind"]) for e in server]
missing = [x for x in s if x not in v]
extra = [x for x in v if x not in s]
status = "VIEW OK" if not missing and not extra else "VIEW MISMATCH"
print(f"{status}: view {len(v)} entries, server {len(s)}, missing {missing}, extra {extra}, running={view['running']}, outcomes={view['outcomes']}")
