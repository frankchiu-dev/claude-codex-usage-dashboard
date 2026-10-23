# Claude / Codex Usage Dashboard

View Claude Code and Codex usage on your computer, phone, tablet, or KOBO. The dashboard runs on your own Windows or macOS computer. Cloudflare, a domain name, and a hosted server are optional.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-767FC6)
![Node](https://img.shields.io/badge/node-%3E%3D18-43853D)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## Start on this computer

Install Node.js 18 or newer, then run:

```bash
git clone https://github.com/frankchiu-dev/claude-codex-usage-dashboard.git
cd claude-codex-usage-dashboard
node server.js
```

Open **http://127.0.0.1:8787**. No npm install is required. Windows users can double-click `start-dashboard.bat`; macOS users can run `bash start-dashboard.sh` or the executable `start-dashboard.command`.

You can use Claude Code, Codex, or both. Missing data shows setup guidance; it is never treated as zero usage. This unofficial project is not affiliated with Anthropic or OpenAI.

## View on a phone or tablet

1. Connect the computer and phone to the same trusted Wi-Fi network.
2. Stop the dashboard with Ctrl+C and start LAN mode:

```bash
node server.js --lan
```

3. Open the **Pair** link printed in the computer's terminal.
4. Choose **Connect a device** and scan the QR code for your Wi-Fi/Ethernet address.

The QR code is generated locally. Scanning it pairs the browser and opens the dashboard. Network mode requires pairing for the overview, usage API, history, and KOBO pages. Keep the QR code and pairing link private: they grant access to your usage. With the default temporary key, restarting signs devices out. An optional persistent key is described below.

If multiple network adapters are listed, choose the address belonging to the Wi-Fi or Ethernet connection shared with your phone. Guest Wi-Fi, client isolation, a VPN, or the computer's firewall may prevent a connection. Any firewall permission should be limited to your trusted private network.

The source computer must stay awake and the dashboard must keep running. LAN sharing uses HTTP; pairing does not encrypt Wi-Fi traffic. Use the optional HTTPS remote-access methods for untrusted networks.

## Where the numbers come from

- **Claude Code:** a local status-line cache, normally `~/.claude/usage-cache.json`.
- **Codex:** the newest normal Codex quota snapshot in local `~/.codex/sessions` logs.

Opening this page does not query a model, call a usage API, or renew credentials. Numbers change when Claude Code or Codex updates the corresponding local records. Claude web/desktop activity alone does not refresh the local Claude status-line cache.

Codex windows are identified by their actual duration. If the account reports only a weekly window, the five-hour field stays unavailable. Data older than two hours is labelled old; an unavailable window remains `--`.

### Configure Claude Code

Windows:

```powershell
.\setup-claude-statusline.bat
```

macOS:

```bash
bash setup-claude-statusline.sh
```

Restart Claude Code, send one message, then refresh the dashboard. Some Claude Code versions may not supply quota fields to their status line; if they are absent, this version leaves Claude usage unavailable instead of reading OAuth credentials.

### Keep an existing Claude-HUD or other status line

Enable fanout before replacing your current status-line command:

```powershell
.\setup-claude-statusline.bat --fanout
```

```bash
bash setup-claude-statusline.sh --fanout
```

Setup backs up settings and preserves the previous command in `extraStatuslineCommand` without replacing an existing nonempty value. It preserves unrelated settings, including status-line padding. Repeated setup does not capture the dashboard's wrapper as the extra command.

Fanout forwards the same input to both commands. A successful extra command with non-whitespace output owns the display, preserving multiline layout, ANSI escapes, and trailing newlines. Missing, empty, failed, or timed-out output falls back to the dashboard's status line. Each command has a 15-second timeout and they run sequentially. If both fail, the display falls back to `Claude`.

For manual configuration, preserve your existing config and add the exact original command to `extraStatuslineCommand`, including its shell quoting. `EXTRA_STATUSLINE_COMMAND` takes precedence. Only configure commands you trust. If an older setup already replaced the original command, retrieve it from a `~/.claude/settings.json.bak-*` backup or run your HUD setup again before enabling fanout.

## History and forecast

Choose **History & forecast** to see weekly usage for 24 hours, 48 hours, 7 days, or 30 days. The collector checks local records once per minute and saves only distinct source observations. It stores timestamps, percentages, and reset times, without prompts, session names, tokens, or credentials.

History starts when this version runs; it does not reconstruct earlier usage from old conversations. Default retention is 30 days. Set `HISTORY_DAYS=0` to disable recording, or 1–60 to choose retention. The default data directory is `~/.claude-codex-usage-dashboard`. Stop the dashboard before deleting `history.jsonl` to clear its history.

The forecast supports Claude/Codex, recent 6/24/48-hour pace, and slower/current/faster scenarios. It uses distinct source timestamps from the current quota period. Resets, stale data, long missing intervals, or insufficient coverage pause the estimate. The daily allowance is remaining percentage points divided by time until reset. These are planning estimates, not official billing or guarantees of future capacity.

## KOBO and e-ink

After pairing in LAN/remote mode, open:

- `/k` — remaining percentage.
- `/u` — used percentage.
- `/kobo?mode=remaining` or `/kobo?mode=used` — explicit alternatives.

The server renders the numbers into HTML and uses meta refresh, so JavaScript is not required. Other aliases are `/eink`, `/e`, `/r`, `/kr`, and `/ku`. Older browsers must support cookies for paired access. Open the pairing link or use the pairing-key form on `/pair` first.

## Optional remote access

| Need | Option |
| --- | --- |
| On this computer | Default local mode |
| Phone/tablet on the same Wi-Fi | Built-in LAN mode and QR pairing |
| Private access away from home | Tailscale Serve |
| Browser access through your own domain | Cloudflare Tunnel with Access |

See [remote-access.md](docs/remote-access.md) for separate Tailscale and Cloudflare instructions. Remote access uses the same local dashboard and does not move usage collection to a cloud server. Computer sleep or shutdown stops collection and live viewing.

## Configuration

Optional: copy `config.example.json` to `config.json` if that file does not exist. Merge into existing settings rather than replacing them. Environment variables override config values; `--lan` overrides `HOST` for that run.

| Setting | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Local only; `0.0.0.0` enables paired LAN access |
| `PORT` | `8787` | HTTP port |
| `DISPLAY_MODE` | `used` | `used` or `remaining` |
| `ALERT_PERCENT` | `85` | Used percentage at which numbers turn red |
| `STALE_MINUTES` | `120` | Age after which source data is labelled old |
| `HISTORY_DAYS` | `30` | Local retention, 0 to disable, maximum 60 days |
| `DATA_DIR` | `~/.claude-codex-usage-dashboard` | Compact history storage |
| `CODEX_LOOKBACK_DAYS` | `14` | Session folders scanned for quota snapshots |
| `CLAUDE_USAGE_CACHE` | `~/.claude/usage-cache.json` | Claude cache; also set the same environment variable for the status-line command if changed |
| `CODEX_SESSIONS_DIR` | `~/.codex/sessions` | Codex session folder |
| `KOBO_REFRESH_SECONDS` | `60` | E-ink refresh interval, minimum 15 seconds |
| `PUBLIC_URL` | empty | Exact HTTPS origin used by an optional reverse proxy; also enables pairing and secure cookies |
| `PAIRING_KEY` | random on restart | Optional persistent secret: 24–128 ASCII letters, digits, underscores or hyphens |
| `DASHBOARD_CONFIG` | repository `config.json` | Alternate dashboard config file |
| `extraStatuslineCommand` | empty | Existing trusted status-line command |

To create a persistent pairing key without contacting any service:

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

Store it in the ignored `config.json`. To revoke paired browsers, change the key and restart. Pairing cookies expire after 30 days; pair again when needed. Keys and pairing links should not be shared in screenshots or public issues.

Example config for paired Wi-Fi access:

```json
{
  "HOST": "0.0.0.0",
  "DISPLAY_MODE": "remaining",
  "HISTORY_DAYS": 30,
  "extraStatuslineCommand": ""
}
```

### Start on login

On Windows, run `install-autostart.bat`; remove with `uninstall-autostart.bat`. On macOS, run `bash install-autostart-macos.sh`; remove with `bash uninstall-autostart-macos.sh`.

Autostart uses `config.json`, so configure `HOST` and a persistent `PAIRING_KEY` there if you want paired devices to survive a restart. Temporary shell environment variables are not saved by the installer. macOS logs are in `~/Library/Logs/claude-codex-usage-dashboard.log` and `.err.log`; startup logs can contain the private pairing link.

## Upgrading from 0.4.x

The default now binds to localhost. For existing Wi-Fi displays, enable `--lan` or set `HOST` in config, then pair each browser once. Existing status-line and fanout settings are preserved. Cloudflare and Tailscale deployments need their exact HTTPS origin in `PUBLIC_URL`.

## Tests and privacy

Run `npm test` or `node --test`. Tests cover quota-window interpretation, cache/session inputs, history, forecast, real local/LAN HTTP servers, pairing boundaries, and status-line preservation. The status-line timeout regression takes about 15 seconds. Windows automated checks do not replace a real-device macOS, KOBO, or phone check.

The server makes no outbound network requests. Browser assets and QR generation are local. The repository README badges above are external images viewed on GitHub. The QR generator is vendored under its MIT license in [vendor](vendor/README.md); runtime uses Node built-ins and requires no installed npm dependencies.

Keep `config.json`, history, local provider files, session logs, OAuth credentials, and pairing links out of Git. See [SECURITY.md](SECURITY.md). Personal Cloudflare settings, StreamDock integration, Windows service paths, and provider credential renewal are not required by this portable edition.

## License

MIT. QR Code is a registered trademark of DENSO WAVE INCORPORATED. Third-party names identify the data sources; no official logos are included.
