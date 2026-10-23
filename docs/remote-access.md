# Optional remote access

The dashboard works on localhost and Wi-Fi without any cloud account. These instructions are for viewing it away from the source computer. In every mode, that computer must stay awake with the dashboard running. The services below do not collect quota records on its behalf.

Use the exact public HTTPS origin in PUBLIC_URL. It enables Host validation, paired access, Secure cookies, and a QR code for that origin. Keep HOST=127.0.0.1 when the proxy runs on the same machine. Pair through the HTTPS link printed in the terminal; a Secure pairing cookie cannot be set using plain localhost HTTP.

## Tailscale Serve: private devices

1. Install Tailscale on the source computer and viewing phone/tablet. Sign in and confirm both belong to the intended private Tailscale network.
2. Start the dashboard locally with node server.js.
3. In another terminal on that computer, run:

```bash
tailscale serve --bg http://127.0.0.1:8787
```

Follow the Tailscale prompts for HTTPS and required permissions. Serve prints an HTTPS address such as https://computer.example-tailnet.ts.net.

4. Add that exact origin to the existing dashboard config.json and restart the dashboard:

```json
{
  "HOST": "127.0.0.1",
  "PUBLIC_URL": "https://computer.example-tailnet.ts.net"
}
```

Merge these fields; preserve other settings. Use your actual hostname. Add a persistent PAIRING_KEY if you want browser sessions to survive restarts.

5. While connected to Tailscale, open the private HTTPS Pair link printed by the dashboard. The Connect a device page provides the remote pairing QR code.

Serve is limited to the private Tailscale network and its access rules. Tailscale Funnel is a separate public exposure feature and is not needed for this setup.

Official instructions: https://tailscale.com/docs/features/tailscale-serve

## Cloudflare Tunnel with Access: browser through your domain

1. Follow Cloudflare's official setup for your account, domain, and cloudflared installation. Create a tunnel route from your chosen hostname to http://127.0.0.1:8787.
2. Protect the hostname with a Cloudflare Access self-hosted application and restrict it to the intended users before using it remotely.
3. Merge the hostname into the existing dashboard config.json:

```json
{
  "HOST": "127.0.0.1",
  "PUBLIC_URL": "https://usage.example.com"
}
```

4. Restart the dashboard, sign in through Access, then open its HTTPS Pair link. Cloudflare Access controls who reaches the app; the dashboard pairing key controls access to its usage pages.

Keep tunnel tokens, Access policies, and account-specific configuration outside the repository. Do not disable Access to work around a login problem. Avoid recording the /pair query string in proxy logs. No Cloudflare API token is needed by the dashboard.

Official setup: https://developers.cloudflare.com/tunnel/get-started/

Access applications: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/

## Troubleshooting

- Host is not configured: use the exact origin in PUBLIC_URL and restart; do not allow arbitrary Host headers.
- Pairing repeatedly returns to the login form: use the configured HTTPS address, enable browser cookies, and use the latest pairing key.
- The source computer is asleep: wake it and restart the dashboard if necessary; quota collection cannot continue while it is off.
- The service is reachable but numbers are old: use Claude Code or Codex on the source computer. Remote viewing does not renew provider credentials or create activity.
- A phone cannot run Tailscale: use an appropriately protected browser-based reverse proxy, or stay on the same trusted Wi-Fi in LAN mode.
