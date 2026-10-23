(function () {
  'use strict';
  const HOUR = 3600000;
  function estimate(points, usage, provider, hours, pace, now = Date.now()) {
    const sample = point => {
      const s = point?.[provider], w = s?.seven;
      if (!Number.isFinite(w?.used) || w.used < 0 || w.used > 100 || !Number.isFinite(s.fetchedAt) || s.fetchedAt <= 0 || s.fetchedAt > now + 60000) return null;
      return { t: s.fetchedAt, used: w.used, reset: w.resetAt };
    };
    const unavailable = reason => ({ status: 'unavailable', reason });
    const current = sample(usage);
    if (!current) return unavailable('No valid weekly usage is available for this provider.');
    if (now - current.t > 2 * HOUR) return unavailable('The provider data is over two hours old. Use Claude Code or Codex to update its local records.');
    if (!Number.isFinite(current.reset) || current.reset <= now) return unavailable('Waiting for a valid next reset time.');
    const remaining = 100 - current.used, untilReset = (current.reset - now) / HOUR;
    const base = { remaining, untilReset, budget: remaining / untilReset * 24, reset: current.reset };
    if (!remaining) return { ...base, status: 'exhausted' };
    const unique = new Map();
    (points || []).concat([usage]).forEach(p => { const s = sample(p); if (s && s.t <= current.t) unique.set(s.t, s); });
    const ordered = [...unique.values()].sort((a, b) => a.t - b.t);
    let start = 0;
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i];
      if (b.used <= a.used - 5 || (Number.isFinite(a.reset) && Number.isFinite(b.reset) && Math.abs(b.reset - a.reset) >= HOUR)) start = i;
    }
    const recent = ordered.slice(start).filter(s => s.t >= now - hours * HOUR);
    const span = recent.length > 1 ? (current.t - recent[0].t) / HOUR : 0;
    const required = Math.round(Math.min(6, hours * 0.6) * 10) / 10;
    if (recent.length < 3 || span < required) return { ...base, ...unavailable('At least three distinct observations spanning ' + required + ' hours in the current period are needed.') };
    const gap = recent.reduce((max, s, i) => i ? Math.max(max, (s.t - recent[i - 1].t) / HOUR) : max, 0);
    if (gap > Math.max(3, hours / 2)) return { ...base, ...unavailable('The history has a long gap. More recent observations are needed.') };
    const rate = Math.max(0, current.used - recent[0].used) / span * pace;
    const exhaust = rate > 0 ? now + remaining / rate * HOUR : null;
    return { ...base, status: rate * untilReset > remaining ? 'warning' : 'ok', rate, exhaust, span, count: recent.length };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { estimate };
  else window.UsageForecast = { estimate };
}());
