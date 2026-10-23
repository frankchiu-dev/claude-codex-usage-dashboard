'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadSettings(env = process.env, argv = process.argv.slice(2), home = os.homedir()) {
  const configFile = env.DASHBOARD_CONFIG || path.join(__dirname, '..', 'config.json');
  let file = {};
  try { file = JSON.parse(fs.readFileSync(configFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read dashboard config: ' + error.message); }
  const read = (key, fallback) => env[key] ?? file[key] ?? fallback;
  const number = (key, fallback, min, max) => {
    const value = Number(read(key, fallback));
    if (!Number.isFinite(value) || value < min || value > max) throw new Error('Invalid ' + key);
    return value;
  };
  const resolve = value => path.resolve(String(value).replace(/^~(?=$|[\\/])/, home));
  const host = argv.includes('--lan') ? '0.0.0.0' : read('HOST', '127.0.0.1');
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(host);
  let publicUrl = String(read('PUBLIC_URL', '')).replace(/\/$/, '');
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('PUBLIC_URL must be an HTTPS origin, for example https://device.example.com');
    }
    publicUrl = url.origin;
  }
  return {
    host, loopback, port: number('PORT', 8787, 0, 65535),
    alertPercent: number('ALERT_PERCENT', 85, 0, 100),
    lookbackDays: number('CODEX_LOOKBACK_DAYS', 14, 1, 90),
    koboRefreshSeconds: number('KOBO_REFRESH_SECONDS', 60, 15, 3600),
    staleMinutes: number('STALE_MINUTES', 120, 1, 10080),
    historyDays: number('HISTORY_DAYS', 30, 0, 60),
    dataDir: resolve(read('DATA_DIR', path.join(home, '.claude-codex-usage-dashboard'))),
    claudeCache: resolve(read('CLAUDE_USAGE_CACHE', path.join(home, '.claude', 'usage-cache.json'))),
    codexSessions: resolve(read('CODEX_SESSIONS_DIR', path.join(home, '.codex', 'sessions'))),
    displayMode: read('DISPLAY_MODE', 'used') === 'remaining' ? 'remaining' : 'used',
    authRequired: !loopback || Boolean(publicUrl), publicUrl,
    // Omit this setting to rotate the pairing key on each restart.
    pairingKey: String(read('PAIRING_KEY', '')),
  };
}
module.exports = { loadSettings };
