'use strict';

const http = require('http');
const http2 = require('http2');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST = process.env.HOST || '0.0.0.0';

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const PORT = envNumber('PORT', 8787);
const ALERT_PERCENT = envNumber('ALERT_PERCENT', 85);
const CODEX_LOOKBACK_DAYS = envNumber('CODEX_LOOKBACK_DAYS', 14);
const KOBO_REFRESH_SECONDS = envNumber('KOBO_REFRESH_SECONDS', 60);
const ANTIGRAVITY_STALE_MINUTES = envNumber('ANTIGRAVITY_STALE_MINUTES', 120);
const DISPLAY_MODE = ['used', 'remaining'].includes(String(process.env.DISPLAY_MODE || '').toLowerCase())
  ? String(process.env.DISPLAY_MODE).toLowerCase()
  : 'used';

const CLAUDE_CACHE = process.env.CLAUDE_USAGE_CACHE
  || path.join(os.homedir(), '.claude', 'usage-cache.json');
const CODEX_SESSIONS = process.env.CODEX_SESSIONS_DIR
  || path.join(os.homedir(), '.codex', 'sessions');
const ANTIGRAVITY_LOG_DIR = process.env.ANTIGRAVITY_LOG_DIR
  || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'log');
const ANTIGRAVITY_SETTINGS = process.env.ANTIGRAVITY_SETTINGS
  || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function normalizeClaudeWindow(windowData) {
  if (!windowData || typeof windowData.used_percentage !== 'number') return null;
  return {
    used: windowData.used_percentage,
    resetAt: windowData.resets_at ? windowData.resets_at * 1000 : null,
  };
}

function normalizeCodexWindow(windowData) {
  if (!windowData || typeof windowData.used_percent !== 'number') return null;
  return {
    used: windowData.used_percent,
    resetAt: windowData.resets_at ? windowData.resets_at * 1000 : null,
  };
}

function readClaudeUsage() {
  const data = readJson(CLAUDE_CACHE);
  if (!data || !data.rate_limits) {
    return { fetchedAt: null, five: null, seven: null };
  }

  return {
    fetchedAt: data.fetchedAt || null,
    five: normalizeClaudeWindow(data.rate_limits.five_hour),
    seven: normalizeClaudeWindow(data.rate_limits.seven_day),
  };
}

function getCodexDayDirectory(date) {
  return path.join(
    CODEX_SESSIONS,
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  );
}

function readCodexUsage() {
  if (!fs.existsSync(CODEX_SESSIONS)) {
    return { fetchedAt: null, five: null, seven: null };
  }

  const now = new Date();
  let newest = null;

  for (let dayOffset = 0; dayOffset < CODEX_LOOKBACK_DAYS; dayOffset += 1) {
    const day = new Date(now.getTime() - dayOffset * 86400000);
    const dir = getCodexDayDirectory(day);
    if (!fs.existsSync(dir)) continue;

    let files = [];
    try {
      files = fs.readdirSync(dir)
        .filter((fileName) => fileName.startsWith('rollout-') && fileName.endsWith('.jsonl'));
    } catch (error) {
      continue;
    }

    for (const fileName of files) {
      const filePath = path.join(dir, fileName);
      let lines = [];
      try {
        lines = fs.readFileSync(filePath, 'utf8').split('\n');
      } catch (error) {
        continue;
      }

      for (const line of lines) {
        if (!line || !line.includes('token_count')) continue;

        let event = null;
        try {
          event = JSON.parse(line);
        } catch (error) {
          continue;
        }

        const payload = event && event.payload;
        if (!payload || payload.type !== 'token_count' || !payload.rate_limits) continue;

        const timestamp = Date.parse(event.timestamp || 0);
        if (!timestamp) continue;

        if (!newest || timestamp > newest.timestamp) {
          newest = { timestamp, rateLimits: payload.rate_limits };
        }
      }
    }
  }

  if (!newest) {
    return { fetchedAt: null, five: null, seven: null };
  }

  return {
    fetchedAt: newest.timestamp,
    five: normalizeCodexWindow(newest.rateLimits.primary),
    seven: normalizeCodexWindow(newest.rateLimits.secondary),
  };
}

