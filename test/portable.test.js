'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { loadSettings } = require('../lib/settings');
const { codexWindows, readClaude, readCodex } = require('../lib/usage');
const { createHistory } = require('../lib/history');
const { estimate } = require('../public/forecast');
const { createAccess } = require('../lib/access');
const root = path.resolve(__dirname, '..');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-portable-'));
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings = { PORT: 0, HOST: '127.0.0.1', CLAUDE_USAGE_CACHE: path.join(dir, 'claude.json'), CODEX_SESSIONS_DIR: path.join(dir, 'sessions'), DATA_DIR: path.join(dir, 'data') };
  const config = path.join(dir, 'config.json');
  const save = changes => fs.writeFileSync(config, JSON.stringify({ ...settings, ...changes }));
  save({});
  return { dir, settings, config, save };
}
async function start(t, f, args = []) {
  const env = { ...process.env, DASHBOARD_CONFIG: f.config };
  for (const key of ['HOST', 'PORT', 'PUBLIC_URL', 'PAIRING_KEY', 'CLAUDE_USAGE_CACHE', 'CODEX_SESSIONS_DIR', 'DATA_DIR', 'HISTORY_DAYS']) delete env[key];
  const child = spawn(process.execPath, [path.join(root, 'server.js'), ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', b => { errors += b; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped;
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out: ' + errors)), 8000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code + ': ' + errors)); });
    child.stdout.on('data', b => { output += b; if (output.includes('KOBO:')) { clearTimeout(timer); resolve(); } });
  });
  return { base: output.match(/Local: (http:\/\/[^\s]+)/)[1], pair: output.match(/Pair: (http[^\s]+)/)?.[1] };
}
test('local defaults, LAN opt-in and environment precedence are explicit', t => {
  const f = fixture(t);
  const s = loadSettings({ DASHBOARD_CONFIG: f.config }, [], f.dir);
  assert.equal(s.host, '127.0.0.1'); assert.equal(s.authRequired, false);
  assert.equal(loadSettings({ DASHBOARD_CONFIG: f.config }, ['--lan'], f.dir).authRequired, true);
  assert.equal(loadSettings({ DASHBOARD_CONFIG: f.config, PORT: '9010' }, [], f.dir).port, 9010);
  assert.throws(() => loadSettings({ DASHBOARD_CONFIG: f.config, PUBLIC_URL: 'http://bad.test' }, [], f.dir));
});
test('Codex weekly primary, reversed windows, legacy logs and unknown durations', () => {
  const weekly = { used_percent: 4, window_minutes: 10080, resets_at: 1793293782 };
  assert.deepEqual(codexWindows({ primary: weekly }), { five: null, seven: { used: 4, resetAt: 1793293782000 } });
  assert.equal(codexWindows({ primary: weekly, secondary: { used_percent: 9, window_minutes: 300 } }).five.used, 9);
  assert.equal(codexWindows({ primary: { used_percent: 11 } }).five.used, 11);
  assert.deepEqual(codexWindows({ primary: { used_percent: 3, window_minutes: 1440 } }), { five: null, seven: null });
  assert.equal(codexWindows({ primary: { used_percent: 101, window_minutes: 300 } }).five, null);
});
test('persistent pairing keys survive restarts, rotate to revoke, and HTTPS sets Secure cookies', () => {
  const settings = { host: '127.0.0.1', authRequired: true, pairingKey: 'test-persistent-key-0123456789', publicUrl: 'https://dashboard.example.com' };
  const first = createAccess(settings), restarted = createAccess(settings);
  const request = { headers: { host: 'dashboard.example.com', cookie: first.cookie().split(';')[0] } };
  assert.equal(restarted.authorized(request), true); assert.match(first.cookie(), /; Secure$/);
  assert.equal(createAccess({ ...settings, pairingKey: 'replacement-pairing-key-0123456789' }).authorized(request), false);
  assert.equal(first.hostAllowed(request), true);
  assert.equal(first.hostAllowed({ headers: { host: 'evil.example.com' } }), false);
  assert.throws(() => createAccess({ ...settings, pairingKey: 'weak' }));
});
test('real cache and session readers handle missing providers, ISO resets and partial records', t => {
  const f = fixture(t), now = Date.now();
  assert.equal(readClaude(f.settings.CLAUDE_USAGE_CACHE).five, null);
  fs.writeFileSync(f.settings.CLAUDE_USAGE_CACHE, JSON.stringify({ fetchedAt: now, rate_limits: { five_hour: { used_percentage: 0, resets_at: '2026-10-25T00:00:00Z' } } }));
  assert.equal(readClaude(f.settings.CLAUDE_USAGE_CACHE).five.used, 0);
  assert.equal(readClaude(f.settings.CLAUDE_USAGE_CACHE).five.resetAt, Date.parse('2026-10-25T00:00:00Z'));
  const day = new Date(now), dir = path.join(f.settings.CODEX_SESSIONS_DIR, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const event = limits => JSON.stringify({ timestamp: new Date(now).toISOString(), payload: { type: 'token_count', rate_limits: limits } });
  fs.writeFileSync(path.join(dir, 'rollout-test.jsonl'), event({ primary: { used_percent: 7, window_minutes: 10080 } }) + '\n{"partial":\n' + event({ limit_id: 'other', primary: { used_percent: 90, window_minutes: 300 } }));
  const usage = readCodex(f.settings.CODEX_SESSIONS_DIR, 1, now);
  assert.equal(usage.seven.used, 7); assert.equal(usage.five, null);
});
test('history persists only compact observations, deduplicates cache and can be disabled', t => {
  const f = fixture(t), settings = { dataDir: f.settings.DATA_DIR, historyDays: 30 };
  const store = createHistory(settings), now = Date.now();
  const source = { fetchedAt: now, five: null, seven: { used: 12, resetAt: now + 86400000 }, rawPrompt: 'PRIVATE' };
  const usage = { capturedAt: now, claude: source, codex: { fetchedAt: null, five: null, seven: null } };
  store.record(usage); store.record({ ...usage, capturedAt: now + 1000 });
  assert.equal(store.snapshot().points.length, 1);
  assert.equal(createHistory(settings).snapshot().points.length, 1);
  assert.equal(fs.readFileSync(path.join(settings.dataDir, 'history.jsonl'), 'utf8').includes('PRIVATE'), false);
  const disabledDir = path.join(f.dir, 'disabled');
  createHistory({ dataDir: disabledDir, historyDays: 0 }).record(usage);
  assert.equal(fs.existsSync(disabledDir), false);
});
test('forecast uses distinct source timestamps, current period and enough coverage', () => {
  const now = Date.now(), H = 3600000, reset = now + 24 * H;
  const point = (hours, used, resetAt = reset) => ({ codex: { fetchedAt: now - hours * H, seven: { used, resetAt } } });
  const current = point(0, 30);
  assert.equal(estimate([point(8, 10), point(4, 20)], current, 'codex', 24, 1, now).status, 'ok');
  assert.equal(estimate([point(8, 10), point(4, 20)], current, 'codex', 24, 1.5, now).status, 'warning');
  assert.equal(estimate([current, current, current], current, 'codex', 24, 1, now).status, 'unavailable');
  assert.equal(estimate([point(8, 80, reset - 7 * 24 * H), point(4, 90, reset - 7 * 24 * H)], current, 'codex', 24, 1, now).status, 'unavailable');
  assert.equal(estimate([], point(3, 20), 'codex', 24, 1, now).status, 'unavailable');
});
test('local server works without either provider, Cloudflare or network calls', async t => {
  const f = fixture(t), app = await start(t, f);
  assert.equal(app.pair, undefined);
  const usage = await (await fetch(app.base + '/api/usage')).json();
  assert.equal(usage.claude.status, 'missing'); assert.equal(usage.codex.status, 'missing');
  const overview = await (await fetch(app.base)).text();
  assert.match(overview, /History &amp; forecast/); assert.doesNotMatch(overview, /fonts\.google/);
  assert.match(await (await fetch(app.base + '/connect')).text(), /node server.js --lan/);
  assert.equal((await fetch(app.base + '/details')).status, 200);
  assert.equal((await fetch(app.base + '/k')).status, 200);
  assert.equal((await fetch(app.base + '/missing')).status, 404);
});
test('LAN requires pairing for pages and APIs, generates local QR and rejects foreign origins', async t => {
  const f = fixture(t), app = await start(t, f, ['--lan']);
  assert.ok(app.pair);
  assert.equal((await fetch(app.base + '/api/usage')).status, 401);
  assert.equal((await fetch(app.base + '/api/dashboard')).status, 401);
  assert.equal((await fetch(app.base + '/k')).status, 401);
  assert.equal((await fetch(app.base + '/connect')).status, 401);
  const wrong = await fetch(app.base + '/pair?key=wrong', { redirect: 'manual' }); assert.equal(wrong.status, 401);
  const paired = await fetch(app.pair, { redirect: 'manual' });
  assert.equal(paired.status, 303); assert.equal(paired.headers.get('location'), '/');
  const cookie = paired.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.equal((await fetch(app.base + '/api/usage', { headers })).status, 200);
  const connect = await (await fetch(app.base + '/connect', { headers })).text();
  assert.match(connect, /<svg/); assert.match(connect, /\/pair\?key=/); assert.doesNotMatch(connect, /api\.qrserver|https:\/\/.*qrcode/);
  assert.equal((await fetch(app.base + '/pair', { method: 'POST', headers: { Origin: 'https://foreign.example' }, body: 'key=wrong' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(app.base + '/api/usage', { headers: { ...headers, Host: 'foreign.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(app.base + '/healthz')).status, 200);
});
