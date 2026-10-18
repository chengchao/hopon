#!/bin/zsh
# stop.sh <a|b> <draft>: build turn, Stop 15 s into the build, wait 40 s (past an alarm), then a follow-up turn.
S=${0:A:h}/../.logs; mkdir -p $S
cd ${0:A:h}/..
typeset -A port; port=(a 8791 b 8792 a2 8793 a2r0 8794); P=localhost:$port[$1]/d/$2
node src/client.mjs $1 $2 > $S/client-$1-$2.log 2>&1 & CLIENT=$!
sleep 1; curl -s -X POST $P/message -d '{"text":"Make me a tiny snake game with neon colors."}'; echo
until grep -q " $2-.* START" $S/coder.log; do sleep 0.5; done; job=$(grep " $2-.* START" $S/coder.log | tail -1 | awk '{print $2}')
sleep 15; echo "$(date +%T) STOP"; curl -s -X POST $P/stop; echo; sleep 40
echo "coder: $(grep " $job " $S/coder.log | grep -v wrangler | cut -c1-70 | tr '\n' ' ')"
echo "$(date +%T) follow-up"; curl -s -X POST $P/message -d '{"text":"What happened to my game?"}'; echo; sleep 12
kill -INT $CLIENT; grep -v "progress\|tick\|update" $S/client-$1-$2.log | cut -c1-200
