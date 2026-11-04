import * as db from './db.js';

const MACROS = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
];

const $ = sel => document.querySelector(sel);
const goalsDialog = $('#goalsDialog');
const goalsForm = $('#goalsForm');
const foodDialog = $('#foodDialog');
const foodForm = $('#foodForm');

let today = dateKey(new Date());
let editingEntry = null; // entry being edited, or null when adding

// ---------- helpers ----------
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function fmt(key, v) {
  return key === 'calories' ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString();
}
function entryTotals(e) {
  const t = {};
  for (const { key } of MACROS) t[key] = e.per[key] * e.servings;
  return t;
}
function sumTotals(entries) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    const et = entryTotals(e);
    for (const k in t) t[k] += et[k];
  }
  return t;
}
// under / hit / over relative to goal. Protein only needs to reach the goal.
function status(key, eaten, goal, tolerancePct) {
  if (!goal) return 'under';
  const pct = (eaten / goal) * 100;
  if (key === 'protein') return pct >= 100 ? 'hit' : 'under';
  if (pct < 100 - tolerancePct) return 'under';
  if (pct > 100 + tolerancePct) return 'over';
  return 'hit';
}

// ---------- render ----------
async function render() {
  today = dateKey(new Date());
  $('#dateLabel').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const [goals, entries] = await Promise.all([db.getGoalsForDate(today), db.getEntries(today)]);
  renderBars(goals, sumTotals(entries));
  renderEntries(entries);
}

function renderBars(goals, totals) {
  const wrap = $('#bars');
  wrap.replaceChildren();
  for (const m of MACROS) {
    const goal = goals ? goals[m.key] : 0;
    const eaten = totals[m.key];
    const pct = goal ? Math.min(100, (eaten / goal) * 100) : 0;
    const st = status(m.key, eaten, goal, goals?.tolerancePct ?? 10);
    const left = goal - eaten;

    const row = document.createElement('div');
    row.className = `bar-row ${st}`;
    row.innerHTML = `
      <div class="bar-label">
        <span class="name"></span>
        <span class="nums"><strong></strong> / <span class="goal"></span></span>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">
        <div class="fill"></div>
      </div>
      <div class="bar-sub muted"></div>`;
    row.querySelector('.name').textContent = m.label;
    row.querySelector('strong').textContent = fmt(m.key, eaten) + m.unit;
    row.querySelector('.goal').textContent = fmt(m.key, goal) + m.unit;
    row.querySelector('.bar').setAttribute('aria-valuenow', Math.round(pct));
    row.querySelector('.bar').setAttribute('aria-label', m.label);
    row.querySelector('.fill').style.width = pct + '%';
    row.querySelector('.bar-sub').textContent = left >= 0
      ? `${fmt(m.key, left)}${m.unit} left`
      : `${fmt(m.key, -left)}${m.unit} over`;
    wrap.append(row);
  }
}

function renderEntries(entries) {
  const list = $('#entries');
  list.replaceChildren();
  $('#emptyState').hidden = entries.length > 0;
  $('#entryCount').textContent = entries.length ? `${entries.length} item${entries.length > 1 ? 's' : ''}` : '';

  for (const e of entries) {
    const t = entryTotals(e);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'entry';
    btn.innerHTML = `
      <div class="entry-main"><span class="entry-name"></span><span class="entry-cal"></span></div>
      <div class="entry-sub muted"></div>`;
    btn.querySelector('.entry-name').textContent = e.name;
    btn.querySelector('.entry-cal').textContent = `${fmt('calories', t.calories)} cal`;
    const serving = e.servings !== 1 || e.serving
      ? `${fmt('protein', e.servings)} × ${e.serving || 'serving'} · `
      : '';
    btn.querySelector('.entry-sub').textContent =
      `${serving}P ${fmt('protein', t.protein)}g · C ${fmt('carbs', t.carbs)}g · F ${fmt('fat', t.fat)}g`;
    btn.addEventListener('click', () => openFood(e));
    li.append(btn);
    list.append(li);
  }
}

// ---------- goals ----------
async function openGoals(firstRun = false) {
  const g = await db.getGoalsForDate(today);
  for (const { key } of MACROS) goalsForm.elements[key].value = g ? g[key] : '';
  $('#goalsIntro').hidden = !firstRun;
  goalsForm.querySelector('[data-close]').hidden = firstRun;
  goalsDialog.showModal();
}

goalsForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = goalsForm.elements;
  await db.saveGoals({
    calories: num(f.calories.value),
    protein: num(f.protein.value),
    carbs: num(f.carbs.value),
    fat: num(f.fat.value),
  }, today);
  goalsDialog.close();
  render();
});
// Don't let the first-run goals dialog be dismissed with Escape.
goalsDialog.addEventListener('cancel', ev => {
  if (goalsForm.querySelector('[data-close]').hidden) ev.preventDefault();
});

// ---------- add / edit food ----------
function openFood(entry = null) {
  editingEntry = entry;
  foodForm.reset();
  const f = foodForm.elements;
  if (entry) {
    f.name.value = entry.name;
    f.serving.value = entry.serving || '';
    for (const { key } of MACROS) f[key].value = entry.per[key];
    f.servings.value = entry.servings;
  }
  $('#foodTitle').textContent = entry ? 'Edit entry' : 'Add food';
  $('#foodSubmit').textContent = entry ? 'Save' : 'Log it';
  $('#deleteEntryBtn').hidden = !entry;
  $('#saveFoodRow').hidden = !!entry;
  updateFoodTotal();
  foodDialog.showModal();
  if (!entry) f.name.focus();
}

function updateFoodTotal() {
  const f = foodForm.elements;
  const s = num(f.servings.value);
  $('#foodTotal').textContent =
    `Total: ${fmt('calories', num(f.calories.value) * s)} cal · ` +
    `P ${fmt('protein', num(f.protein.value) * s)}g · ` +
    `C ${fmt('carbs', num(f.carbs.value) * s)}g · ` +
    `F ${fmt('fat', num(f.fat.value) * s)}g`;
}
foodForm.addEventListener('input', updateFoodTotal);

foodForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = foodForm.elements;
  const per = {};
  for (const { key } of MACROS) per[key] = num(f[key].value);
  const base = {
    name: f.name.value.trim(),
    serving: f.serving.value.trim(),
    per,
    servings: num(f.servings.value) || 1,
  };

  if (editingEntry) {
    await db.updateEntry({ ...editingEntry, ...base });
  } else {
    let foodId = null;
    if (f.saveFood.checked) {
      foodId = await db.addFood({ name: base.name, serving: base.serving, per, source: 'custom' });
    }
    await db.addEntry({ ...base, foodId, date: today });
  }
  foodDialog.close();
  render();
});

$('#deleteEntryBtn').addEventListener('click', async () => {
  const btn = $('#deleteEntryBtn');
  // two-tap confirm (no native confirm() popups in home-screen apps)
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Tap again to delete';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Delete'; }, 3000);
    return;
  }
  btn.dataset.armed = '';
  btn.textContent = 'Delete';
  await db.deleteEntry(editingEntry.id);
  foodDialog.close();
  render();
});

// ---------- wiring ----------
document.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => b.closest('dialog').close()));
$('#addBtn').addEventListener('click', () => openFood());
$('#settingsBtn').addEventListener('click', () => openGoals());

// Roll over to a new day if the app is reopened after midnight.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && dateKey(new Date()) !== today) render();
});

(async function init() {
  db.requestPersistence();
  await render();
  if (!(await db.getGoalsForDate(today))) openGoals(true);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
