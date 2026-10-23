'use strict';
const $ = id => document.getElementById(id);
const when = time => new Date(time).toLocaleString();
let data = null;
function draw() {
  if (!data) return;
  const svg = $('chart'); svg.replaceChildren();
  const width = Math.max(280, Math.min(960, svg.getBoundingClientRect().width));
  svg.setAttribute('viewBox', '0 0 ' + width + ' 320');
  const now = Date.now(), start = now - Number($('range').value) * 3600000;
  const x = t => 50 + (t - start) / (now - start) * (width - 66);
  const y = used => 270 - used * 2.3;
  function element(name, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text !== undefined) el.textContent = text;
    svg.appendChild(el); return el;
  }
  for (const value of [0, 25, 50, 75, 100]) {
    element('line', { x1: 50, x2: width - 16, y1: y(value), y2: y(value), stroke: '#e6e2d9' });
    element('text', { x: 42, y: y(value) + 5, 'text-anchor': 'end', fill: '#68655e', 'font-size': 14 }, value + '%');
  }
  let total = 0;
  for (const [provider, color] of [['claude', '#be7457'], ['codex', '#767fc6']]) {
    const unique = new Map();
    data.history.points.concat([data.usage]).forEach(p => {
      const s = p[provider];
      if (s?.fetchedAt >= start && s.fetchedAt <= now && Number.isFinite(s.seven?.used)) unique.set(s.fetchedAt, s);
    });
    const samples = [...unique.values()].sort((a, b) => a.fetchedAt - b.fetchedAt);
    let segment = [], previous = null;
    const flush = () => { if (segment.length > 1) element('polyline', { points: segment.join(' '), fill: 'none', stroke: color, 'stroke-width': 3 }); segment = []; };
    for (const s of samples) {
      // Do not draw through resets or long periods without source observations.
      if (previous && (s.fetchedAt - previous.fetchedAt > 3 * 3600000 || s.seven.used <= previous.seven.used - 5 || (s.seven.resetAt && previous.seven.resetAt && Math.abs(s.seven.resetAt - previous.seven.resetAt) >= 3600000))) flush();
      segment.push(x(s.fetchedAt) + ',' + y(s.seven.used));
      const dot = element('circle', { cx: x(s.fetchedAt), cy: y(s.seven.used), r: 3, fill: color });
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = provider + ': ' + s.seven.used + '% · ' + when(s.fetchedAt); dot.appendChild(title);
      previous = s; total++;
    }
    flush();
  }
  const axisTime = time => width < 480 ? new Date(time).toLocaleDateString() : when(time);
  element('text', { x: 50, y: 305, fill: '#68655e', 'font-size': 13 }, axisTime(start));
  element('text', { x: width - 16, y: 305, fill: '#68655e', 'text-anchor': 'end', 'font-size': 13 }, axisTime(now));
  $('chart-note').textContent = total ? total + ' source observations. Hover or tap a point for its value. Gaps and resets break the line.' : 'No weekly observations in this range yet. Use Claude Code or Codex while the dashboard is running.';
  const r = data.history.error ? { status: 'unavailable', reason: 'History is unavailable. The forecast is paused.' } : window.UsageForecast.estimate(data.history.points, data.usage, $('provider').value, Number($('window').value), Number($('pace').value));
  $('forecast').textContent = r.status === 'unavailable' ? 'Not enough current data' : r.status === 'exhausted' ? 'Weekly limit reached' : r.status === 'warning' ? 'Estimated to run out around ' + when(r.exhaust) : 'Estimated to last until reset';
  $('forecast-detail').textContent = r.reason || (r.rate === undefined ? 'Waiting for the next reset.' : r.rate.toFixed(2) + ' percentage points per hour, based on ' + r.count + ' observations over ' + r.span.toFixed(1) + ' hours.');
  $('budget').textContent = Number.isFinite(r.budget) ? 'Average allowance until reset: ' + r.budget.toFixed(1) + ' percentage points per day. Reset: ' + when(r.reset) + '.' : '';
}
async function refresh() {
  try {
    const response = await fetch('/api/dashboard?hours=' + Math.max(48, Number($('range').value)), { cache: 'no-store' });
    if (response.status === 401) { location.href = '/pair'; return; }
    if (!response.ok) throw new Error('Request failed');
    data = await response.json();
    const states = ['claude', 'codex'].map(p => p + ': ' + data.usage[p].status).join(' · ');
    $('status').textContent = data.history.error || (data.history.enabled ? states + ' · ' + data.history.retentionDays + ' days retained locally.' : 'History is disabled. Set HISTORY_DAYS to a number from 1 to 60 to enable it.');
    draw();
  } catch { data = null; $('status').textContent = 'Dashboard offline. Waiting to reconnect.'; $('forecast').textContent = 'Forecast paused'; $('forecast-detail').textContent = 'Current data could not be loaded.'; $('budget').textContent = ''; }
}
$('range').addEventListener('change', refresh);
for (const id of ['provider', 'window', 'pace']) $(id).addEventListener('change', draw);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('resize', draw);
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
refresh();
