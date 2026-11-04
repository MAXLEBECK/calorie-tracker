// Bump ?v= here, in index.html, and VERSION in sw.js on every release.
import * as db from './db.js?v=4';
import {
  MACRO_KEYS, dateKey, parseKey, addDays, entryTotals, sumTotals,
  goalsFor, summarizeDays, currentStreak, bestStreak,
} from './stats.js?v=4';

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

const state = {
  today: dateKey(new Date()),
  viewDate: dateKey(new Date()),
  tab: 'day',
  calMonth: firstOfMonth(new Date()),
  entries: [],        // all log entries
  goalsHistory: [],
  days: {},           // per-day summary { totals, hit, count }
  editingEntry: null, // entry being edited
  pickedFood: null,   // saved food chosen from My foods
  prefilled: false,   // form was filled from My foods / Dining
  panel: 'manual',    // visible Add food panel
  diningHall: storedHall(),
  diningMeal: null,
};

// ---------- dining menus (published nightly to data/menus/YYYY-MM-DD.json) ----------
const menuCache = new Map();
async function loadMenu(date) {
  if (menuCache.has(date)) return menuCache.get(date);
  let data = null;
  try {
    const r = await fetch(`data/menus/${date}.json`);
    if (r.ok) data = await r.json();
  } catch {}
  if (data) menuCache.set(date, data); // don't remember misses, so a retry can succeed
  return data;
}
function storedHall() { try { return localStorage.getItem('fuel.hall'); } catch { return null; } }
function storeHall(id) { try { localStorage.setItem('fuel.hall', id); } catch {} }
function defaultMealId(hall) {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const want = h < 10.5 ? 'breakfast' : h < 16 ? 'lunch' : 'dinner';
  const byWord = w => hall.meals.find(m => m.name.toLowerCase().includes(w));
  return (byWord(want) || byWord('lunch') || hall.meals[0]).id;
}

// ---------- helpers ----------
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function fmt(key, v) {
  return key === 'calories' ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString();
}
function macroLine(per, servings = 1) {
  return `${fmt('calories', per.calories * servings)} cal · P ${fmt('protein', per.protein * servings)}g · ` +
    `C ${fmt('carbs', per.carbs * servings)}g · F ${fmt('fat', per.fat * servings)}g`;
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
// Two-tap confirm (no native confirm() popups in home-screen apps).
function twoTap(btn, label, action) {
  btn.addEventListener('click', async () => {
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to confirm';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = label; }, 3000);
      return;
    }
    btn.dataset.armed = '';
    btn.textContent = label;
    await action();
  });
}
function resetTwoTap(btn, label) { btn.dataset.armed = ''; btn.textContent = label; }

// ---------- render ----------
async function render() {
  state.today = dateKey(new Date());
  [state.entries, state.goalsHistory] = await Promise.all([db.getAllEntries(), db.getGoalsHistory()]);
  state.days = summarizeDays(state.entries, state.goalsHistory);

  const streak = currentStreak(state.days, state.today);
  const pill = $('#streakPill');
  pill.hidden = streak === 0;
  pill.textContent = `🔥 ${streak}`;
  pill.setAttribute('aria-label', `${streak} day streak`);

  $('#dayView').hidden = state.tab !== 'day';
  $('#historyView').hidden = state.tab !== 'history';
  $('#addBtn').hidden = state.tab !== 'day';
  document.querySelectorAll('.tabbar button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === state.tab));

  if (state.tab === 'day') renderDay(); else renderHistory(streak);
}

function renderDay() {
  const { viewDate, today } = state;
  const d = parseKey(viewDate);
  $('#title').textContent = viewDate === today ? 'Today'
    : viewDate === addDays(today, -1) ? 'Yesterday'
    : d.toLocaleDateString(undefined, { weekday: 'long' });
  $('#dateLabel').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#nextDay').disabled = viewDate >= today;
  $('#jumpToday').hidden = viewDate === today;

  const entries = state.entries.filter(e => e.date === viewDate).sort((a, b) => a.timestamp - b.timestamp);
  const goals = goalsFor(viewDate, state.goalsHistory);
  const totals = sumTotals(entries);
  const hit = state.days[viewDate]?.hit;

  const st = $('#dayStatus');
  if (hit) {
    st.hidden = false; st.className = 'day-status hit';
    st.textContent = viewDate === today ? '✅ Goals hit today, so it counts toward your streak' : '✅ Goals hit';
  } else if (viewDate !== today && entries.length) {
    st.hidden = false; st.className = 'day-status miss';
    st.textContent = 'Goals missed this day';
  } else {
    st.hidden = true;
  }

  renderBars(goals, totals);
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

function renderHistory(streak) {
  const { calMonth, days, today } = state;
  $('#title').textContent = 'History';
  $('#dateLabel').textContent = 'Your streak and past days';
  $('#monthLabel').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#nextMonth').disabled = calMonth >= firstOfMonth(new Date());

  const grid = $('#calendar');
  grid.replaceChildren();
  for (let i = 0; i < calMonth.getDay(); i++) grid.append(document.createElement('span'));

  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  let monthHits = 0;
  for (let n = 1; n <= daysInMonth; n++) {
    const key = dateKey(new Date(calMonth.getFullYear(), calMonth.getMonth(), n));
    const info = days[key];
    const cell = document.createElement('button');
    cell.className = 'cal-day';
    cell.textContent = n;
    if (info?.hit) { cell.classList.add('hit'); monthHits++; }
    else if (info && key !== today) cell.classList.add('miss'); // today isn't over yet
    if (key === today) cell.classList.add('today');
    if (key > today) { cell.disabled = true; cell.classList.add('future'); }
    cell.setAttribute('aria-label', key + (info?.hit ? ', goals hit' : info ? ', missed' : ''));
    cell.addEventListener('click', () => { state.viewDate = key; state.tab = 'day'; render(); });
    grid.append(cell);
  }

  $('#statCurrent').textContent = streak;
  $('#statBest').textContent = bestStreak(days);
  $('#statMonth').textContent = monthHits;
}

// ---------- goals ----------
function openGoals(firstRun = false) {
  const g = goalsFor(state.today, state.goalsHistory);
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
  }, state.today);
  goalsDialog.close();
  render();
});
goalsDialog.addEventListener('cancel', ev => {
  if (goalsForm.querySelector('[data-close]').hidden) ev.preventDefault();
});