let codexCache = { fetchedAt: 0, data: null };

function getCodexUsage() {
  const now = Date.now();
  if (codexCache.data && now - codexCache.fetchedAt < 8000) {
    return codexCache.data;
  }

  let data = null;
  try {
    data = readCodexUsage();
  } catch (error) {
    data = { fetchedAt: null, five: null, seven: null };
  }

  codexCache = { fetchedAt: now, data };
  return data;
}

function antigravityLineTimestamp(line, fileTimeMs) {
  const match = /^.[ ]?(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(line);
  if (!match) return null;
  const year = new Date(fileTimeMs || Date.now()).getFullYear();
  const value = new Date(
    year,
    Number(match[1]) - 1,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ).getTime();
  return Number.isFinite(value) ? value : null;
}

function antigravityTokenExpiry(line) {
  const match = /token refreshed, new expiry=(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(line);
  if (!match) return null;
  const value = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  ).getTime();
  return Number.isFinite(value) ? value : null;
}

function readProtoVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos];
    pos += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return [Number(value), pos];
}

function parseProtoFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, tagEnd] = readProtoVarint(buffer, offset);
    offset = tagEnd;
    const field = tag >> 3;
    const wire = tag & 7;
    if (!field) break;

    if (wire === 0) {
      const [value, next] = readProtoVarint(buffer, offset);
      fields.push({ field, wire, value });
      offset = next;
    } else if (wire === 1) {
      fields.push({ field, wire, value: buffer.readDoubleLE(offset) });
      offset += 8;
    } else if (wire === 2) {
      const [length, next] = readProtoVarint(buffer, offset);
      offset = next;
      const raw = buffer.subarray(offset, offset + length);
      fields.push({ field, wire, raw, text: raw.toString('utf8') });
      offset += length;
    } else if (wire === 5) {
      fields.push({ field, wire, value: buffer.readFloatLE(offset) });
      offset += 4;
    } else {
      break;
    }
  }
  return fields;
}

function parseProtoTimestamp(buffer) {
  const seconds = parseProtoFields(buffer).find((field) => field.field === 1);
  if (!seconds || typeof seconds.value !== 'number') return null;
  return seconds.value * 1000;
}

function grpcFramePayload(buffer) {
  if (!buffer || buffer.length < 5) return null;
  const length = buffer.readUInt32BE(1);
  if (buffer.length < 5 + length) return null;
  return buffer.subarray(5, 5 + length);
}

function antigravityLogState() {
  const settings = readJson(ANTIGRAVITY_SETTINGS);
  let model = settings && typeof settings.model === 'string' ? settings.model : null;
  let modelAt = 0;
  const grpcPorts = [];
  let refreshAt = null;

  if (fs.existsSync(ANTIGRAVITY_LOG_DIR)) {
    let files = [];
    try {
      files = fs.readdirSync(ANTIGRAVITY_LOG_DIR)
        .filter((fileName) => fileName.endsWith('.log'))
        .map((fileName) => {
          const filePath = path.join(ANTIGRAVITY_LOG_DIR, fileName);
          const stat = fs.statSync(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 20);
    } catch {
      files = [];
    }

    for (const file of files) {
      let lines = [];
      try {
        lines = fs.readFileSync(file.filePath, 'utf8').split('\n');
      } catch {
        continue;
      }

      for (const line of lines) {
        if (!line) continue;
        const timestamp = antigravityLineTimestamp(line, file.mtimeMs);
        if (!timestamp) continue;

        const portMatch = /Language server listening on .* port at (\d+) for HTTPS \(gRPC\)/.exec(line);
        if (portMatch) {
          grpcPorts.push({ port: Number(portMatch[1]), timestamp });
        }

        if (/quotaRefreshLoop: starting reload /.test(line) && (!refreshAt || timestamp > refreshAt)) {
          refreshAt = timestamp;
        }

        const modelMatch = /Propagating selected model override to backend: label="([^"]+)"/.exec(line);
        if (modelMatch && timestamp > modelAt) {
          model = modelMatch[1];
          modelAt = timestamp;
        }
      }
    }
  }

  const seen = new Set();
  const ports = grpcPorts
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((item) => {
      if (seen.has(item.port)) return false;
      seen.add(item.port);
      return true;
    })
    .slice(0, 8);

  return {
    model,
    grpcPorts: ports,
    grpcPort: ports.length ? ports[0].port : null,
    grpcPortAt: ports.length ? ports[0].timestamp : 0,
    refreshAt,
  };
}

