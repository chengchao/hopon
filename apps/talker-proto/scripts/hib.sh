#!/bin/zsh
# hib.sh <a|a2|b> <draft> [idle s]: connect a client to an idle Talker, stay idle (default 40 s; it should hibernate), then send a short
# message and see whether the held socket gets the new turn.
S=${0:A:h}/../.logs; mkdir -p $S
cd ${0:A:h}/..
typeset -A port; port=(a 8791 b 8792 a2 8793 a2r0 8794); P=localhost:$port[$1]/d/$2
curl -s -X POST $P/message -d '{"text":"Say hi in three words."}' > /dev/null; sleep 6
node src/client.mjs $1 $2 > $S/client-$1-$2.log 2>&1 & CLIENT=$!
IDLE=${3:-40}; sleep $IDLE; echo "$(date +%T) message after $IDLE s idle"; curl -s -X POST $P/message -d '{"text":"Say bye in three words."}'; echo; sleep 8
kill -INT $CLIENT; grep -v "message_start\|usage_changed\|submission\|turn_start\|turn_end" $S/client-$1-$2.log | cut -c1-160
