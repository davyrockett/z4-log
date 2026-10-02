'use strict';

const APP_VERSION = '0.3.0';

/* ---------- Tabs ----------
   The part after # in the address picks the screen: #garage, #faults, #settings */
const VIEWS = ['garage', 'faults', 'settings'];

function showView() {
  const name = location.hash.slice(1);
  const current = VIEWS.includes(name) ? name : 'garage';
  for (const view of document.querySelectorAll('.view')) {
    view.hidden = view.dataset.view !== current;
  }
  for (const tab of document.querySelectorAll('.tabbar a')) {
    if (tab.dataset.tab === current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', showView);

/* ---------- Theme ---------- */
const THEME_KEY = 'z4log-theme';

function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'auto';
  } catch (e) {
    return 'auto';
  }
}

function setTheme(choice) {
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch (e) {}
  if (choice === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  for (const btn of document.querySelectorAll('[data-theme-choice]')) {
    btn.setAttribute('aria-checked', String(btn.dataset.themeChoice === choice));
  }
}

for (const btn of document.querySelectorAll('[data-theme-choice]')) {
  btn.addEventListener('click', () => setTheme(btn.dataset.themeChoice));
}

/* ---------- Online / offline indicator ---------- */
function updateNetStatus() {
  document.getElementById('net-status').hidden = navigator.onLine;
}
window.addEventListener('online', updateNetStatus);
window.addEventListener('offline', updateNetStatus);

/* ---------- Device facts (Settings screen) ---------- */
function setFact(id, ok, yesText = 'Yes', noText = 'No') {
  const el = document.getElementById(id);
  el.textContent = ok ? yesText : noText;
  el.className = ok ? 'yes' : 'no';
}

function isInstalled() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

async function refreshFacts() {
  setFact('fact-installed', isInstalled());
  setFact('fact-offline', Boolean(navigator.serviceWorker && navigator.serviceWorker.controller));
  document.getElementById('fact-version').textContent = APP_VERSION;

  let persisted = false;
  if (navigator.storage && navigator.storage.persisted) {
    persisted = await navigator.storage.persisted();
  }
  setFact('fact-persist', persisted);
}

// Ask the browser not to clear this app's data when the phone is low on space.
async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) {}
  }
}

/* ---------- Offline support (service worker) ---------- */
function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  banner.hidden = false;
  document.getElementById('update-btn').onclick = () => {
    worker.postMessage('skipWaiting');
  };
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.register('sw.js');

  // A new version was downloaded on an earlier visit and is waiting.
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);

  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateBanner(worker);
      }
    });
  });

  // Once a new version takes over, reload to use it.
  // (Skipped on the very first visit, when there's no old version to replace.)
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { refreshFacts(); return; }
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  // Home Screen apps rarely restart, so check for updates when reopened.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) reg.update();
  });

  await navigator.serviceWorker.ready;
  refreshFacts();
}