function callAntigravityQuota(port) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('Antigravity quota request timed out'));
    }, 5000);

    client.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    const request = client.request({
      ':method': 'POST',
      ':path': '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
      'content-type': 'application/grpc',
      te: 'trailers',
    });
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', (error) => {
      clearTimeout(timer);
      client.close();
      reject(error);
    });
    request.on('end', () => {
      clearTimeout(timer);
      client.close();
      const payload = grpcFramePayload(Buffer.concat(chunks));
      if (!payload) {
        reject(new Error('Antigravity quota response was empty'));
        return;
      }
      resolve(payload);
    });

    request.end(Buffer.from([0, 0, 0, 0, 0]));
  });
}

function parseAntigravityBucket(raw) {
  const fields = parseProtoFields(raw);
  const text = (field) => {
    const match = fields.find((item) => item.field === field && item.wire === 2);
    return match ? match.text : null;
  };
  const remainingField = fields.find((item) => item.field === 4 && item.wire === 5);
  const resetField = fields.find((item) => item.field === 6 && item.wire === 2);
  const remaining = remainingField && Number.isFinite(remainingField.value)
    ? remainingField.value
    : null;

  return {
    id: text(1),
    label: text(2),
    window: text(3),
    remaining,
    used: remaining === null ? null : Math.max(0, Math.min(100, (1 - remaining) * 100)),
    resetAt: resetField ? parseProtoTimestamp(resetField.raw) : null,
  };
}

function parseAntigravityQuotaPayload(payload) {
  const wrapper = parseProtoFields(payload).find((field) => field.field === 1 && field.wire === 2);
  const response = wrapper ? wrapper.raw : payload;
  const fields = parseProtoFields(response);
  const groups = fields
    .filter((field) => field.field === 2 && field.wire === 2)
    .map((field) => {
      const groupFields = parseProtoFields(field.raw);
      const buckets = groupFields
        .filter((item) => item.field === 1 && item.wire === 2)
        .map((item) => parseAntigravityBucket(item.raw));
      const labelField = groupFields.find((item) => item.field === 2 && item.wire === 2);
      const label = labelField ? labelField.text : 'Antigravity';
      const five = buckets.find((bucket) => bucket.window === '5h' || /-5h$/.test(bucket.id || '')) || null;
      const weekly = buckets.find((bucket) => bucket.window === 'weekly' || /weekly/.test(bucket.id || '')) || null;
      return { label, buckets, five, seven: weekly };
    });

  return groups;
}

function chooseAntigravityGroup(groups, model) {
  if (!groups.length) return null;
  if (/claude|gpt|opus|sonnet|3p/i.test(model || '')) {
    return groups.find((group) => /claude|gpt|3p/i.test(group.label)) || groups[0];
  }
  if (/gemini/i.test(model || '')) {
    return groups.find((group) => /gemini/i.test(group.label)) || groups[0];
  }
  return groups[0];
}

