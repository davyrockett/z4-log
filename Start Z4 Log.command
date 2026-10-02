#!/bin/bash
# Double-click this file to run Z4 Log on this Mac.
# Keep this window open while you use the app; close it to stop.
cd "$(dirname "$0")"
PORT=8765   # don't change: your data is tied to this exact address
if ! lsof -i :$PORT >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 1
fi
open -a Safari "http://localhost:$PORT/"
echo "Z4 Log is running at http://localhost:$PORT"
echo "Close this window when you're done."
wait
