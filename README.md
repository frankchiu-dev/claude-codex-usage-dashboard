# Claude / Codex Usage Dashboard

An unofficial local dashboard for viewing Claude Code and Codex usage limits on a spare phone, tablet, or small screen.

The server runs on your own Windows or macOS machine, reads local usage data, and serves a simple dashboard that can be opened from another device on the same Wi-Fi network.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-767FC6)
![Node](https://img.shields.io/badge/node-%3E%3D18-43853D)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Features

- Shows Claude Code and Codex usage for the 5-hour and weekly windows.
- Can display either used percentage or remaining percentage.
- Reads Claude Code usage through a local `statusLine` cache.
- Reads Codex usage from the newest local `~/.codex/sessions` `rate_limits` snapshot.
- Works on a phone or tablet connected to the same Wi-Fi network.
- Tap the dashboard to refresh and request fullscreen mode.
- Turns red when usage reaches the alert threshold.
- Uses only Node.js built-in modules. No npm dependencies.
- Includes helper scripts for Windows and macOS.
- Includes a server-rendered KOBO / e-ink page for older browsers.

## Important Limitations

Usage numbers only update after you actually use Claude Code or Codex.

Claude Code usage comes from `statusLine`, so opening Claude in the web app or desktop app will not update this dashboard. Codex usage is read from local Codex session files, so it updates only after Codex writes new session data.

This project is not affiliated with Anthropic or OpenAI. It does not include official logos. Make sure your own use of third-party names, trademarks, and local tool output formats follows the relevant terms.

This is a personal side project. Support is best-effort.

## Requirements

- Windows 10/11 or macOS
- Node.js 18 or newer
- Claude Code, with `statusLine` configured for real Claude usage
- Codex, with local `~/.codex/sessions` data

Check Node.js:

```bash
node -v
```

## Quick Start

Clone the repository:

```bash
git clone https://github.com/frankchiu-dev/claude-codex-usage-dashboard.git
cd claude-codex-usage-dashboard
```

Start the dashboard:

```bash
node server.js
```

You should see output similar to:

```text
Local:  http://localhost:8787
Device: http://192.168.1.23:8787
```

Open `http://localhost:8787` on the computer running the server. To use a phone or tablet, connect it to the same Wi-Fi network and open the `Device` URL.

## KOBO / E-ink Mode

Many KOBO browsers are old and do not reliably support modern JavaScript features such as `fetch`, `async/await`, wake lock, or modern CSS. If the normal dashboard loads but the numbers never appear, use the KOBO page instead:

```text
http://YOUR-LAN-IP:8787/kobo
```

`/eink` is also available as an alias.

The KOBO page is rendered on the server, so the numbers are already inside the HTML. It does not require JavaScript. It refreshes with a simple `<meta refresh>` tag.

Display remaining percentage:

```text
http://YOUR-LAN-IP:8787/kobo?mode=remaining
```

Display used percentage:

```text
http://YOUR-LAN-IP:8787/kobo?mode=used
```

KOBO browsers also may not rotate web pages reliably. The `/kobo` page is designed for portrait reading mode instead of relying on landscape rotation.

## Start Scripts

### Windows

```powershell
.\start-dashboard.bat
```

### macOS

```bash
chmod +x ./start-dashboard.sh ./start-dashboard.command
./start-dashboard.sh
```

You can also double-click `start-dashboard.command` in Finder after making it executable.

## Configure Claude Code Usage

This step lets the dashboard show real Claude Code usage.

### Windows

```powershell
.\setup-claude-statusline.bat
```

### macOS

```bash
chmod +x ./setup-claude-statusline.sh
./setup-claude-statusline.sh
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

### Windows

```powershell
Copy-Item .\config.example.json .\config.json
```

### macOS

```bash
cp ./config.example.json ./config.json
```

Edit `config.json`.

Windows example:

```json
{
  "extraStatuslineCommand": "powershell -NoProfile -ExecutionPolicy Bypass -File \"%USERPROFILE%\\.claude\\your-existing-statusline.ps1\""
}
```

macOS example:

```json
{
  "extraStatuslineCommand": "/Users/YOUR_NAME/.claude/your-existing-statusline.sh"
}
```

Then enable fanout mode.

### Windows

```powershell
.\setup-claude-statusline.bat --fanout
```

### macOS

```bash
./setup-claude-statusline.sh --fanout
```

This sends the same Claude Code statusLine JSON to both this dashboard and your existing command.

## Start Automatically on Login

### Windows

Install autostart:

```powershell
.\install-autostart.bat
```

Remove autostart:

```powershell
.\uninstall-autostart.bat
```

### macOS

Install a LaunchAgent:

```bash
chmod +x ./install-autostart-macos.sh ./uninstall-autostart-macos.sh
./install-autostart-macos.sh
```

Remove the LaunchAgent:

```bash
./uninstall-autostart-macos.sh
```

The macOS LaunchAgent writes logs to:

```text
~/Library/Logs/claude-codex-usage-dashboard.log
~/Library/Logs/claude-codex-usage-dashboard.err.log
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Dashboard port |
| `HOST` | `0.0.0.0` | Allows devices on the same Wi-Fi to connect. Use `127.0.0.1` for local-only preview |
| `ALERT_PERCENT` | `85` | Usage percentage that turns the dashboard red |
| `DISPLAY_MODE` | `used` | Display `used` percentage or `remaining` percentage |
| `KOBO_REFRESH_SECONDS` | `60` | Refresh interval for `/kobo`; minimum rendered value is 15 seconds |
| `CODEX_LOOKBACK_DAYS` | `14` | How many days of Codex sessions to scan |
| `CLAUDE_USAGE_CACHE` | `~/.claude/usage-cache.json` | Claude usage cache path |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex sessions path |
| `EXTRA_STATUSLINE_COMMAND` | empty | Extra command for fanout mode |

Windows example:

```powershell
$env:PORT="8790"
$env:HOST="127.0.0.1"
$env:DISPLAY_MODE="remaining"
$env:KOBO_REFRESH_SECONDS="120"
node server.js
```

macOS example:

```bash
PORT=8790 HOST=127.0.0.1 DISPLAY_MODE=remaining KOBO_REFRESH_SECONDS=120 node server.js
```

`DISPLAY_MODE=used` shows how much of the limit has been used. `DISPLAY_MODE=remaining` shows how much is left. The red alert color is still based on used percentage reaching `ALERT_PERCENT`.

## Network Access

If another device cannot connect, make sure it is on the same Wi-Fi network as the computer running the dashboard.

### Windows Firewall

```powershell
netsh advfirewall firewall add rule name="AIUsageDashboard" dir=in action=allow protocol=TCP localport=8787
```

### macOS Firewall

macOS may ask whether Node.js can accept incoming network connections. Allow it if you want to open the dashboard from a phone or tablet.

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
