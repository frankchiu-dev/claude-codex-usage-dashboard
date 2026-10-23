# Changelog

## 0.5.0

- Default localhost startup; explicit paired LAN mode with locally generated QR codes.
- Configurable paths and deployment settings, with optional Tailscale Serve and Cloudflare Access instructions.
- Codex quota windows classified by duration, including weekly-only accounts.
- Local compact usage history, stale/missing-source guidance, and weekly pace forecasts.
- Local browser assets; no runtime npm installation or external QR service.
- Existing KOBO/e-ink routes and Claude-HUD fanout behavior retained.

Migration: Wi-Fi users enable --lan or HOST=0.0.0.0 and pair their browser. Remote proxies configure PUBLIC_URL. Credential renewal and model calls are not part of this release.
