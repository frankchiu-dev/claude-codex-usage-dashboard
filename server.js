'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { loadSettings } = require('./lib/settings');
const { createUsageReader } = require('./lib/usage');
const { createHistory } = require('./lib/history');
const { createAccess } = require('./lib/access');
const { connectPage, pairingPage } = require('./lib/pages');
if (process.argv.includes('--help')) {
  console.log('Usage: node server.js [--lan]\nDefault: this computer only. --lan: paired access on the same Wi-Fi.\nSee README.md for configuration and optional remote access.');
  process.exit(0);
}
const settings = loadSettings();
const HOST = settings.host, PORT = settings.port;
const ALERT_PERCENT = settings.alertPercent, DISPLAY_MODE = settings.displayMode;
const KOBO_REFRESH_SECONDS = settings.koboRefreshSeconds;
const readUsage = createUsageReader(settings);
const history = createHistory(settings);
const access = createAccess(settings);
function readClaudeUsage() { return readUsage().claude; }
function getCodexUsage() { return readUsage().codex; }
function lanAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')).map(n => n.address))];
}
for (const host of lanAddresses()) access.allowHost(host);

function getLanAddress() {
  const networks = os.networkInterfaces();
  for (const name of Object.keys(networks)) {
    for (const network of networks[name] || []) {
      if (network.family === 'IPv4' && !network.internal) {
        return network.address;
      }
    }
  }
  return 'localhost';
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function getDisplayMode(requestUrl) {
  try {
    const url = new URL(requestUrl, 'http://localhost');
    const mode = String(url.searchParams.get('mode') || '').toLowerCase();
    if (mode === 'used' || mode === 'remaining') return mode;

    const route = url.pathname.replace(/\/+$/, '').toLowerCase();
    if (route === '/u' || route === '/ku') return 'used';
    if (route === '/k' || route === '/e' || route === '/r' || route === '/kr') return 'remaining';
  } catch (error) {}
  return DISPLAY_MODE;
}

function isKoboPath(requestPath) {
  return [
    '/kobo', '/kobo/',
    '/eink', '/eink/',
    '/k', '/k/',
    '/e', '/e/',
    '/r', '/r/',
    '/u', '/u/',
    '/kr', '/kr/',
    '/ku', '/ku/',
  ].includes(requestPath);
}

function getDisplayedPercent(windowData, mode) {
  if (!windowData || typeof windowData.used !== 'number') return null;
  return mode === 'remaining'
    ? clampPercent(100 - windowData.used)
    : clampPercent(windowData.used);
}

function formatPercent(windowData, mode) {
  const value = getDisplayedPercent(windowData, mode);
  return value === null ? '--' : String(Math.round(value)) + '%';
}

function formatModeLabel(mode) {
  return mode === 'remaining' ? 'remaining' : 'used';
}

function formatAge(timestamp) {
  if (!timestamp) return 'no data';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'updated now';
  if (seconds < 3600) return 'updated ' + Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return 'updated ' + Math.floor(seconds / 3600) + 'h ago';
  return 'updated ' + Math.floor(seconds / 86400) + 'd ago';
}

function formatReset(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((timestamp - Date.now()) / 1000);
  if (seconds <= 0) return 'reset';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return 'reset ' + days + 'd ' + hours + 'h';
  if (hours > 0) return 'reset ' + hours + 'h ' + minutes + 'm';
  return 'reset ' + Math.max(0, minutes) + 'm';
}

function koboBar(windowData, mode) {
  const value = getDisplayedPercent(windowData, mode);
  const width = value === null ? 0 : Math.max(2, Math.round(value));
  return '<div class="bar"><div class="fill" style="width:' + width + '%"></div></div>';
}

function koboMetric(label, windowData, mode) {
  const alert = windowData && typeof windowData.used === 'number' && windowData.used >= ALERT_PERCENT;
  return '<tr class="' + (alert ? 'alert' : '') + '">'
    + '<th>' + label + '</th>'
    + '<td class="num">' + formatPercent(windowData, mode) + '</td>'
    + '<td class="reset">' + formatReset(windowData && windowData.resetAt) + '</td>'
    + '<td class="mark">' + (alert ? '!' : '') + '</td>'
    + '</tr><tr class="barrow"><td colspan="4">' + koboBar(windowData, mode) + '</td></tr>';
}

function koboCard(name, usage, mode) {
  return '<section class="card">'
    + '<div class="head">'
    + '<h2>' + name + '</h2>'
    + '<p>' + formatAge(usage.fetchedAt) + '</p>'
    + '</div>'
    + '<table>'
    + '<tbody>'
    + koboMetric('5 hours', usage.five, mode)
    + koboMetric('weekly', usage.seven, mode)
    + '</tbody>'
    + '</table>'
    + '</section>';
}

function koboPageHtml(requestUrl) {
  const mode = getDisplayMode(requestUrl);
  const claude = readClaudeUsage();
  const codex = getCodexUsage();
  const generatedAt = new Date().toLocaleString('en-US', { hour12: false });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="${Math.max(15, Math.round(KOBO_REFRESH_SECONDS))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Usage - KOBO</title>
<style>
html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #000;
  font-family: Georgia, "Times New Roman", serif;
}
body {
  padding: 18px 16px;
}
.top {
  border-bottom: 3px solid #000;
  margin-bottom: 18px;
  padding-bottom: 10px;
}
h1 {
  font-size: 28px;
  line-height: 1;
  margin: 0 0 8px 0;
  letter-spacing: 0;
}
.sub {
  font-size: 14px;
  line-height: 1.3;
  margin: 0;
}
.card {
  border: 2px solid #000;
  margin: 0 0 18px 0;
  padding: 12px 10px 8px 10px;
  page-break-inside: avoid;
}
.head {
  border-bottom: 1px solid #000;
  margin-bottom: 8px;
  padding-bottom: 6px;
}
h2 {
  font-size: 28px;
  line-height: 1;
  margin: 0 0 5px 0;
  text-transform: uppercase;
}
p {
  margin: 0;
}
.head p {
  font-size: 13px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  padding: 4px 0;
  vertical-align: baseline;
}
th {
  width: 36%;
  font-size: 17px;
  text-align: left;
  text-transform: uppercase;
}
.num {
  width: 30%;
  font-size: 36px;
  font-weight: bold;
  text-align: right;
}
.reset {
  width: 28%;
  font-size: 13px;
  text-align: right;
}
.mark {
  width: 6%;
  font-size: 30px;
  font-weight: bold;
  text-align: right;
}
.barrow td {
  padding: 0 0 12px 0;
}
.bar {
  width: 100%;
  height: 14px;
  border: 1px solid #000;
  background: #fff;
}
.fill {
  height: 14px;
  background: #000;
}
.alert .num,
.alert .mark {
  color: #000;
}
.footer {
  border-top: 1px solid #000;
  padding-top: 8px;
  font-size: 12px;
  line-height: 1.25;
}
@media (min-width: 760px) {
  body {
    padding: 24px;
  }
  .wrap {
    width: 720px;
    margin: 0 auto;
  }
}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>AI Usage</h1>
    <p class="sub">KOBO / e-ink mode - showing ${formatModeLabel(mode)} - refresh ${Math.max(15, Math.round(KOBO_REFRESH_SECONDS))}s</p>
  </div>
  ${koboCard('Claude', claude, mode)}
  ${koboCard('Codex', codex, mode)}
  <div class="footer">
    <p>Generated ${generatedAt}. Short URLs: <strong>/k</strong> for remaining, <strong>/u</strong> for used.</p>
    <p>Long URLs also work: <strong>/kobo?mode=remaining</strong> and <strong>/kobo?mode=used</strong>.</p>
    <p>Marked <strong>!</strong> means used percentage is at or above ${Math.round(ALERT_PERCENT)}%.</p>
  </div>
</div>
</body>
</html>`;
}

function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#EBE6D9">
<title>Claude / Codex Usage Dashboard</title>
<style>
:root {
  --bg: #EBE6D9;
  --card: #FFFFFF;
  --text: #2B2A26;
  --muted: #6B6A62;
  --faint: #A6A399;
  --track: #EAE6DC;
  --claude: #BE7457;
  --codex: #767FC6;
  --alert: #B23A2E;
}
* {
  box-sizing: border-box;
  margin: 0;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
html,
body {
  width: 100%;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: "Segoe UI", system-ui, -apple-system, "Noto Sans TC", "PingFang TC", sans-serif;
}
body {
  display: flex;
  gap: clamp(16px, 4vw, 48px);
  padding: 7vh calc(env(safe-area-inset-right) + 4.5vw) calc(env(safe-area-inset-bottom) + 2.4vh) calc(env(safe-area-inset-left) + 4.5vw);
  overflow: auto;
}
.card {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-radius: 8px;
  box-shadow: 0 4px 22px rgba(60, 52, 38, 0.10);
  padding: clamp(22px, 4vmin, 48px) clamp(24px, 5.5vmin, 60px);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 9vmin;
}
.brand {
  font-family: Inter, "Segoe UI", system-ui, sans-serif;
  font-size: clamp(30px, 5.6vmin, 68px);
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
}
.brand.claude { color: var(--claude); }
.brand.codex { color: var(--codex); }
.age {
  color: var(--faint);
  font-size: clamp(16px, 3.2vmin, 36px);
  font-weight: 500;
  white-space: nowrap;
}
.mode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  min-height: 28px;
  padding: 4px 10px;
  margin-top: 14px;
  border: 1px solid var(--track);
  border-radius: 999px;
  color: var(--muted);
  font-size: clamp(13px, 2.1vmin, 24px);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.metrics {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(24px, 4.8vh, 52px);
}
.label {
  color: var(--muted);
  font-size: clamp(22px, 5vmin, 54px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: 0;
}
.numrow {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-top: 0.8vh;
}
.big {
  font-family: Inter, "Segoe UI", system-ui, sans-serif;
  font-size: clamp(62px, 14vmin, 150px);
  font-weight: 800;
  line-height: 0.9;
  letter-spacing: 0;
  white-space: nowrap;
}
.big .percent {
  font-size: 0.42em;
  font-weight: 600;
  margin-left: 0.16em;
}
.reset {
  color: var(--faint);
  font-size: clamp(16px, 3.4vmin, 36px);
  font-weight: 500;
  line-height: 1.2;
  padding-bottom: 1.5vh;
  text-align: right;
  white-space: nowrap;
}
.bar {
  height: clamp(10px, 2vmin, 22px);
  background: var(--track);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 1.6vh;
}
.bar > i {
  display: block;
  width: 0;
  height: 100%;
  border-radius: 999px;
  transition: width 0.7s ease, background 0.7s ease;
}
@media (max-width: 720px) {
  body {
    flex-direction: column;
    min-height: 100%;
    overflow: auto;
    padding-top: calc(env(safe-area-inset-top) + 24px);
  }
  .card {
    min-height: 360px;
  }
}
.page-nav{position:absolute;top:12px;left:4.5vw;display:flex;gap:24px;font:15px system-ui}.page-nav a{color:#4c57a0}.hint{font:14px/1.5 system-ui;color:#8b472f;margin-top:10px;max-width:45ch}.age{white-space:normal;font-size:clamp(14px,2.3vmin,24px)}@media(max-width:720px){body{padding-top:58px}.page-nav{top:16px}}
</style>
</head>
<body>
  <nav class="page-nav"><a href="/details">History &amp; forecast</a><a href="/connect">Connect a device</a></nav>
  <section class="card" aria-label="Claude usage">
    <div class="head">
      <div class="brand claude">Claude</div>
      <div class="age" id="age_claude">No data</div>
    </div>
    <p class="hint" id="hint_claude" role="status"></p>
    <div class="mode">${DISPLAY_MODE === 'remaining' ? 'Remaining' : 'Used'}</div>
    <div class="metrics">
      <div class="metric">
        <div class="label">5 hours</div>
        <div class="numrow">
          <div class="big"><span id="num_claude_five">--</span><span class="percent" id="pct_claude_five"></span></div>
          <div class="reset" id="reset_claude_five"></div>
        </div>
        <div class="bar"><i id="bar_claude_five"></i></div>
      </div>
      <div class="metric">
        <div class="label">Weekly</div>
        <div class="numrow">
          <div class="big"><span id="num_claude_seven">--</span><span class="percent" id="pct_claude_seven"></span></div>
          <div class="reset" id="reset_claude_seven"></div>
        </div>
        <div class="bar"><i id="bar_claude_seven"></i></div>
      </div>
    </div>
  </section>
  <section class="card" aria-label="Codex usage">
    <div class="head">
      <div class="brand codex">Codex</div>
      <div class="age" id="age_codex">No data</div>
    </div>
    <p class="hint" id="hint_codex" role="status"></p>
    <div class="mode">${DISPLAY_MODE === 'remaining' ? 'Remaining' : 'Used'}</div>
    <div class="metrics">
      <div class="metric">
        <div class="label">5 hours</div>
        <div class="numrow">
          <div class="big"><span id="num_codex_five">--</span><span class="percent" id="pct_codex_five"></span></div>
          <div class="reset" id="reset_codex_five"></div>
        </div>
        <div class="bar"><i id="bar_codex_five"></i></div>
      </div>
      <div class="metric">
        <div class="label">Weekly</div>
        <div class="numrow">
          <div class="big"><span id="num_codex_seven">--</span><span class="percent" id="pct_codex_seven"></span></div>
          <div class="reset" id="reset_codex_seven"></div>
        </div>
        <div class="bar"><i id="bar_codex_seven"></i></div>
      </div>
    </div>
  </section>
<script>
const COLORS = {
  claude: '#BE7457',
  codex: '#767FC6',
  alert: '#B23A2E',
  faint: '#A6A399',
};
const ALERT_PERCENT = ${JSON.stringify(ALERT_PERCENT)};
const DISPLAY_MODE = ${JSON.stringify(DISPLAY_MODE)};
const $ = (id) => document.getElementById(id);

function resetText(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((timestamp - Date.now()) / 1000);
  if (seconds <= 0) return 'Reset';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return 'Reset in ' + days + 'd ' + hours + 'h';
  if (hours > 0) return 'Reset in ' + hours + 'h ' + minutes + 'm';
  return 'Reset in ' + Math.max(0, minutes) + 'm';
}

function ageText(timestamp) {
  if (!timestamp) return 'No data';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Updated now';
  if (seconds < 3600) return 'Updated ' + Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return 'Updated ' + Math.floor(seconds / 3600) + 'h ago';
  return 'Updated ' + Math.floor(seconds / 86400) + 'd ago';
}

function setMetric(prefix, data, baseColor) {
  const number = $('num_' + prefix);
  const percent = $('pct_' + prefix);
  const bar = $('bar_' + prefix);
  const reset = $('reset_' + prefix);

  if (!data || typeof data.used !== 'number') {
    number.textContent = '--';
    number.style.color = COLORS.faint;
    percent.textContent = '';
    bar.style.width = '0';
    reset.textContent = '';
    return;
  }

  const displayValue = DISPLAY_MODE === 'remaining'
    ? Math.max(0, 100 - data.used)
    : data.used;
  const color = data.used >= ALERT_PERCENT ? COLORS.alert : baseColor;
  number.textContent = String(Math.round(displayValue));
  number.style.color = color;
  percent.textContent = '%';
  percent.style.color = color;
  bar.style.width = Math.max(2, Math.min(100, displayValue)) + '%';
  bar.style.background = color;
  reset.textContent = resetText(data.resetAt);
}

async function refreshUsage() {
  try {
    const response = await fetch('/api/usage', { cache: 'no-store' });
    if (response.status === 401) { location.href = '/pair'; return; }
    if (!response.ok) throw new Error('Dashboard unavailable');
    const usage = await response.json();
    const claude = usage.claude || {};
    const codex = usage.codex || {};

    setMetric('claude_five', claude.five, COLORS.claude);
    setMetric('claude_seven', claude.seven, COLORS.claude);
    setMetric('codex_five', codex.five, COLORS.codex);
    setMetric('codex_seven', codex.seven, COLORS.codex);
    $('age_claude').textContent = ageText(claude.fetchedAt);
    $('age_codex').textContent = ageText(codex.fetchedAt);
    for (const provider of ['claude', 'codex']) {
      const source = usage[provider];
      $('hint_' + provider).textContent = source.status === 'stale' ? 'Data is old. Use ' + (provider === 'claude' ? 'Claude Code' : 'Codex') + ' to update its local records.' : source.status === 'missing' ? (provider === 'claude' ? 'Configure the Claude Code status line, then send a message. You can also use this dashboard with Codex alone.' : 'Use Codex on this computer to create usage records. You can also use this dashboard with Claude alone.') : '';
    }
  } catch (error) {
    $('age_claude').textContent = 'Offline';
    $('age_codex').textContent = 'Offline';
  }
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
  } catch (error) {}
}

refreshUsage();
setInterval(refreshUsage, 2000);
requestWakeLock();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshUsage();
    requestWakeLock();
  }
});

document.body.addEventListener('click', event => {
  if (event.target.closest('a,button,input,select')) return;
  refreshUsage();
  requestWakeLock();
  const page = document.documentElement;
  if (page.requestFullscreen && !document.fullscreenElement) {
    try {
      const pending = page.requestFullscreen();
      if (pending && pending.catch) pending.catch(() => {});
    } catch (error) {}
  }
});
</script>
</body>
</html>`;
}

