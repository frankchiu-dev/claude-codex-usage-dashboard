#!/usr/bin/env sh
set -eu

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. Use ./start-dashboard.sh instead." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found in PATH. Install Node.js 18 or newer first." >&2
  exit 1
fi

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_BIN=$(command -v node)
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="$SYSTEMD_USER_DIR/claude-codex-usage-dashboard.service"

PORT_VALUE="${PORT:-8787}"
HOST_VALUE="${HOST:-0.0.0.0}"
ALERT_PERCENT_VALUE="${ALERT_PERCENT:-85}"
CODEX_LOOKBACK_DAYS_VALUE="${CODEX_LOOKBACK_DAYS:-14}"

mkdir -p "$SYSTEMD_USER_DIR"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Claude / Codex usage dashboard
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=on-failure
RestartSec=5
Environment=PORT=$PORT_VALUE
Environment=HOST=$HOST_VALUE
Environment=ALERT_PERCENT=$ALERT_PERCENT_VALUE
Environment=CODEX_LOOKBACK_DAYS=$CODEX_LOOKBACK_DAYS_VALUE

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now claude-codex-usage-dashboard.service

echo "Installed and started:"
echo "  systemctl --user status claude-codex-usage-dashboard.service"
echo
echo "Dashboard defaults:"
echo "  HOST=$HOST_VALUE PORT=$PORT_VALUE"
echo "  http://localhost:$PORT_VALUE"
