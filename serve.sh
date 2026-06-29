#!/usr/bin/env bash
# Serve the site on your LAN so you can play from a phone on the same Wi-Fi.
set -euo pipefail

PORT="${1:-8000}"
cd "$(dirname "$0")"

# Find this machine's LAN IP (macOS first, then Linux fallback).
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '')"

echo "Serving $(pwd) on port $PORT"
if [ -n "$IP" ]; then
  echo "On your phone (same Wi-Fi) open:"
  echo "  http://$IP:$PORT/        (home)"
  echo "  http://$IP:$PORT/run/    (Purdue Run)"
  echo "  http://$IP:$PORT/flappy/ (Flappy)"
else
  echo "Could not auto-detect LAN IP; check System Settings > Wi-Fi."
fi
echo "Press Ctrl+C to stop."

python3 -m http.server "$PORT" --bind 0.0.0.0
