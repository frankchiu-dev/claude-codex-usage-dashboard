# Security Policy

## Data and credentials

The dashboard reads the configured Claude status-line cache and Codex session logs locally. It renders only quota percentages, source timestamps, and reset times. Compact history contains those fields and capture timestamps. It does not read OAuth credentials, forward raw session records, or make outbound requests.

Do not commit config.json, history.jsonl, provider caches, session logs, settings files, tokens, pairing links, or screenshots exposing private details. Store the data directory and config with permissions appropriate for your local account.

## Local and network access

Default binding is 127.0.0.1. LAN sharing must be explicitly enabled with --lan or HOST. LAN and PUBLIC_URL modes require pairing for dashboard pages and data APIs. A random pairing key is generated on startup unless PAIRING_KEY is configured. Restart with a new key to revoke all existing sessions. Session cookies are HttpOnly, SameSite=Strict, and expire after 30 days. Configuring an HTTPS PUBLIC_URL also makes cookies Secure.

The pairing key/link is a bearer secret. Anyone with it and network access can pair. It can appear in terminal output, startup logs, QR screenshots, browser history, or a reverse proxy's query logs. Keep those private, avoid logging /pair query strings, and rotate the key if exposed. The app sets no-store and no-referrer headers and redirects to / after pairing to remove the key from the current address bar.

Plain LAN HTTP is intended for trusted private networks; it does not encrypt cookies or traffic. Use an authenticated HTTPS reverse proxy such as Tailscale Serve or Cloudflare Tunnel with Access for remote access. Do not forward the HTTP port directly to the public internet.

The Host header must match a local interface or the exact configured PUBLIC_URL host. The app does not trust forwarded headers to decide access or cookie security. POST requests with a foreign Origin are rejected. Origin checks supplement pairing; they are not authentication. The unauthenticated /healthz returns only an ok flag. No endpoint can invoke a model, renew credentials, modify provider settings, or read an arbitrary file path.

Fanout commands are explicitly configured local shell commands. Only install commands that you trust.

## Reporting issues

Use a private GitHub security advisory or contact the maintainer for security issues. Do not include credentials or private provider records in public issues.
