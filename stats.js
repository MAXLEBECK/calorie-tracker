// Pure helpers: dates, totals, goal checks and streaks. No storage access here.

export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];

export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function entryTotals(e) {
  const t = {};
  for (const k of MACRO_KEYS) t[k] = e.per[k] * e.servings;
  return t;
}
export function sumTotals(entries) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    const et = entryTotals(e);
    for (const k of MACRO_KEYS) t[k] += et[k];
  }
  return t;
}

// Goals that applied on a given date (goal changes don't rewrite the past).
export function goalsFor(date, history) {
  let match = null;
  for (const g of history) {
    if (g.effectiveDate <= date && (!match || g.effectiveDate >= match.effectiveDate)) match = g;
  }
  return match || history[0] || null;
}

// Streak rule: calories within ±tolerance of goal AND protein at or above goal.
export function hitGoals(totals, goals) {
  if (!goals || !goals.calories) return false;
  const tol = (goals.tolerancePct ?? 10) / 100;
  const calOk = totals.calories >= goals.calories * (1 - tol) && totals.calories <= goals.calories * (1 + tol);
  const proteinOk = totals.protein >= goals.protein;
  return calOk && proteinOk;
}

// Build { date: { totals, hit, count } } for every day that has entries.
export function summarizeDays(entries, goalsHistory) {
  const byDate = {};
  for (const e of entries) (byDate[e.date] ||= []).push(e);
  const days = {};
  for (const [date, list] of Object.entries(byDate)) {
    const totals = sumTotals(list);
    days[date] = { totals, count: list.length, hit: hitGoals(totals, goalsFor(date, goalsHistory)) };
  }
  return days;
}

// Current streak: consecutive hit days ending yesterday, plus today once it's hit.
// An unfinished today never breaks the streak.
export function currentStreak(days, today) {
  let n = 0;
  let d = addDays(today, -1);
  while (days[d]?.hit) { n++; d = addDays(d, -1); }
  if (days[today]?.hit) n++;
  return n;
}

export function bestStreak(days) {
  const hits = Object.keys(days).filter(d => days[d].hit).sort();
  let best = 0, run = 0, prev = null;
  for (const d of hits) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