async function readAntigravityUsage() {
  const state = antigravityLogState();
  const staleAfterMs = ANTIGRAVITY_STALE_MINUTES * 60000;
  if (!state.grpcPorts || !state.grpcPorts.length) {
    return {
      fetchedAt: state.refreshAt || null,
      five: null,
      seven: null,
      groups: [],
      model: state.model,
      activeLabel: null,
      source: 'antigravity-grpc',
      stale: true,
      staleAfterMs,
      error: 'Antigravity CLI gRPC port not found',
    };
  }

  let payload = null;
  let lastError = null;
  for (const candidate of state.grpcPorts) {
    try {
      payload = await callAntigravityQuota(candidate.port);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!payload) {
    throw lastError || new Error('Antigravity quota gRPC request failed');
  }
  const groups = parseAntigravityQuotaPayload(payload);
  const active = chooseAntigravityGroup(groups, state.model);
  const other = groups.find((group) => group !== active) || null;

  return {
    fetchedAt: Date.now(),
    five: active ? active.five : null,
    seven: active ? active.seven : null,
    groups,
    model: state.model,
    activeLabel: active ? active.label : null,
    other: other ? { label: other.label, five: other.five, seven: other.seven } : null,
    source: 'antigravity-grpc',
    stale: false,
    staleAfterMs,
  };
}

let antigravityCache = { fetchedAt: 0, data: null, promise: null };

async function getAntigravityUsage() {
  const now = Date.now();
  if (antigravityCache.data && now - antigravityCache.fetchedAt < 15000) {
    return antigravityCache.data;
  }
  if (antigravityCache.promise) return antigravityCache.promise;

  antigravityCache.promise = readAntigravityUsage()
    .catch((error) => ({
      fetchedAt: null,
      five: null,
      seven: null,
      groups: [],
      model: null,
      activeLabel: null,
      other: null,
      source: 'antigravity-grpc',
      stale: true,
      staleAfterMs: ANTIGRAVITY_STALE_MINUTES * 60000,
      error: error.message,
    }))
    .then((data) => {
      antigravityCache = { fetchedAt: Date.now(), data, promise: null };
      return data;
    });
  return antigravityCache.promise;
}


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

function desktopPageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#0e1013">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<title>Usage Watch</title>
<style>
:root {
  --watch-w: 356px;
  --watch-h: 416px;
  --ink: #f5f2ea;
  --muted: #a6a094;
  --quiet: #6e706e;
  --metal: #17191b;
  --metal-2: #0e1012;
  --rim: rgba(245, 242, 234, 0.16);
  --track: rgba(245, 242, 234, 0.09);
  --claude: #f2ad63;
  --codex: #63d4c7;
  --antigravity: #b9d86f;
  --alert: #f06e5d;
  --shadow: 0 22px 50px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.11);
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  min-height: 100%;
  margin: 0;
}

body {
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 12%, rgba(242, 173, 99, 0.16), transparent 28%),
    radial-gradient(circle at 12% 86%, rgba(99, 212, 199, 0.12), transparent 28%),
    #0f1114;
  color: var(--ink);
  font-family: "Outfit", "Segoe UI", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.22;
  background-image:
    linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 12px 12px;
  mask-image: radial-gradient(circle at center, black, transparent 72%);
}

.watch {
  position: relative;
  width: min(var(--watch-w), calc(100vw - 12px));
  min-height: min(var(--watch-h), calc(100vh - 12px));
  padding: 15px;
  border-radius: 42px;
  overflow: hidden;
  background:
    linear-gradient(155deg, rgba(255,255,255,0.11), rgba(255,255,255,0.025) 32%, rgba(255,255,255,0.075) 100%),
    radial-gradient(circle at 50% 0%, rgba(255,255,255,0.12), transparent 35%),
    linear-gradient(180deg, var(--metal), var(--metal-2));
  border: 1px solid var(--rim);
  box-shadow: var(--shadow);
  touch-action: none;
  -webkit-app-region: no-drag;
  animation: rise 260ms ease-out both;
  opacity: 0.96;
}

.watch::after {
  content: "";
  position: absolute;
  inset: 9px;
  border-radius: 34px;
  pointer-events: none;
  border: 1px solid rgba(255,255,255,0.07);
  box-shadow: inset 0 0 24px rgba(0,0,0,0.38);
}

@keyframes rise {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.topbar,
.readouts,
.status,
button {
  -webkit-app-region: no-drag;
}

.topbar {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
}

.mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 13px;
  background: rgba(255,255,255,0.075);
  border: 1px solid rgba(255,255,255,0.09);
  color: var(--ink);
  font-weight: 800;
  font-size: 13px;
}

