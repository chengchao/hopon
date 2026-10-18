#!/bin/zsh
# lat.sh <a2|a2r0> <draft> [gap s]: four short turns, [gap] s apart (default 5); prints POST -> pi run_start per turn,
# which covers loading the conversation (from memory, or from SQLite when retention is 0). Turn 1 is a fresh Draft.
cd ${0:A:h}/..
S=${0:A:h}/../.logs; mkdir -p $S
typeset -A port; port=(a2 8793 a2r0 8794); P=localhost:$port[$1]/d/$2
L=$S/lat-$1-$2.log
node src/view-client.mjs $port[$1] $2 /dev/null > $L 2>&1 & CLIENT=$!
sleep 1
for i in 1 2 3 4; do
  n=$(grep -c RUN_START $L); t=$(python3 -c 'import time; print(int(time.time()*1000))')
  curl -s -X POST $P/message -d '{"text":"Say hi in three words."}' > /dev/null
  until [ $(grep -c RUN_START $L) -gt $n ]; do sleep 0.05; done
  r=$(grep RUN_START $L | tail -1 | awk '{print $1}'); echo "$1 turn $i: POST -> run_start $(( r - t )) ms"
  until [ $(grep -c run_end $L) -ge $i ]; do sleep 0.2; done; sleep ${3:-5}
done
kill $CLIENT
