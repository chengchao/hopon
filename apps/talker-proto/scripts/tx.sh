#!/bin/zsh
# tx.sh <draft>: Talker A's transcript, one line per entry.
curl -s localhost:8791/d/$1/messages | python3 -c "
import json,sys,datetime
for e in json.load(sys.stdin):
  for m in e.get('model',[]):
    c=m.get('content')
    if isinstance(c,list): c=[(p.get('type'), (p.get('text') or p.get('name') or '')[:90]) for p in c]
    t=datetime.datetime.fromtimestamp(m.get('timestamp',0)/1000).strftime('%T')
    print(t, e['id'], e['kind'], str(c)[:240], m.get('stopReason',''), (m.get('errorMessage') or '')[:200])
"
