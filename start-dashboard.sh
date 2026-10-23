#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Starting Claude / Codex usage dashboard..."
echo
echo "Optional environment variables:"
echo "  PORT=8787 ALERT_PERCENT=85 DISPLAY_MODE=used CODEX_LOOKBACK_DAYS=14"
echo "Default: local only. Pass --lan to share with paired devices on Wi-Fi."
echo

exec node server.js "$@"
