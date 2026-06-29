# Claude / Codex Usage Dashboard

An unofficial local dashboard for viewing Claude Code and Codex usage limits on a spare phone, tablet, or small screen.

The server runs on your local machine, reads local usage data, and serves a simple dashboard that can be opened from another device on the same Wi-Fi network.

![Status](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-767FC6)
![Node](https://img.shields.io/badge/node-%3E%3D18-43853D)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Features

- Shows Claude Code and Codex usage for the 5-hour and weekly windows.
- Reads Claude Code usage through a local `statusLine` cache.
- Reads Codex usage from the newest local `~/.codex/sessions` `rate_limits` snapshot.
- Works on a phone or tablet connected to the same Wi-Fi network.
- Tap the dashboard to refresh and request fullscreen mode.
- Turns red when usage reaches the alert threshold.
- Uses only Node.js built-in modules. No npm dependencies.

## Important Limitations

Usage numbers only update after you actually use Claude Code or Codex.

Claude Code usage comes from `statusLine`, so opening Claude in the web app or desktop app will not update this dashboard. Codex usage is read from local Codex session files, so it updates only after Codex writes new session data.

This project is not affiliated with Anthropic or OpenAI. It does not include official logos. Make sure your own use of third-party names, trademarks, and local tool output formats follows the relevant terms.

## Requirements

- Windows or Linux
- Node.js 18 or newer
- Claude Code, with `statusLine` configured for real Claude usage
- Codex, with local `~/.codex/sessions` data

Check Node.js:

```sh
node -v
```

## Quick Start

### Linux

```sh
git clone https://github.com/YOUR_NAME/claude-codex-usage-dashboard.git
cd claude-codex-usage-dashboard
HOST=0.0.0.0 PORT=8787 ./start-dashboard.sh
```

For local-only testing:

```sh
HOST=127.0.0.1 PORT=8787 ./start-dashboard.sh
```

You should see output similar to:

```text
Local:  http://localhost:8787
Device: http://192.168.1.23:8787
```

Open `http://localhost:8787` on the Linux machine. To use a phone or tablet, connect it to the same Wi-Fi network and open the `Device` URL.

### Windows

```powershell
git clone https://github.com/YOUR_NAME/claude-codex-usage-dashboard.git
cd claude-codex-usage-dashboard
node server.js
```

You should see output similar to:

```text
Local:  http://localhost:8787
Device: http://192.168.1.23:8787
```

Open `http://localhost:8787` on the Windows machine. To use a phone or tablet, connect it to the same Wi-Fi network and open the `Device` URL.

## Configure Claude Code Usage

### Linux

Run:

```sh
./setup-claude-statusline.sh
```

If `claude` is not in non-interactive shell `PATH`, that is fine. The setup script writes the absolute `node` path and the absolute statusline script path into `~/.claude/settings.json`.

Then:

1. Fully quit Claude Code or start a new Claude Code session.
2. Send one message.
3. Refresh the dashboard.

The Claude card will start reading `~/.claude/usage-cache.json`.

### Windows

Run:

```powershell
.\setup-claude-statusline.bat
```

Then:

1. Fully quit Claude Code.
2. Open Claude Code again.
3. Send one message.
4. Refresh the dashboard.

The Claude card will start reading `~/.claude/usage-cache.json`.

## If You Already Have a statusLine

Claude Code supports one `statusLine.command` at a time. If you already use another statusLine script, such as a Stream Deck integration or a custom prompt status line, use fanout mode.

Copy the example config:

Linux:

```sh
cp config.example.json config.json
```

Windows:

```powershell
Copy-Item .\config.example.json .\config.json
```

Edit `config.json`:

```json
{
  "extraStatuslineCommand": "powershell -NoProfile -ExecutionPolicy Bypass -File \"%USERPROFILE%\\.claude\\your-existing-statusline.ps1\""
}
```

Then run:

Linux:

```sh
./setup-claude-statusline.sh --fanout
```

Windows:

```powershell
.\setup-claude-statusline.bat --fanout
```

This sends the same Claude Code statusLine JSON to both this dashboard and your existing command.

## Start Automatically on Login

### Linux systemd user service

Install and start:

```sh
HOST=0.0.0.0 PORT=8787 ./install-systemd-user.sh
```

Check status:

```sh
systemctl --user status claude-codex-usage-dashboard.service
```

View logs:

```sh
journalctl --user -u claude-codex-usage-dashboard.service -f
```

Remove:

```sh
./uninstall-systemd-user.sh
```

### Windows startup shortcut

Install autostart:

```powershell
.\install-autostart.bat
```

Remove autostart:

```powershell
.\uninstall-autostart.bat
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Dashboard port |
| `HOST` | `0.0.0.0` | Allows devices on the same Wi-Fi to connect. Use `127.0.0.1` for local-only preview |
| `ALERT_PERCENT` | `85` | Usage percentage that turns the dashboard red |
| `CODEX_LOOKBACK_DAYS` | `14` | How many days of Codex sessions to scan |
| `CLAUDE_USAGE_CACHE` | `~/.claude/usage-cache.json` | Claude usage cache path |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex sessions path |
| `EXTRA_STATUSLINE_COMMAND` | empty | Extra command for fanout mode |

Example:

Linux:

```sh
PORT=8790 HOST=127.0.0.1 ./start-dashboard.sh
```

Windows:

```powershell
$env:PORT="8790"
$env:HOST="127.0.0.1"
node server.js
```

## Linux Firewall

If your phone or tablet cannot connect, allow the dashboard port through your firewall.

UFW example:

```sh
sudo ufw allow 8787/tcp
```

## Windows Firewall

If your phone or tablet cannot connect, allow the dashboard port through Windows Firewall:

```powershell
netsh advfirewall firewall add rule name="AIUsageDashboard" dir=in action=allow protocol=TCP localport=8787
```

## Privacy

Data stays on your machine. The server reads local Claude and Codex usage records, but does not upload them anywhere.

Do not commit:

- `~/.claude/usage-cache.json`
- `~/.codex/sessions`
- `~/.claude/settings.json`
- `config.json`

## Uploading to GitHub

See [GITHUB_UPLOAD_GUIDE.md](GITHUB_UPLOAD_GUIDE.md) for a first-time step-by-step guide.

## License

MIT
