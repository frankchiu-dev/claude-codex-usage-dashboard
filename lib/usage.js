'use strict';
const fs = require('node:fs');
const path = require('node:path');

function resetTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const result = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}
function normalize(window, field) {
  const used = window?.[field];
  return Number.isFinite(used) && used >= 0 && used <= 100
    ? { used, resetAt: resetTime(window.resets_at) } : null;
}
function codexWindows(limits) {
  const result = { five: null, seven: null };
  const entries = [limits.primary, limits.secondary];
  const hasDuration = entries.some(w => w && (w.window_minutes != null || w.windowDurationMins != null));
  for (const window of entries) {
    const duration = Number(window?.window_minutes ?? window?.windowDurationMins);
    if (duration === 300) result.five = normalize(window, 'used_percent');
    if (duration === 10080) result.seven = normalize(window, 'used_percent');
  }
  // Legacy logs omitted durations. Never guess when explicit durations are present.
  if (!hasDuration) {
    result.five = normalize(limits.primary, 'used_percent');
    result.seven = normalize(limits.secondary, 'used_percent');
  }
  return result;
}
function blank() { return { fetchedAt: null, five: null, seven: null }; }
function readClaude(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.rate_limits) return blank();
    return { fetchedAt: resetTime(data.fetchedAt),
      five: normalize(data.rate_limits.five_hour, 'used_percentage'),
      seven: normalize(data.rate_limits.seven_day, 'used_percentage') };
  } catch { return blank(); }
}
function readCodex(root, days, now = Date.now()) {
  let newest = null;
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(now - offset * 86400000);
    const dir = path.join(root, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
    let names;
    try { names = fs.readdirSync(dir).filter(n => n.startsWith('rollout-') && n.endsWith('.jsonl')); }
    catch { continue; }
    for (const name of names) {
      let text;
      try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('token_count')) continue;
        try {
          const event = JSON.parse(line);
          const payload = event.payload;
          const timestamp = Date.parse(event.timestamp);
          if (payload?.type !== 'token_count' || !payload.rate_limits || !Number.isFinite(timestamp) || timestamp > now + 60000) continue;
          // Ignore other quota buckets that can appear alongside the normal Codex limit.
          if (payload.rate_limits.limit_id && payload.rate_limits.limit_id !== 'codex') continue;
          if (!newest || timestamp > newest.fetchedAt) newest = { fetchedAt: timestamp, ...codexWindows(payload.rate_limits) };
        } catch { /* Partially written records are retried on the next scan. */ }
      }
    }
  }
  return newest || blank();
}
function sourceStatus(source, staleMinutes, now) {
  if (!source.fetchedAt || (!source.five && !source.seven)) return 'missing';
  return now - source.fetchedAt > staleMinutes * 60000 ? 'stale' : 'available';
}
function createUsageReader(settings) {
  let codex = null, scannedAt = 0;
  return () => {
    const now = Date.now();
    if (!codex || now - scannedAt >= 8000) {
      codex = readCodex(settings.codexSessions, settings.lookbackDays, now); scannedAt = now;
    }
    const claude = readClaude(settings.claudeCache);
    const withStatus = source => ({ ...source, status: sourceStatus(source, settings.staleMinutes, now) });
    return { displayMode: settings.displayMode, capturedAt: now, claude: withStatus(claude), codex: withStatus(codex) };
  };
}
module.exports = { resetTime, codexWindows, readClaude, readCodex, createUsageReader };
