'use strict';
const crypto = require('node:crypto');

function equal(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function createAccess(settings) {
  const key = settings.pairingKey || crypto.randomBytes(24).toString('hex');
  if (settings.pairingKey && !/^[a-zA-Z0-9_-]{24,128}$/.test(key)) throw new Error('PAIRING_KEY must contain 24–128 letters, digits, underscores or hyphens.');
  const session = crypto.createHmac('sha256', key).update('dashboard-session-v1').digest('hex');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', settings.host]);
  if (settings.publicUrl) allowedHosts.add(new URL(settings.publicUrl).hostname);
  return {
    key,
    allowHost(host) { allowedHosts.add(host); },
    hostAllowed(request) {
      try { return allowedHosts.has(new URL('http://' + request.headers.host).hostname); } catch { return false; }
    },
    authorized(request) {
      if (!settings.authRequired) return true;
      const cookies = String(request.headers.cookie || '').split(';').map(s => s.trim());
      return cookies.some(cookie => cookie.startsWith('dashboard_session=') && equal(cookie.slice(18), session));
    },
    pair(value) { return equal(value, key); },
    cookie() {
      // PUBLIC_URL is explicit configuration, never inferred from untrusted proxy headers.
      return 'dashboard_session=' + session + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000' + (settings.publicUrl ? '; Secure' : '');
    },
  };
}
module.exports = { createAccess };
