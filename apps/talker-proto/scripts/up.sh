#!/bin/zsh
# up.sh <a|b|coder> : (re)start one wrangler dev in the background, wait until ready.
cd ${0:A:h}/..
S=${0:A:h}/../.logs; mkdir -p $S
typeset -A port insp; port=(coder 8790 a 8791 b 8792); insp=(coder 9340 a 9341 b 9342)
pkill -f "wrangler.$1.jsonc" ; sleep 1
nohup npx wrangler dev -c wrangler.$1.jsonc --port $port[$1] --inspector-port $insp[$1] >> $S/$1.log 2>&1 &
for i in {1..60}; do curl -s -o /dev/null localhost:$port[$1] && { echo "$1 up"; exit 0; }; sleep 1; done; echo "$1 NOT up"; tail -20 $S/$1.log