.title {
  min-width: 0;
}

.title strong {
  display: block;
  font-size: 15px;
  line-height: 1.05;
  font-weight: 700;
  letter-spacing: 0;
}

.title span,
.status {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 13px;
  background: rgba(255,255,255,0.07);
  color: var(--ink);
  cursor: pointer;
  transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
}

.icon-btn:hover {
  background: rgba(255,255,255,0.12);
  border-color: rgba(242, 173, 99, 0.38);
}

.icon-btn:active {
  transform: translateY(1px) scale(0.97);
}

.readouts {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;
}

.readout {
  min-width: 0;
  min-height: 176px;
  padding: 14px;
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 0%, rgba(255,255,255,0.095), transparent 58%),
    rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.075);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}

.readout.antigravity-card {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 0.88fr 1.12fr;
  gap: 12px;
  min-height: 92px;
}

.readout.antigravity-card .readout-head {
  margin-bottom: 0;
}

.readout.antigravity-card strong {
  font-size: 32px;
}

.readout.antigravity-card .detail {
  align-content: center;
  gap: 10px;
}

.readout.antigravity-card .detail-row {
  font-size: 11px;
  letter-spacing: 0.02em;
}

.readout.antigravity-card .detail-row:first-child {
  font-size: 12px;
}

.readout.antigravity-card .detail-row span:last-child {
  font-size: 12px;
}

