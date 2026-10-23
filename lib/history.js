'use strict';
const fs = require('node:fs');
const path = require('node:path');

function compact(usage) {
  const source = value => ({ fetchedAt: value.fetchedAt, five: value.five, seven: value.seven });
  return { capturedAt: usage.capturedAt, claude: source(usage.claude), codex: source(usage.codex) };
}
function identity(point) { return JSON.stringify([point.claude, point.codex]); }
function createHistory(settings) {
  const file = path.join(settings.dataDir, 'history.jsonl');
  let points = [], error = null, lastCompact = 0;
  const enabled = settings.historyDays > 0;
  if (enabled) {
    try {
      const cutoff = Date.now() - settings.historyDays * 86400000;
      points = fs.readFileSync(file, 'utf8').split('\n').flatMap(line => {
        try {
          const point = JSON.parse(line);
          return point.capturedAt >= cutoff && point.claude && point.codex ? [compact(point)] : [];
        } catch { return []; }
      }).slice(-90000);
    } catch (e) { if (e.code !== 'ENOENT') error = 'History could not be read (' + e.code + ').'; }
  }
  return {
    record(usage) {
      if (!enabled) return;
      const point = compact(usage);
      if (!point.claude.fetchedAt && !point.codex.fetchedAt) return;
      const previous = points[points.length - 1];
      if (previous && identity(previous) === identity(point)) return;
      const cutoff = Date.now() - settings.historyDays * 86400000;
      try {
        fs.mkdirSync(settings.dataDir, { recursive: true, mode: 0o700 });
        fs.appendFileSync(file, JSON.stringify(point) + '\n', { mode: 0o600 });
        points.push(point);
        if (Date.now() - lastCompact > 3600000) {
          points = points.filter(p => p.capturedAt >= cutoff).slice(-90000);
          const temp = file + '.' + process.pid + '.tmp';
          fs.writeFileSync(temp, points.map(p => JSON.stringify(p)).join('\n') + '\n', { mode: 0o600 });
          fs.renameSync(temp, file); lastCompact = Date.now();
        }
        error = null;
      } catch (e) { error = 'History could not be saved (' + e.code + ').'; }
    },
    snapshot(hours = 48) {
      const cutoff = Date.now() - Math.min(settings.historyDays * 24, Math.max(1, hours)) * 3600000;
      return { enabled, retentionDays: settings.historyDays, error, points: enabled ? points.filter(p => p.capturedAt >= cutoff) : [] };
    },
  };
}
module.exports = { createHistory };
