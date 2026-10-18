#!/bin/zsh
# scenario.sh <a|b> <draft>: a client stays attached; turn 1 builds, the client goes away 20 s at +5 s into the build,
# a steer arrives at +15 s; after turn 1 ends, turn 2 builds and Stop arrives at +15 s into its build.
S=${0:A:h}/../.logs; mkdir -p $S
cd ${0:A:h}/..
typeset -A port; port=(a 8791 b 8792 a2 8793 a2r0 8794)
P=localhost:$port[$1]/d/$2
node src/client.mjs $1 $2 > $S/client-$1-$2.log 2>&1 &
CLIENT=$!
waitjob() { until [ $(grep -c "$2-.* START" $S/coder.log) -ge $1 ]; do sleep 0.5; done; grep "$2-.* START" $S/coder.log | tail -1 | awk '{print $2}'; }
sleep 1
echo "$(date +%T) turn 1"; curl -s -X POST $P/message -d '{"text":"Make me a tiny snake game with neon colors."}'; echo
job=$(waitjob 1 $2); echo "$(date +%T) build $job started"
sleep 5; echo "$(date +%T) client away 20 s"; kill -USR1 $CLIENT
sleep 10; echo "$(date +%T) steer"; curl -s -X POST $P/message -d '{"text":"Actually, make the snake orange instead of green."}'; echo
until grep -q "turn_done\|turn_failed\|run_end" $S/client-$1-$2.log; do sleep 1; done; echo "$(date +%T) turn 1 over"
sleep 3; echo "$(date +%T) turn 2"; curl -s -X POST $P/message -d '{"text":"Now add a second level with walls."}'; echo
job2=$(waitjob 2 $2); echo "$(date +%T) build $job2 started"
sleep 15; echo "$(date +%T) STOP"; curl -s -X POST $P/stop; echo
sleep 8; echo "$(date +%T) coder job after stop: $(curl -s localhost:8790/jobs/$job2 | python3 -c 'import json,sys; d=json.load(sys.stdin); d.pop("spec",None); print(d)')"
kill -INT $CLIENT