.readout.antigravity-card .detail-row .metric-pair {
  color: var(--ink);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.readout-head {
  display: grid;
  gap: 10px;
  margin-bottom: 13px;
}

.service {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 10px currentColor;
}

.readout strong {
  color: var(--ink);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 42px;
  line-height: 1;
}

.readout small {
  color: var(--quiet);
  font-size: 15px;
}

.detail {
  display: grid;
  gap: 9px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.32;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.detail-row:first-child {
  font-size: 15px;
  line-height: 1.18;
  font-weight: 700;
}

.detail-row span:last-child {
  color: #cec8bc;
  text-align: right;
  font-weight: 600;
}

.detail-row:first-child span:last-child {
  color: var(--ink);
}

.detail-row:first-child b {
  font-size: 1.08em;
}

.status {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 2px 0;
  font-size: 11px;
}

.claude {
  color: var(--claude);
}

.codex {
  color: var(--codex);
}

.antigravity {
  color: var(--antigravity);
}

html.desktop-shell,
body.desktop-shell {
  background: transparent;
}

body.desktop-shell::before {
  display: none;
}

body.desktop-shell {
  display: block;
}

body.desktop-shell .watch {
  width: calc(100vw - 8px);
  min-height: calc(100vh - 8px);
  margin: 4px;
}

@media (max-width: 370px), (max-height: 410px) {
  :root {
    --watch-w: 332px;
    --watch-h: 296px;
  }

  .watch {
    padding: 13px;
    border-radius: 36px;
  }

  .readout {
    min-height: 170px;
    padding: 13px;
  }

  .readout.antigravity-card {
    min-height: 92px;
  }

  .readout strong {
    font-size: 38px;
  }

  .detail {
    font-size: 12.5px;
  }
}
</style>
</head>
<body>
  <main class="watch" aria-label="Claude and Codex usage watch face">
    <header class="topbar">
      <div class="mark">CC</div>
      <div class="title">
        <strong>Usage cockpit</strong>
        <span>Claude / Codex</span>
      </div>
      <button class="icon-btn" id="refreshBtn" type="button" title="Refresh" aria-label="Refresh">↻</button>
    </header>

    <section class="readouts">
      <article class="readout" aria-label="Claude usage">
        <div class="readout-head">
          <span class="service claude"><i class="dot"></i>Claude</span>
          <strong><span id="num_claude_five">--</span><small>%</small></strong>
        </div>
        <div class="detail">
          <div class="detail-row"><span>7d</span><span><b id="num_claude_seven">--</b>%</span></div>
          <div class="detail-row"><span>reset</span><span id="reset_claude_five">no data</span></div>
          <div class="detail-row"><span>age</span><span id="age_claude">no data</span></div>
        </div>
      </article>

      <article class="readout" aria-label="Codex usage">
        <div class="readout-head">
          <span class="service codex"><i class="dot"></i>Codex</span>
          <strong><span id="num_codex_five">--</span><small>%</small></strong>
        </div>
        <div class="detail">
          <div class="detail-row"><span>7d</span><span><b id="num_codex_seven">--</b>%</span></div>
          <div class="detail-row"><span>reset</span><span id="reset_codex_five">no data</span></div>
          <div class="detail-row"><span>age</span><span id="age_codex">no data</span></div>
        </div>
      </article>

      <article class="readout antigravity-card" aria-label="Antigravity quota refresh">
        <div class="readout-head">
          <span class="service antigravity"><i class="dot"></i>Antigravity</span>
          <strong><span id="num_antigravity_age">--</span><small id="unit_antigravity_age"></small></strong>
        </div>
        <div class="detail">
          <div class="detail-row"><span>group</span><span id="model_antigravity">unknown</span></div>
          <div class="detail-row"><span>other</span><span id="auth_antigravity">unknown</span></div>
        </div>
      </article>
    </section>

    <footer class="status">
      <span id="global_status">syncing</span>
      <span>right click for menu</span>
    </footer>
  </main>

<script>
const COLORS = {
  claude: '#f2ad63',
  codex: '#63d4c7',
  antigravity: '#b9d86f',
  alert: '#f06e5d',
  muted: '#8d877c',
};
const ALERT_PERCENT = ${JSON.stringify(ALERT_PERCENT)};
const params = new URLSearchParams(window.location.search);
const isDesktopShell = params.get('mode') === 'desktop' || /\\bElectron\\//.test(navigator.userAgent);
if (isDesktopShell) {
  document.documentElement.classList.add('desktop-shell');
  document.body.classList.add('desktop-shell');
}
const $ = (id) => document.getElementById(id);

function percentValue(data) {
  return data && typeof data.used === 'number' ? Math.round(data.used) : null;
}

function resetText(timestamp) {
  if (!timestamp) return 'no data';
  const seconds = Math.floor((timestamp - Date.now()) / 1000);
  if (seconds <= 0) return 'reset';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return days + 'd ' + hours + 'h';
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  return Math.max(0, minutes) + 'm';
}

function ageText(timestamp) {
  if (!timestamp) return 'no data';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}

function compactAgeParts(timestamp) {
  if (!timestamp) return { value: '--', unit: '' };
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return { value: 'now', unit: '' };
  if (seconds < 3600) return { value: String(Math.floor(seconds / 60)), unit: 'm' };
  if (seconds < 86400) return { value: String(Math.floor(seconds / 3600)), unit: 'h' };
  return { value: String(Math.floor(seconds / 86400)), unit: 'd' };
}

function shortTime(timestamp) {
  if (!timestamp) return 'no data';
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceAgeText(timestamp, stale) {
  const age = ageText(timestamp);
  if (stale && timestamp) return 'stale ' + age;
  return age;
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setService(name, data) {
  const five = percentValue(data && data.five);
  const seven = percentValue(data && data.seven);
  setText('num_' + name + '_five', five === null ? '--' : String(five));
  setText('num_' + name + '_seven', seven === null ? '--' : String(seven));
  setText('reset_' + name + '_five', resetText(data && data.five && data.five.resetAt));
  setText('age_' + name, sourceAgeText(data && data.fetchedAt, data && data.stale));
  return five;
}

function setAntigravity(data) {
  const five = percentValue(data && data.five);
  const seven = percentValue(data && data.seven);
  const otherFive = percentValue(data && data.other && data.other.five);
  const otherSeven = percentValue(data && data.other && data.other.seven);
  setText('num_antigravity_age', five === null && seven === null ? '--' : (five === null ? '--' : String(five)) + '%/' + (seven === null ? '--' : String(seven)));
  setText('unit_antigravity_age', five === null && seven === null ? '' : '%');
  setText('model_antigravity', data && data.activeLabel ? data.activeLabel : (data && data.model ? data.model : 'unknown'));
  const otherEl = $('auth_antigravity');
  if (!otherEl) return;
  if (data && data.other) {
    otherEl.innerHTML = '';
    otherEl.append(document.createTextNode(data.other.label + ' '));
    const metric = document.createElement('b');
    metric.className = 'metric-pair';
    metric.textContent = (otherFive === null ? '--' : String(otherFive)) + '/' + (otherSeven === null ? '--' : String(otherSeven)) + '%';
    otherEl.append(metric);
  } else {
    otherEl.textContent = data && data.error ? data.error : 'no data';
  }
}

function setOffline() {
  setService('claude', {});
  setService('codex', {});
  setAntigravity({});
  setText('global_status', 'disconnected');
}

function installDesktopDrag() {
  if (!isDesktopShell || !window.desktopHud) return;
  const watch = document.querySelector('.watch');
  if (!watch) return;
  let dragging = false;
  let pointerId = null;

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    window.desktopHud.endDrag();
  };

  watch.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    dragging = true;
    pointerId = event.pointerId;
    watch.setPointerCapture(pointerId);
    window.desktopHud.beginDrag(event.screenX, event.screenY);
    event.preventDefault();
  });

  watch.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    window.desktopHud.dragTo(event.screenX, event.screenY);
  });

  watch.addEventListener('pointerup', stop);
  watch.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
}

