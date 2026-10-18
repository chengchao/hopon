#!/bin/zsh
# snap.sh <a2|a2r0> <draft>: snapshot-on-connect against the pi Talker. An app-like client (src/view-client.mjs) keeps
# its view from snapshots + batches; after each step its view is compared with the server's transcript.
#   1. build turn; client away 20 s at +5 s; steer at +15 s
#   2. build turn; dev server restarted at +20 s (sockets drop; the client reconnects on its own)
#   3. 40 s idle with the socket held, then a short turn (hibernation with retention 0)
#   4. build turn; Stop at +15 s
D=${0:A:h}; cd $D/..
S=${0:A:h}/../.logs; mkdir -p $S
typeset -A port; port=(a2 8793 a2r0 8794); P=localhost:$port[$1]/d/$2
L=$S/snap-$1-$2.log; DUMP=$S/view-$1-$2.json
now() { python3 -c 'import time; print(int(time.time()*1000))'; }
node src/view-client.mjs $port[$1] $2 $DUMP > $L 2>&1 & CLIENT=$!
runs() { grep -c "run_end" $L; }
waitrun() { until [ $(runs) -ge $1 ]; do sleep 1; done; sleep 1; }
jobs() { grep -c " $1-.* START" $S/coder.log; }
waitjob() { until [ $(jobs $2) -gt $1 ]; do sleep 0.5; done; }
check() { kill -USR2 $CLIENT; sleep 1; curl -s $P/messages > $S/server-$2.json; echo "$(date +%T) $3: $(python3 $D/verify.py $DUMP $S/server-$2.json)"; }
post() { echo "$(date +%T) POST $(now) $1"; curl -s -X POST $P/message -d "{\"text\":\"$1\"}" > /dev/null; }
sleep 1
J=$(jobs $2); post "Make me a tiny snake game with neon colors."; waitjob $J $2
sleep 5; kill -USR1 $CLIENT; echo "$(date +%T) client away 20 s"
sleep 10; post "Actually, make the snake orange instead of green."
waitrun 1; check $1 $2 "1 away+steer"
J=$(jobs $2); post "Now add a second level with walls."; waitjob $J $2
sleep 20; echo "$(date +%T) RESTART"; $D/up.sh $1 | tail -1
waitrun 2; check $1 $2 "2 restart"
sleep 40; post "Say bye in three words."
waitrun 3; check $1 $2 "3 idle 40 s"
J=$(jobs $2); post "Make the snake faster."; waitjob $J $2
sleep 15; echo "$(date +%T) STOP"; curl -s -X POST $P/stop > /dev/null
waitrun 4; check $1 $2 "4 stop"
kill $CLIENT
