#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

: "${PORT:=8787}"
: "${HOST:=0.0.0.0}"
: "${ALERT_PERCENT:=85}"
: "${CODEX_LOOKBACK_DAYS:=14}"

export PORT HOST ALERT_PERCENT CODEX_LOOKBACK_DAYS

exec node server.js