async function refreshUsage() {
  try {
    const response = await fetch('/api/usage', { cache: 'no-store' });
    const usage = await response.json();
    setService('claude', usage.claude || {});
    setService('codex', usage.codex || {});
    setAntigravity(usage.antigravity || {});
    setText('global_status', 'updated ' + new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }));
  } catch (error) {
    setOffline();
  }
}

function init() {
  installDesktopDrag();
  $('refreshBtn').addEventListener('click', refreshUsage);
  refreshUsage();
  setInterval(refreshUsage, 2000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshUsage();
});

init();
</script>
</body>
</html>`;
}


function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#EBE6D9">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=swap" rel="stylesheet">
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
  overflow: hidden;
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
</style>
</head>
<body>
  <section class="card" aria-label="Claude usage">
    <div class="head">
      <div class="brand claude">Claude</div>
      <div class="age" id="age_claude">No data</div>
    </div>
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
    const usage = await response.json();
    const claude = usage.claude || {};
    const codex = usage.codex || {};

    setMetric('claude_five', claude.five, COLORS.claude);
    setMetric('claude_seven', claude.seven, COLORS.claude);
    setMetric('codex_five', codex.five, COLORS.codex);
    setMetric('codex_seven', codex.seven, COLORS.codex);
    $('age_claude').textContent = ageText(claude.fetchedAt);
    $('age_codex').textContent = ageText(codex.fetchedAt);
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

document.body.addEventListener('click', () => {
  refreshUsage();
  requestWakeLock();
  const page = document.documentElement;
  if (page.requestFullscreen && !document.fullscreenElement) {
    try {
      page.requestFullscreen();
    } catch (error) {}
  }
});
</script>
</body>
</html>`;
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  const requestPath = requestUrl.pathname;

  if (isKoboPath(requestPath)) {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(koboPageHtml(request.url || '/'));
    return;
  }

  if (requestPath === '/api/usage') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({
      displayMode: DISPLAY_MODE,
      claude: readClaudeUsage(),
      codex: getCodexUsage(),
      antigravity: await getAntigravityUsage(),
    }));
    return;
  }

  if (requestPath === '/desktop') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(desktopPageHtml());
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(pageHtml());
});

server.listen(PORT, HOST, () => {
  const visibleHost = HOST === '0.0.0.0' ? getLanAddress() : HOST;
  console.log('Claude / Codex usage dashboard');
  console.log('Local:   http://localhost:' + PORT);
  console.log('Device:  http://' + visibleHost + ':' + PORT);
  console.log('Desktop: http://localhost:' + PORT + '/desktop');
  console.log('KOBO:    http://' + visibleHost + ':' + PORT + '/k');
});
