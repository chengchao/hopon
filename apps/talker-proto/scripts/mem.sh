#!/bin/zsh
# mem.sh <a|b>: restart, then the dev server's workerd RSS after module load, after one Draft's short turn, after
# five more Drafts (each a separate Durable Object in the same isolate).
S=${0:A:h}/../.logs; mkdir -p $S
typeset -A port; port=(a 8791 b 8792 a2 8793 a2r0 8794)
${0:A:h}/up.sh $1 > /dev/null; sleep 3; curl -s localhost:$port[$1]/ > /dev/null; sleep 2
pid=$(lsof -nP -iTCP:$port[$1] -sTCP:LISTEN -t | head -1)
rss() { echo "$(( $(ps -o rss= -p $pid) / 1024 )) MiB"; }
echo "$1 module loaded: $(rss)"
turn() { curl -s -X POST localhost:$port[$1]/d/$2/message -d '{"text":"Say hi in three words."}' > /dev/null; sleep 6; }
turn $1 m0; echo "$1 1 Draft after a turn: $(rss)"
for d in m1 m2 m3 m4 m5; do turn $1 $d; done; echo "$1 6 Drafts after a turn each: $(rss)"