/* ---------- Formatting helpers ---------- */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const moneyWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function formatMoney(n) {
  return Number.isInteger(n) ? moneyWhole.format(n) : money.format(n);
}
function formatHours(h) {
  return `${Number(h.toFixed(2))} h`;
}
function formatDate(iso) {
  // iso is "YYYY-MM-DD"; read it as UTC so it never shifts a day
  return dateFmt.format(new Date(iso + 'T00:00:00Z'));
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// "$1,200.50" → 1200.5; blank → 0; nonsense → NaN
function parseNumber(text) {
  const cleaned = String(text ?? '').replace(/[$,\s]/g, '');
  return cleaned === '' ? 0 : Number(cleaned);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

let toastTimer;
function toast(message) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', { class: 'toast', role: 'status' });
    document.body.append(t);
  }
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

/* ---------- Garage log ---------- */
const CATEGORIES = ['maintenance', 'repair', 'upgrade', 'diagnosis'];
const CATEGORY_LABELS = { maintenance: 'Maintenance', repair: 'Repair', upgrade: 'Upgrade', diagnosis: 'Diagnosis' };

let garage = [];
let garageFilter = 'all';

function sortNewestFirst(list) {
  return list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function loadGarage() {
  garage = sortNewestFirst(await db.getAll('garage'));
  renderGarage();
}

function renderGarage() {
  const shown = garageFilter === 'all' ? garage : garage.filter((e) => e.category === garageFilter);

  const cost = shown.reduce((sum, e) => sum + (e.cost || 0), 0);
  const hours = shown.reduce((sum, e) => sum + (e.hours || 0), 0);
  document.getElementById('total-cost').textContent = formatMoney(Math.round(cost * 100) / 100);
  document.getElementById('total-hours').textContent = formatHours(hours);
  document.getElementById('total-count').textContent = String(shown.length);

  for (const chip of document.querySelectorAll('#garage-filter [data-filter]')) {
    chip.setAttribute('aria-checked', String(chip.dataset.filter === garageFilter));
  }

  const list = document.getElementById('garage-list');
  list.replaceChildren(...shown.map((e) => {
    const meta = el('div', { class: 'entry-meta' });
    if (e.cost) meta.append(el('span', {}, formatMoney(e.cost)));
    if (e.hours) meta.append(el('span', {}, formatHours(e.hours)));
    if (e.mileage) meta.append(el('span', {}, `${e.mileage.toLocaleString('en-US')} mi`));

    const button = el('button', { type: 'button', class: 'entry' },
      el('div', { class: 'entry-top' },
        el('span', { class: 'entry-date' }, formatDate(e.date)),
        el('span', { class: `badge ${e.category}` }, CATEGORY_LABELS[e.category])),
      el('div', { class: 'entry-title' }, e.title),
      meta.childElementCount ? meta : null);
    button.addEventListener('click', () => openGarageForm(e));
    return el('li', {}, button);
  }));

  const empty = document.getElementById('garage-empty');
  empty.hidden = shown.length > 0;
  empty.querySelector('p').textContent = garage.length ? 'Nothing in this category.' : 'No entries yet.';
}

for (const chip of document.querySelectorAll('#garage-filter [data-filter]')) {
  chip.addEventListener('click', () => {
    garageFilter = chip.dataset.filter;
    renderGarage();
  });
}

/* Add / edit form */
const garageDialog = document.getElementById('garage-dialog');
const garageForm = document.getElementById('garage-form');
let editingId = null;

function openGarageForm(entry) {
  editingId = entry ? entry.id : null;
  const f = garageForm.elements;
  f.date.value = entry ? entry.date : todayISO();
  f.category.value = entry ? entry.category : 'maintenance';
  f.title.value = entry ? entry.title : '';
  f.cost.value = entry && entry.cost ? (Number.isInteger(entry.cost) ? String(entry.cost) : entry.cost.toFixed(2)) : '';
  f.hours.value = entry && entry.hours ? String(entry.hours) : '';
  f.mileage.value = entry && entry.mileage ? String(entry.mileage) : '';
  f.parts.value = entry ? entry.parts : '';
  f.notes.value = entry ? entry.notes : '';
  document.getElementById('garage-dialog-title').textContent = entry ? 'Edit entry' : 'New entry';
  document.getElementById('garage-delete').hidden = !entry;
  document.getElementById('garage-error').hidden = true;
  garageDialog.showModal();
  garageDialog.querySelector('.sheet-body').scrollTop = 0;
}

function formError(message) {
  const err = document.getElementById('garage-error');
  err.textContent = message;
  err.hidden = false;
  garageDialog.querySelector('.sheet-body').scrollTop = 0;
}

garageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = garageForm.elements;
  const cost = parseNumber(f.cost.value);
  const hours = parseNumber(f.hours.value);
  const mileage = parseNumber(f.mileage.value);

  if (!f.date.value) return formError('Please pick a date.');
  if (!f.title.value.trim()) return formError('Please enter a title.');
  if (!(cost >= 0)) return formError('Parts cost should be a number, like 49.99.');
  if (!(hours >= 0)) return formError('Labor hours should be a number, like 1.5.');
  if (!(mileage >= 0) || !Number.isInteger(mileage)) return formError('Mileage should be a whole number, like 200008.');

  const existing = garage.find((e) => e.id === editingId);
  const now = new Date().toISOString();
  const entry = {
    id: editingId || newId(),
    date: f.date.value,
    category: f.category.value,
    title: f.title.value.trim(),
    cost: Math.round(cost * 100) / 100,
    hours: Math.round(hours * 100) / 100,
    mileage: mileage || null,
    parts: f.parts.value.trim(),
    notes: f.notes.value.trim(),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  try {
    await db.put('garage', entry);
  } catch (e) {
    return formError(`Couldn't save: ${e.message}`);
  }
  garageDialog.close();
  toast(existing ? 'Entry updated' : 'Entry added');
  loadGarage();
});

document.getElementById('garage-delete').addEventListener('click', async () => {
  if (!editingId || !confirm('Delete this entry? This can’t be undone.')) return;
  await db.remove('garage', editingId);
  garageDialog.close();
  toast('Entry deleted');
  loadGarage();
});

garageDialog.querySelector('[data-close]').addEventListener('click', () => garageDialog.close());
document.getElementById('garage-add').addEventListener('click', () => openGarageForm(null));

/* ---------- Fault codes ---------- */
let faults = [];
let faultFilter = 'open';

async function loadFaults() {
  faults = (await db.getAll('faults')).sort((a, b) =>
    (b.dateFixed || b.dateSeen).localeCompare(a.dateFixed || a.dateSeen) ||
    (b.createdAt || '').localeCompare(a.createdAt || ''));
  renderFaults();
}

function renderFaults() {
  const openCount = faults.filter((f) => f.status === 'open').length;
  document.getElementById('fault-open-count').textContent = String(openCount);
  document.getElementById('fault-fixed-count').textContent = String(faults.length - openCount);

  for (const chip of document.querySelectorAll('#fault-filter [data-filter]')) {
    chip.setAttribute('aria-checked', String(chip.dataset.filter === faultFilter));
  }

  const shown = faultFilter === 'all' ? faults : faults.filter((f) => f.status === faultFilter);
  const list = document.getElementById('fault-list');
  list.replaceChildren(...shown.map((f) => {
    const isOpen = f.status === 'open';
    const when = isOpen
      ? `Seen ${formatDate(f.dateSeen)}`
      : `Fixed ${formatDate(f.dateFixed || f.dateSeen)}`;

    const main = el('button', { type: 'button', class: 'entry' },
      el('div', { class: 'entry-top' },
        el('span', { class: 'fault-code mono' }, f.code),
        el('span', { class: `badge ${f.status}` }, isOpen ? 'Open' : 'Fixed')),
      f.description ? el('div', { class: 'fault-desc' }, f.description) : null,
      el('div', { class: 'entry-date' }, when),
      !isOpen && f.fixNotes ? el('div', { class: 'fault-fix-notes' }, f.fixNotes) : null);
    main.addEventListener('click', () => openFaultForm(f));

    const card = el('div', { class: `fault-card ${isOpen ? 'is-open' : 'is-fixed'}` }, main);
    if (isOpen) {
      const fixBtn = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Mark fixed…');
      fixBtn.addEventListener('click', () => openFaultForm(f, { markFixed: true }));
      card.append(el('div', { class: 'fault-actions' }, fixBtn));
    }
    return el('li', {}, card);
  }));

  const empty = document.getElementById('fault-empty');
  empty.hidden = shown.length > 0;
  empty.querySelector('p').textContent =
    !faults.length ? 'No fault codes.' : faultFilter === 'open' ? 'No open fault codes. Nice.' : 'Nothing here.';
}

for (const chip of document.querySelectorAll('#fault-filter [data-filter]')) {
  chip.addEventListener('click', () => {
    faultFilter = chip.dataset.filter;
    renderFaults();
  });
}

/* Add / edit form */
const faultDialog = document.getElementById('fault-dialog');
const faultForm = document.getElementById('fault-form');
let editingFaultId = null;

// The Resolution section only shows when status is Fixed.
function syncResolution() {
  const fixed = faultForm.elements.status.value === 'fixed';
  document.getElementById('fault-resolution').hidden = !fixed;
  if (fixed && !faultForm.elements.dateFixed.value) faultForm.elements.dateFixed.value = todayISO();
}
for (const radio of faultForm.querySelectorAll('input[name="status"]')) {
  radio.addEventListener('change', syncResolution);
}

function openFaultForm(fault, { markFixed = false } = {}) {
  editingFaultId = fault ? fault.id : null;
  const f = faultForm.elements;
  f.code.value = fault ? fault.code : '';
  f.dateSeen.value = fault ? fault.dateSeen : todayISO();
  f.description.value = fault ? fault.description : '';
  f.status.value = markFixed ? 'fixed' : fault ? fault.status : 'open';
  f.dateFixed.value = fault && fault.dateFixed ? fault.dateFixed : '';
  f.fixNotes.value = fault ? fault.fixNotes : '';
  syncResolution();

  document.getElementById('fault-dialog-title').textContent =
    markFixed ? 'Mark fixed' : fault ? 'Edit fault code' : 'New fault code';
  document.getElementById('fault-delete').hidden = !fault;
  document.getElementById('fault-error').hidden = true;
  faultDialog.showModal();

  const body = faultDialog.querySelector('.sheet-body');
  if (markFixed) {
    // Jump straight to "What fixed it"
    document.getElementById('fault-resolution').scrollIntoView({ block: 'start' });
    f.fixNotes.focus({ preventScroll: true });
  } else {
    body.scrollTop = 0;
  }
}

function faultFormError(message) {
  const err = document.getElementById('fault-error');
  err.textContent = message;
  err.hidden = false;
  faultDialog.querySelector('.sheet-body').scrollTop = 0;
}

faultForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = faultForm.elements;
  const code = f.code.value.trim().toUpperCase().replace(/\s+/g, '');
  const status = f.status.value;
  const dateFixed = status === 'fixed' ? (f.dateFixed.value || todayISO()) : '';

  if (!code) return faultFormError('Please enter the code, like P0171.');
  if (!f.dateSeen.value) return faultFormError('Please pick the date you saw it.');
  if (dateFixed && dateFixed < f.dateSeen.value) return faultFormError('Date fixed is before the date it was seen.');

  const existing = faults.find((x) => x.id === editingFaultId);
  const now = new Date().toISOString();
  const fault = {
    id: editingFaultId || newId(),
    code,
    description: f.description.value.trim(),
    dateSeen: f.dateSeen.value,
    status,
    dateFixed,
    fixNotes: f.fixNotes.value.trim(),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  try {
    await db.put('faults', fault);
  } catch (e) {
    return faultFormError(`Couldn't save: ${e.message}`);
  }
  faultDialog.close();
  const justFixed = existing && existing.status === 'open' && status === 'fixed';
  toast(justFixed ? `${code} marked fixed` : existing ? 'Fault code updated' : 'Fault code added');
  loadFaults();
});

