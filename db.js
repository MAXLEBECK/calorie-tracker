// Tiny IndexedDB wrapper. All data lives on the device.
const DB_NAME = 'fuel';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // key/value settings (goal history lives here)
        db.createObjectStore('settings');
        // saved foods (custom now; dining/barcode later)
        const foods = db.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
        foods.createIndex('name', 'nameLower');
        // log entries, one per food eaten
        const entries = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        entries.createIndex('date', 'date');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

// ---- settings ----
export async function getSetting(key) {
  return wrap((await store('settings')).get(key));
}
export async function setSetting(key, value) {
  return wrap((await store('settings', 'readwrite')).put(value, key));
}

// ---- goals (history kept so past days keep the goals they had) ----
export async function getGoalsForDate(date) {
  const history = (await getSetting('goalsHistory')) || [];
  let match = null;
  for (const g of history) {
    if (g.effectiveDate <= date && (!match || g.effectiveDate >= match.effectiveDate)) match = g;
  }
  return match || history[0] || null;
}
export async function getGoalsHistory() {
  return (await getSetting('goalsHistory')) || [];
}
export async function saveGoals(goals, effectiveDate) {
  const history = ((await getSetting('goalsHistory')) || []).filter(g => g.effectiveDate !== effectiveDate);
  history.push({ ...goals, tolerancePct: 10, effectiveDate });
  history.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return setSetting('goalsHistory', history);
}

// ---- foods ----
export async function addFood(food) {
  return wrap((await store('foods', 'readwrite')).add({ ...food, nameLower: food.name.toLowerCase() }));
}
export async function getFood(id) {
  return wrap((await store('foods')).get(id));
}
export async function getAllFoods() {
  return wrap((await store('foods')).getAll());
}
export async function updateFood(food) {
  return wrap((await store('foods', 'readwrite')).put({ ...food, nameLower: food.name.toLowerCase() }));
}
export async function deleteFood(id) {
  return wrap((await store('foods', 'readwrite')).delete(id));
}
// Reuse an identical saved food instead of creating duplicates.
export async function findOrAddFood(food) {
  const same = (await getAllFoods()).find(f =>
    f.nameLower === food.name.toLowerCase() &&
    (f.serving || '') === (food.serving || '') &&
    ['calories', 'protein', 'carbs', 'fat'].every(k => f.per[k] === food.per[k]));
  return same ? same.id : addFood(food);
}

// ---- entries ----
export async function getEntries(date) {
  const idx = (await store('entries')).index('date');
  const list = await wrap(idx.getAll(date));
  return list.sort((a, b) => a.timestamp - b.timestamp);
}
export async function getAllEntries() {
  return wrap((await store('entries')).getAll());
}
export async function addEntry(entry) {
  return wrap((await store('entries', 'readwrite')).add({ ...entry, timestamp: Date.now() }));
}
export async function updateEntry(entry) {
  return wrap((await store('entries', 'readwrite')).put(entry));
}
export async function deleteEntry(id) {
  return wrap((await store('entries', 'readwrite')).delete(id));
}

// Ask the browser not to evict our data (honored for home-screen apps on iOS).
export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}
