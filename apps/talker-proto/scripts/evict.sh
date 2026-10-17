#!/bin/zsh
# evict.sh <a|b> <draft> : start a build turn, restart the dev server 20 s into the build with no client attached,
# then wait (no requests to the Talker) and report what the Coder saw.
S=${0:A:h}/../.logs; mkdir -p $S
typeset -A port; port=(a 8791 b 8792)
echo "$(date +%T) POST message"; curl -s -X POST localhost:$port[$1]/d/$2/message -d '{"text":"Make me a tiny snake game with neon colors.","model":"sonnet"}'; echo
until grep -q "$2-" $S/coder.log && grep "$2-" $S/coder.log | grep -q START; do sleep 1; done
job=$(grep "$2-" $S/coder.log | grep START | tail -1 | awk '{print $2}'); echo "$(date +%T) job $job started"
sleep 20; echo "$(date +%T) RESTART $1 (kill wrangler)"; ${0:A:h}/up.sh $1 | tail -1; echo "$(date +%T) $1 back; no requests from here"
for i in {1..12}; do sleep 10; echo "$(date +%T) coder: $(curl -s localhost:8790/jobs/$job | tr -d '\n' | cut -c1-200)"; done