// ---------- add / edit food ----------
function showPanel(name) {
  state.panel = name;
  $('#diningPanel').hidden = name !== 'dining';
  $('#pickPanel').hidden = name !== 'pick';
  foodForm.hidden = name !== 'manual';
  document.querySelectorAll('#foodTabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.panel === name));
}

function fillForm({ name = '', serving = '', per = null, servings = 1 } = {}) {
  foodForm.reset();
  const f = foodForm.elements;
  f.name.value = name;
  f.serving.value = serving || '';
  if (per) for (const k of MACRO_KEYS) f[k].value = per[k];
  f.servings.value = servings;
  updateFoodTotal();
}

function setFormMode({ editing = false, fromSaved = false } = {}) {
  $('#foodTitle').textContent = editing ? 'Edit entry' : 'Add food';
  $('#foodTabs').hidden = editing;
  $('#foodSubmit').textContent = editing ? 'Save' : 'Log it';
  $('#deleteEntryBtn').hidden = !editing;
  $('#forgetFoodBtn').hidden = editing || !fromSaved;
  $('#saveFoodRow').hidden = editing || fromSaved;
  $('#foodNote').hidden = true;
  resetTwoTap($('#deleteEntryBtn'), 'Delete');
  resetTwoTap($('#forgetFoodBtn'), 'Remove from my foods');
}

async function openFood(entry = null) {
  state.editingEntry = entry;
  state.pickedFood = null;
  state.prefilled = false;
  if (entry) {
    fillForm(entry);
    setFormMode({ editing: true });
    showPanel('manual');
    foodDialog.showModal();
    return;
  }
  fillForm();
  setFormMode();
  $('#foodSearch').value = '';
  $('#diningSearch').value = '';
  const [menu, foods] = await Promise.all([loadMenu(state.viewDate), db.getAllFoods()]);
  const hasHistory = state.entries.length > 0 || foods.length > 0;
  await Promise.all([renderPickList(), renderDining()]);
  showPanel(menu?.halls?.length ? 'dining' : hasHistory ? 'pick' : 'manual');
  foodDialog.showModal();
}

function segButtons(container, options, activeId, onPick) {
  container.replaceChildren();
  for (const [id, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.classList.toggle('active', id === activeId);
    b.addEventListener('click', () => onPick(id));
    container.append(b);
  }
}

function emptyMsg(text) {
  const p = document.createElement('p');
  p.className = 'muted empty';
  p.textContent = text;
  return p;
}

async function renderDining() {
  const menu = await loadMenu(state.viewDate);
  const list = $('#diningList');
  list.replaceChildren();
  const controls = [$('#hallSeg'), $('#mealSeg'), $('#diningSearch')];

  if (!menu?.halls?.length) {
    controls.forEach(c => { c.hidden = true; });
    list.append(emptyMsg(navigator.onLine === false
      ? 'You’re offline and this day’s menu isn’t saved on your phone yet.'
      : 'No dining hall menu is available for this day.'));
    return;
  }
  controls.forEach(c => { c.hidden = false; });

  const hall = menu.halls.find(h => h.id === state.diningHall) || menu.halls[0];
  state.diningHall = hall.id;
  if (!hall.meals.some(m => m.id === state.diningMeal)) state.diningMeal = defaultMealId(hall);
  const meal = hall.meals.find(m => m.id === state.diningMeal);

  segButtons($('#hallSeg'), menu.halls.map(h => [h.id, h.name.replace(/^Traditions at /, '')]), hall.id, id => {
    state.diningHall = id; storeHall(id); state.diningMeal = null; renderDining();
  });
  segButtons($('#mealSeg'), hall.meals.map(m => [m.id, m.name]), meal.id, id => {
    state.diningMeal = id; renderDining();
  });

  const q = $('#diningSearch').value.trim().toLowerCase();
  let shown = 0;
  for (const st of meal.stations) {
    const items = q ? st.items.filter(i => i.name.toLowerCase().includes(q)) : st.items;
    if (!items.length) continue;
    shown += items.length;
    const det = document.createElement('details');
    det.className = 'station';
    det.open = !!q;
    const sum = document.createElement('summary');
    sum.innerHTML = '<span class="station-name"></span><span class="muted"></span>';
    sum.children[0].textContent = st.name;
    sum.children[1].textContent = items.length;
    const ul = document.createElement('ul');
    ul.className = 'pick-items';
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'pick-row';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-main';
      b.innerHTML = '<span class="entry-name"></span><span class="entry-sub muted"></span>';
      b.children[0].textContent = item.name;
      b.children[1].textContent = (item.serving ? item.serving + ' · ' : '') +
        (item.per ? macroLine(item.per) : 'No nutrition info listed');
      b.addEventListener('click', () => pickDining(item));
      li.append(b);
      ul.append(li);
    }
    det.append(sum, ul);
    list.append(det);
  }
  if (!shown) list.append(emptyMsg('No matches on this menu.'));
}

function pickDining(item) {
  state.pickedFood = null;
  fillForm({ name: item.name, serving: item.serving, per: item.per, servings: 1 });
  setFormMode();
  state.prefilled = true;
  foodForm.elements.saveFood.checked = false; // dining items show up in Recent anyway
  if (!item.per) {
    const note = $('#foodNote');
    note.textContent = 'The dining site doesn’t list nutrition for this item. Enter it if you know it.';
    note.hidden = false;
  }
  showPanel('manual');
}

// Recent: unique foods from your log, newest first.
function recentItems(foodsById) {
  const seen = new Set();
  const out = [];
  const sorted = [...state.entries].sort((a, b) => b.timestamp - a.timestamp);
  for (const e of sorted) {
    const key = `${e.name.toLowerCase()}|${e.serving || ''}|${e.per.calories}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const food = e.foodId != null ? foodsById.get(e.foodId) : null;
    out.push(food || { id: null, name: e.name, serving: e.serving, per: e.per });
    if (out.length >= 15) break;
  }
  return out;
}

async function renderPickList() {
  const foods = await db.getAllFoods();
  const foodsById = new Map(foods.map(f => [f.id, f]));
  const q = $('#foodSearch').value.trim().toLowerCase();
  const list = $('#pickList');
  list.replaceChildren();

  const sections = [];
  if (q) {
    const recent = recentItems(foodsById).filter(r => r.id == null);
    const matches = [...foods, ...recent]
      .filter(f => f.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    sections.push(['Results', matches]);
  } else {
    const favorites = foods.filter(f => f.favorite).sort((a, b) => a.name.localeCompare(b.name));
    const recent = recentItems(foodsById);
    const shown = new Set([...favorites, ...recent].map(f => f.id).filter(id => id != null));
    sections.push(['Favorites', favorites]);
    sections.push(['Recent', recent]);
    sections.push(['All my foods', foods.filter(f => !shown.has(f.id)).sort((a, b) => a.name.localeCompare(b.name))]);
  }

  let any = false;
  for (const [title, items] of sections) {
    if (!items.length) continue;
    any = true;
    const h = document.createElement('h3');
    h.className = 'pick-head';
    h.textContent = title;
    list.append(h);
    const ul = document.createElement('ul');
    ul.className = 'pick-items';
    for (const item of items) ul.append(pickRow(item));
    list.append(ul);
  }
  if (!any) {
    const p = document.createElement('p');
    p.className = 'muted empty';
    p.textContent = q ? 'No matches. Try the Manual tab.' : 'Foods you log will show up here.';
    list.append(p);
  }
}

function pickRow(item) {
  const li = document.createElement('li');
  li.className = 'pick-row';
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'pick-main';
  main.innerHTML = '<span class="entry-name"></span><span class="entry-sub muted"></span>';
  main.querySelector('.entry-name').textContent = item.name;
  main.querySelector('.entry-sub').textContent = (item.serving ? item.serving + ' · ' : '') + macroLine(item.per);
  main.addEventListener('click', () => pickFood(item));

  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'star' + (item.favorite ? ' on' : '');
  star.textContent = item.favorite ? '★' : '☆';
  star.setAttribute('aria-label', item.favorite ? 'Remove favorite' : 'Add favorite');
  star.addEventListener('click', async () => {
    if (item.id == null) {
      const id = await db.findOrAddFood({ name: item.name, serving: item.serving, per: item.per, source: 'custom' });
      const food = await db.getFood(id);
      await db.updateFood({ ...food, favorite: true });
    } else {
      await db.updateFood({ ...item, favorite: !item.favorite });
    }
    renderPickList();
  });

  li.append(main, star);
  return li;
}

function pickFood(item) {
  state.pickedFood = item.id != null ? item : null;
  fillForm({ name: item.name, serving: item.serving, per: item.per, servings: 1 });
  setFormMode({ fromSaved: item.id != null });
  state.prefilled = true;
  showPanel('manual');
}

function updateFoodTotal() {
  const f = foodForm.elements;
  const per = {};
  for (const k of MACRO_KEYS) per[k] = num(f[k].value);
  $('#foodTotal').textContent = 'Total: ' + macroLine(per, num(f.servings.value));
}
foodForm.addEventListener('input', updateFoodTotal);
$('#foodSearch').addEventListener('input', renderPickList);
$('#diningSearch').addEventListener('input', renderDining);
document.querySelectorAll('#foodTabs button').forEach(b =>
  b.addEventListener('click', () => {
    // Switching to Manual from another tab starts a blank form.
    if (b.dataset.panel === 'manual' && state.panel !== 'manual' && state.prefilled) {
      state.pickedFood = null; state.prefilled = false; fillForm(); setFormMode();
    }
    showPanel(b.dataset.panel);
  }));

foodForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = foodForm.elements;
  const per = {};
  for (const k of MACRO_KEYS) per[k] = num(f[k].value);
  const base = {
    name: f.name.value.trim(),
    serving: f.serving.value.trim(),
    per,
    servings: num(f.servings.value) || 1,
  };

  if (state.editingEntry) {
    await db.updateEntry({ ...state.editingEntry, ...base });
  } else {
    let foodId = state.pickedFood?.id ?? null;
    if (foodId == null && f.saveFood.checked) {
      foodId = await db.findOrAddFood({ name: base.name, serving: base.serving, per, source: 'custom' });
    }
    await db.addEntry({ ...base, foodId, date: state.viewDate });
  }
  foodDialog.close();
  render();
});

twoTap($('#deleteEntryBtn'), 'Delete', async () => {
  await db.deleteEntry(state.editingEntry.id);
  foodDialog.close();
  render();
});
twoTap($('#forgetFoodBtn'), 'Remove from my foods', async () => {
  await db.deleteFood(state.pickedFood.id);
  state.pickedFood = null;
  state.prefilled = false;
  fillForm(); setFormMode();
  await renderPickList();
  showPanel('pick');
});

// ---------- navigation ----------
document.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => b.closest('dialog').close()));
$('#addBtn').addEventListener('click', () => openFood());
$('#settingsBtn').addEventListener('click', () => openGoals());
$('#streakPill').addEventListener('click', () => { state.tab = 'history'; render(); });

$('#prevDay').addEventListener('click', () => { state.viewDate = addDays(state.viewDate, -1); render(); });
$('#nextDay').addEventListener('click', () => {
  if (state.viewDate < state.today) { state.viewDate = addDays(state.viewDate, 1); render(); }
});
$('#jumpToday').addEventListener('click', () => { state.viewDate = state.today; render(); });

$('#prevMonth').addEventListener('click', () => {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); render();
});
$('#nextMonth').addEventListener('click', () => {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); render();
});

document.querySelectorAll('.tabbar button').forEach(b =>
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    if (state.tab === 'day') state.viewDate = state.today;
    else state.calMonth = firstOfMonth(new Date());
    render();
  }));

// Roll over to a new day if the app is reopened after midnight.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const now = dateKey(new Date());
  if (now !== state.today) {
    if (state.viewDate === state.today) state.viewDate = now;
    render();
  }
});

(async function init() {
  db.requestPersistence();
  await render();
  if (!goalsFor(state.today, state.goalsHistory)) openGoals(true);
  loadMenu(state.today); // prefetch so today's menu is saved for spotty dining-hall signal
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