document.getElementById('fault-delete').addEventListener('click', async () => {
  if (!editingFaultId || !confirm('Delete this fault code? This can’t be undone.')) return;
  await db.remove('faults', editingFaultId);
  faultDialog.close();
  toast('Fault code deleted');
  loadFaults();
});

faultDialog.querySelector('[data-close]').addEventListener('click', () => faultDialog.close());
document.getElementById('fault-add').addEventListener('click', () => openFaultForm(null));

/* ---------- Import backup ---------- */
function cleanGarageEntry(raw) {
  const num = (v) => { const n = parseNumber(v); return n >= 0 ? n : 0; };
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || !String(raw.title || '').trim()) return null;
  const now = new Date().toISOString();
  return {
    id: raw.id || newId(),
    date: raw.date,
    category: CATEGORIES.includes(raw.category) ? raw.category : 'maintenance',
    title: String(raw.title).trim(),
    cost: num(raw.cost),
    hours: num(raw.hours),
    mileage: Math.round(num(raw.mileage)) || null,
    parts: String(raw.parts || ''),
    notes: String(raw.notes || ''),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

function cleanFault(raw) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const code = String((raw && raw.code) || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code || !isDate(raw.dateSeen)) return null;
  const status = raw.status === 'fixed' ? 'fixed' : 'open';
  const now = new Date().toISOString();
  return {
    id: raw.id || newId(),
    code,
    description: String(raw.description || ''),
    dateSeen: raw.dateSeen,
    status,
    dateFixed: status === 'fixed' ? (isDate(raw.dateFixed) ? raw.dateFixed : raw.dateSeen) : '',
    fixNotes: String(raw.fixNotes || ''),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

document.getElementById('import-file').addEventListener('change', async (event) => {
  const input = event.target;
  const file = input.files[0];
  input.value = ''; // so picking the same file again still works
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    return alert('That file isn’t a valid backup (couldn’t read it as JSON).');
  }
  if (!data || data.app !== 'z4-log' || !Array.isArray(data.garage)) {
    return alert('That file doesn’t look like a Z4 Log backup.');
  }

  const garageIn = data.garage.map(cleanGarageEntry);
  const faultsIn = (Array.isArray(data.faults) ? data.faults : []).map(cleanFault);
  const skipped = garageIn.filter((e) => !e).length + faultsIn.filter((f) => !f).length;
  const clean = { garage: garageIn.filter(Boolean), faults: faultsIn.filter(Boolean) };

  const msg = `Import ${plural(clean.garage.length, 'garage entry').replace(/entrys$/, 'entries')} and ${plural(clean.faults.length, 'fault code')}?` +
    (skipped ? `\n\n${plural(skipped, 'item')} ${skipped === 1 ? 'is' : 'are'} missing a date, title or code and will be skipped.` : '') +
    `\n\nThis replaces everything currently in the app.`;
  if (!confirm(msg)) return;

  try {
    await db.replaceAll(clean);
  } catch (e) {
    return alert(`Import failed, nothing was changed.\n\n${e.message}`);
  }
  await Promise.all([loadGarage(), loadFaults()]);
  toast(`Imported ${clean.garage.length} entries, ${plural(clean.faults.length, 'code')}`);
  location.hash = '#garage';
});

/* ---------- Start ---------- */
showView();
loadGarage();
loadFaults();
setTheme(getTheme());
updateNetStatus();
requestPersistentStorage().then(refreshFacts);
registerServiceWorker();
