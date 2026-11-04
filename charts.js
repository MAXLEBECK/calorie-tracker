// Tiny SVG charts (no library). Colors come from CSS classes in styles.css.
import { parseKey, addDays } from './stats.js?v=5';

const NS = 'http://www.w3.org/2000/svg';
const W = 340, H = 180, PAD = { l: 40, r: 10, t: 12, b: 24 };

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}
function text(parent, x, y, str, attrs = {}) {
  const t = el('text', { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}
function svgRoot(host, label) {
  host.replaceChildren();
  return el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label }, host);
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function shortDate(key) {
  const d = parseKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtNum(v) { return Math.round(v).toLocaleString(); }

/** Daily bars with a dashed goal line.
 *  bars: [{ date, value, cls }]  cls: 'hit' | 'miss' | 'none' */
export function barChart(host, { bars, goal, label }) {
  const svg = svgRoot(host, label);
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const step = niceStep(Math.max(goal || 0, ...bars.map(b => b.value), 1) * 1.1 / 4);
  const max = step * 4;
  const y = v => PAD.t + ih - (v / max) * ih;

  for (let i = 0; i <= 4; i++) {
    const v = step * i;
    el('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: 'grid' }, svg);
    text(svg, PAD.l - 6, y(v) + 4, fmtNum(v), { class: 'axis', 'text-anchor': 'end' });
  }

  const slot = iw / bars.length;
  const bw = Math.max(2, slot * 0.68);
  const every = bars.length <= 7 ? 1 : Math.ceil(bars.length / 6);
  bars.forEach((b, i) => {
    const x = PAD.l + i * slot + (slot - bw) / 2;
    if (b.value > 0) {
      const r = el('rect', { x, y: y(b.value), width: bw, height: Math.max(1, y(0) - y(b.value)), rx: Math.min(3, bw / 2), class: `cbar ${b.cls}` }, svg);
      el('title', {}, r).textContent = `${shortDate(b.date)}: ${fmtNum(b.value)} cal`;
    }
    if ((bars.length - 1 - i) % every === 0) {
      text(svg, x + bw / 2, H - 6, bars.length <= 7 ? parseKey(b.date).toLocaleDateString(undefined, { weekday: 'narrow' }) : shortDate(b.date),
        { class: 'axis', 'text-anchor': 'middle' });
    }
  });

  if (goal) {
    el('line', { x1: PAD.l, x2: W - PAD.r, y1: y(goal), y2: y(goal), class: 'goal-line' }, svg);
    text(svg, W - PAD.r, y(goal) - 4, 'Goal', { class: 'axis goal-label', 'text-anchor': 'end' });
  }
}

/** Weight line over a date range, with optional faint calorie bars behind it.
 *  points: [{ date, weight }]  overlay: [{ date, value }] */
export function lineChart(host, { points, start, end, overlay, label }) {
  const svg = svgRoot(host, label);
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const span = Math.max(1, (parseKey(end) - parseKey(start)) / 864e5);
  const x = key => PAD.l + ((parseKey(key) - parseKey(start)) / 864e5 / span) * iw;

  // calorie overlay on its own 0..max scale
  if (overlay?.length) {
    const cmax = Math.max(...overlay.map(o => o.value), 1) * 1.1;
    const bw = Math.max(1.5, (iw / (span + 1)) * 0.6);
    for (const o of overlay) {
      if (o.value <= 0) continue;
      const h = (o.value / cmax) * ih;
      el('rect', { x: x(o.date) - bw / 2, y: PAD.t + ih - h, width: bw, height: h, class: 'overlay' }, svg);
    }
  }

  const ws = points.map(p => p.weight);
  let lo = Math.min(...ws), hi = Math.max(...ws);
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; }
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const y = v => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

  for (let v = lo; v <= hi + 1e-9; v += step) {
    el('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: 'grid' }, svg);
    text(svg, PAD.l - 6, y(v) + 4, Number.isInteger(step) ? String(v) : v.toFixed(1), { class: 'axis', 'text-anchor': 'end' });
  }

  // x labels: start, middle, end
  for (const key of [start, addDays(start, Math.round(span / 2)), end]) {
    text(svg, x(key), H - 6, shortDate(key), { class: 'axis', 'text-anchor': 'middle' });
  }

  if (points.length > 1) {
    el('polyline', { points: points.map(p => `${x(p.date)},${y(p.weight)}`).join(' '), class: 'line' }, svg);
  }
  for (const p of points) {
    const c = el('circle', { cx: x(p.date), cy: y(p.weight), r: points.length > 40 ? 2 : 3.5, class: 'dot' }, svg);
    el('title', {}, c).textContent = `${shortDate(p.date)}: ${p.weight} lb`;
  }
}