const assets = new Map([
  ['/details', ['details.html', 'text/html; charset=utf-8']],
  ['/details.js', ['details.js', 'text/javascript; charset=utf-8']],
  ['/forecast.js', ['forecast.js', 'text/javascript; charset=utf-8']],
]);
function send(response, status, body, type = 'text/html; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type }); response.end(body);
}
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  if (!access.hostAllowed(request)) { send(response, 403, 'Host is not configured. Set PUBLIC_URL for a remote HTTPS origin.', 'text/plain'); return; }
  let url;
  try { url = new URL(request.url, 'http://localhost'); } catch { send(response, 400, 'Bad request', 'text/plain'); return; }
  const route = url.pathname;
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) { send(response, 405, 'Method not allowed', 'text/plain'); return; }
  if (request.method === 'POST' && request.headers.origin) {
    let same = false;
    try { same = new URL(request.headers.origin).host === request.headers.host; } catch {}
    if (!same) { send(response, 403, 'Cross-origin request rejected', 'text/plain'); return; }
  }
  if (route === '/healthz' && request.method === 'GET') { send(response, 200, '{"ok":true}', 'application/json'); return; }
  if (route === '/pair') {
    const pair = value => {
      if (!access.pair(value)) { send(response, 401, pairingPage(Boolean(value))); return; }
      response.writeHead(303, { 'Set-Cookie': access.cookie(), Location: '/' }); response.end();
    };
    if (request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; if (body.length > 1024) request.destroy(); });
      request.on('end', () => pair(new URLSearchParams(body).get('key')));
    } else if (url.searchParams.has('key')) pair(url.searchParams.get('key'));
    else send(response, 200, pairingPage());
    return;
  }
  if (!access.authorized(request)) {
    if (route.startsWith('/api/')) send(response, 401, '{"error":"pairing_required"}', 'application/json');
    else send(response, 401, pairingPage());
    return;
  }
  if (request.method === 'POST') { send(response, 405, 'Method not allowed', 'text/plain'); return; }
  if (route === '/api/usage') { send(response, 200, JSON.stringify(readUsage()), 'application/json'); return; }
  if (route === '/api/dashboard') {
    const hours = Number(url.searchParams.get('hours')) || 48;
    send(response, 200, JSON.stringify({ usage: readUsage(), history: history.snapshot(hours) }), 'application/json'); return;
  }
  if (route === '/connect') { send(response, 200, connectPage(settings, server.address().port, HOST === '0.0.0.0' || settings.loopback ? lanAddresses() : [HOST], access.key)); return; }
  if (isKoboPath(route)) { send(response, 200, koboPageHtml(request.url)); return; }
  if (assets.has(route)) {
    const [file, type] = assets.get(route); send(response, 200, fs.readFileSync(path.join(__dirname, 'public', file)), type); return;
  }
  if (route === '/') { send(response, 200, pageHtml()); return; }
  if (route === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  send(response, 404, 'Page not found', 'text/plain');
});
server.on('error', error => { console.error('Dashboard could not start: ' + error.message); process.exitCode = 1; });
server.listen(PORT, HOST, () => {
  const port = server.address().port;
  const localHost = HOST === '::1' ? '[::1]' : (HOST === '0.0.0.0' || settings.loopback ? '127.0.0.1' : HOST);
  const local = 'http://' + localHost + ':' + port;
  console.log('Claude / Codex usage dashboard');
  console.log('Mode: ' + (settings.authRequired ? 'paired access' : 'local only'));
  console.log('Local: ' + local);
  if (settings.authRequired) {
    console.log('Pair: ' + (settings.publicUrl || local) + '/pair?key=' + encodeURIComponent(access.key));
    console.log('Open the pairing link above, then choose Connect a device for a QR code. Keep this link private.');
  } else console.log('Phone/tablet: restart with node server.js --lan, then choose Connect a device.');
  console.log('KOBO: ' + (settings.publicUrl || local) + '/k');
  history.record(readUsage());
  setInterval(() => history.record(readUsage()), 60000).unref();
});
