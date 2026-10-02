'use strict';

const APP_VERSION = '0.7.0';

/* ---------- Tabs ----------
   The part after # in the address picks the screen: #garage, #faults, #settings */
const VIEWS = ['garage', 'faults', 'todos', 'settings'];

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

  // Browser/status bar color: follow the phone in Auto, otherwise the chosen theme
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.dataset.auto ??= meta.content;
    meta.content = choice === 'auto' ? meta.dataset.auto : choice === 'dark' ? '#0b0d10' : '#ffffff';
  }
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

/* ---------- Forms: don't lose typing ----------
   Each form remembers its contents when opened. Cancel (or Esc on the Mac)
   asks first if anything changed. */
const formState = (form) => JSON.stringify([...new FormData(form)]);

function rememberForm(form) {
  form.dataset.saved = formState(form);
}

function guardDialog(dialog, form) {
  const discardOK = () =>
    formState(form) === form.dataset.saved || confirm('Discard your changes?');
  dialog.querySelector('[data-close]').addEventListener('click', () => {
    if (discardOK()) dialog.close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (!discardOK()) event.preventDefault();
  });
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
  document.getElementById('total-cost').textContent = moneyWhole.format(Math.round(cost));
  document.getElementById('total-hours').textContent = `${Number(hours.toFixed(1))} h`;
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
  updateBackupStatus();
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
  rememberForm(garageForm);
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

guardDialog(garageDialog, garageForm);
document.getElementById('garage-add').addEventListener('click', () => openGarageForm(null));

/* ---------- Faults & warnings ----------
   One list, two kinds of item: fault codes from the scanner (kind "code")
   and dashboard warning lights (kind "light"). Both can be open or fixed. */
let faults = [];
let faultFilter = 'open';

const KIND_WORD = { code: 'Fault code', light: 'Warning light' };
const faultLabel = (f) => (f.kind === 'light' ? f.name : f.code);

async function loadFaults() {
  faults = (await db.getAll('faults')).map((f) => ({ kind: 'code', ...f })).sort((a, b) =>
    (b.dateFixed || b.dateSeen || '').localeCompare(a.dateFixed || a.dateSeen || '') ||
    (b.createdAt || '').localeCompare(a.createdAt || ''));
  renderFaults();
}

function faultCard(f) {
  const isOpen = f.status === 'open';
  const when = !isOpen ? `Fixed ${formatDate(f.dateFixed || f.dateSeen)}`
    : f.dateSeen ? `Seen ${formatDate(f.dateSeen)}` : 'Date seen unknown';

  const main = el('button', { type: 'button', class: 'entry' },
    el('div', { class: 'entry-top' },
      el('span', { class: f.kind === 'light' ? 'fault-name' : 'fault-code mono' }, faultLabel(f)),
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
}

function renderFaults() {
  const openCount = faults.filter((f) => f.status === 'open').length;
  document.getElementById('fault-open-count').textContent = String(openCount);
  document.getElementById('fault-fixed-count').textContent = String(faults.length - openCount);

  for (const chip of document.querySelectorAll('#fault-filter [data-filter]')) {
    chip.setAttribute('aria-checked', String(chip.dataset.filter === faultFilter));
  }

  const shown = faultFilter === 'all' ? faults : faults.filter((f) => f.status === faultFilter);
  const lights = shown.filter((f) => f.kind === 'light');
  const codes = shown.filter((f) => f.kind !== 'light');
  document.getElementById('light-list').replaceChildren(...lights.map(faultCard));
  document.getElementById('fault-list').replaceChildren(...codes.map(faultCard));
  document.getElementById('light-section').hidden = lights.length === 0;
  document.getElementById('code-section').hidden = codes.length === 0;

  const empty = document.getElementById('fault-empty');
  empty.hidden = shown.length > 0;
  empty.querySelector('p').textContent =
    !faults.length ? 'Nothing logged yet.' : faultFilter === 'open' ? 'Nothing open. Nice.' : 'Nothing here.';
  updateBackupStatus();
}

for (const chip of document.querySelectorAll('#fault-filter [data-filter]')) {
  chip.addEventListener('click', () => {
    faultFilter = chip.dataset.filter;
    renderFaults();
  });
}

/* Add / edit form (shared by codes and lights) */
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

function openFaultForm(fault, { markFixed = false, kind = 'code' } = {}) {
  editingFaultId = fault ? fault.id : null;
  kind = fault ? fault.kind : kind;
  const f = faultForm.elements;
  f.kind.value = kind;
  f.code.value = fault ? fault.code || '' : '';
  f.name.value = fault ? fault.name || '' : '';
  f.dateSeen.value = fault ? fault.dateSeen : todayISO();
  f.description.value = fault ? fault.description : '';
  f.status.value = markFixed ? 'fixed' : fault ? fault.status : 'open';
  f.dateFixed.value = fault && fault.dateFixed ? fault.dateFixed : '';
  f.fixNotes.value = fault ? fault.fixNotes : '';
  syncResolution();

  document.getElementById('light-name-field').hidden = kind !== 'light';
  document.getElementById('code-field').hidden = kind === 'light';
  document.getElementById('fault-dialog-title').textContent =
    markFixed ? 'Mark fixed' : `${fault ? 'Edit' : 'New'} ${KIND_WORD[kind].toLowerCase()}`;
  document.getElementById('fault-delete').hidden = !fault;
  document.getElementById('fault-error').hidden = true;
  rememberForm(faultForm);
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
  const kind = f.kind.value;
  const code = kind === 'code' ? f.code.value.trim().toUpperCase().replace(/\s+/g, '') : '';
  const name = kind === 'light' ? f.name.value.trim() : '';
  const status = f.status.value;
  const dateFixed = status === 'fixed' ? (f.dateFixed.value || todayISO()) : '';

  if (kind === 'code' && !code) return faultFormError('Please enter the code, like 2D07.');
  if (kind === 'light' && !name) return faultFormError('Please name the warning light, like Brake pad wear.');
  if (dateFixed && f.dateSeen.value && dateFixed < f.dateSeen.value) {
    return faultFormError('Date fixed is before the date it was seen.');
  }

  const existing = faults.find((x) => x.id === editingFaultId);
  const now = new Date().toISOString();
  const fault = {
    id: editingFaultId || newId(),
    kind,
    code,
    name,
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
  toast(justFixed ? `${faultLabel(fault)} marked fixed`
    : `${KIND_WORD[kind]} ${existing ? 'updated' : 'added'}`);
  loadFaults();
});

document.getElementById('fault-delete').addEventListener('click', async () => {
  const kind = faultForm.elements.kind.value;
  if (!editingFaultId || !confirm(`Delete this ${KIND_WORD[kind].toLowerCase()}? This can’t be undone.`)) return;
  await db.remove('faults', editingFaultId);
  faultDialog.close();
  toast(`${KIND_WORD[kind]} deleted`);
  loadFaults();
});

guardDialog(faultDialog, faultForm);
document.getElementById('fault-add').addEventListener('click', () => openFaultForm(null, { kind: 'code' }));
document.getElementById('light-add').addEventListener('click', () => openFaultForm(null, { kind: 'light' }));

/* ---------- To-do ---------- */
let todos = [];

async function loadTodos() {
  todos = await db.getAll('todos');
  renderTodos();
}

function todoItem(t) {
  const check = el('button', {
    type: 'button', class: 'todo-check', role: 'checkbox',
    'aria-checked': String(t.done), 'aria-label': `Done: ${t.title}`,
  }, el('span'));
  check.addEventListener('click', () => toggleTodo(t));

  const body = el('button', { type: 'button', class: 'todo-body' },
    el('div', { class: 'todo-title' }, t.title),
    t.notes ? el('div', { class: 'todo-notes' }, t.notes) : null);
  body.addEventListener('click', () => openTodoForm(t));

  return el('li', {}, el('div', { class: `todo ${t.done ? 'is-done' : ''}` }, check, body));
}

function renderTodos() {
  // Open jobs in the order added; finished ones most recent first
  const open = todos.filter((t) => !t.done).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = todos.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  document.getElementById('todo-open').replaceChildren(...open.map(todoItem));
  document.getElementById('todo-done').replaceChildren(...done.map(todoItem));
  document.getElementById('todo-done-section').hidden = done.length === 0;
  document.getElementById('todo-empty').hidden = open.length > 0;
  updateBackupStatus();
}

async function toggleTodo(t) {
  const now = new Date().toISOString();
  await db.put('todos', { ...t, done: !t.done, doneAt: t.done ? '' : now, updatedAt: now });
  toast(t.done ? 'Moved back to the list' : 'Done ✓');
  loadTodos();
}

// Quick add: type a job, press Add (or Return)
document.getElementById('todo-quick').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = event.target.elements.title;
  const title = input.value.trim();
  if (!title) return input.focus();
  const now = new Date().toISOString();
  await db.put('todos', { id: newId(), title, notes: '', done: false, doneAt: '', createdAt: now, updatedAt: now });
  input.value = '';
  loadTodos();
});

/* Edit form */
const todoDialog = document.getElementById('todo-dialog');
const todoForm = document.getElementById('todo-form');
let editingTodo = null;

function openTodoForm(t) {
  editingTodo = t;
  todoForm.elements.title.value = t.title;
  todoForm.elements.notes.value = t.notes;
  document.getElementById('todo-error').hidden = true;
  rememberForm(todoForm);
  todoDialog.showModal();
  todoDialog.querySelector('.sheet-body').scrollTop = 0;
}

todoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = todoForm.elements.title.value.trim();
  if (!title) {
    const err = document.getElementById('todo-error');
    err.textContent = 'Please describe the job.';
    err.hidden = false;
    return;
  }
  await db.put('todos', {
    ...editingTodo, title, notes: todoForm.elements.notes.value.trim(), updatedAt: new Date().toISOString(),
  });
  todoDialog.close();
  toast('To-do updated');
  loadTodos();
});

document.getElementById('todo-delete').addEventListener('click', async () => {
  if (!editingTodo || !confirm('Delete this to-do? This can’t be undone.')) return;
  await db.remove('todos', editingTodo.id);
  todoDialog.close();
  toast('To-do deleted');
  loadTodos();
});

guardDialog(todoDialog, todoForm);

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
  if (!raw) return null;
  const kind = raw.kind === 'light' ? 'light' : 'code';
  const code = kind === 'code' ? String(raw.code || '').trim().toUpperCase().replace(/\s+/g, '') : '';
  const name = kind === 'light' ? String(raw.name || '').trim() : '';
  if (kind === 'code' ? !code : !name) return null;
  const dateSeen = isDate(raw.dateSeen) ? raw.dateSeen : '';
  const status = raw.status === 'fixed' ? 'fixed' : 'open';
  const now = new Date().toISOString();
  return {
    id: raw.id || newId(),
    kind,
    code,
    name,
    description: String(raw.description || ''),
    dateSeen,
    status,
    dateFixed: status === 'fixed' ? (isDate(raw.dateFixed) ? raw.dateFixed : dateSeen || todayISO()) : '',
    fixNotes: String(raw.fixNotes || ''),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

function cleanTodo(raw) {
  const title = String((raw && raw.title) || '').trim();
  if (!title) return null;
  const now = new Date().toISOString();
  return {
    id: raw.id || newId(),
    title,
    notes: String(raw.notes || ''),
    done: raw.done === true,
    doneAt: raw.done === true ? String(raw.doneAt || now) : '',
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
  const todosIn = (Array.isArray(data.todos) ? data.todos : []).map(cleanTodo); // older backups have none
  const skipped = [...garageIn, ...faultsIn, ...todosIn].filter((x) => !x).length;
  const clean = { garage: garageIn.filter(Boolean), faults: faultsIn.filter(Boolean), todos: todosIn.filter(Boolean) };

  const msg = `Import ${plural(clean.garage.length, 'garage entry').replace(/entrys$/, 'entries')}, ${clean.faults.length} faults & warnings and ${plural(clean.todos.length, 'to-do')}?` +
    (skipped ? `\n\n${plural(skipped, 'item')} ${skipped === 1 ? 'is' : 'are'} missing a date, title, code, light name or job and will be skipped.` : '') +
    (sync.isOn() ? `\n\nThis replaces everything in the app, on all your synced devices.` : `\n\nThis replaces everything currently in the app.`);
  if (!confirm(msg)) return;

  try {
    await db.replaceAll(clean);
  } catch (e) {
    return alert(`Import failed, nothing was changed.\n\n${e.message}`);
  }
  await Promise.all([loadGarage(), loadFaults(), loadTodos()]);
  toast('Backup imported');
  location.hash = '#garage';
});

/* ---------- Export: backup (.json) and spreadsheets (.csv) ---------- */

// iPhone: opens the Share sheet (Save to Files, AirDrop, Mail…). Mac: normal download.
// Returns false if the person cancelled.
// Note: nothing here waits on the database first. iPhone only allows the
// Share sheet right after a tap, so we export from what's already loaded.
async function saveFile(filename, type, text) {
  const file = new File([text], filename, { type });
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      // Share sheet refused for another reason: fall back to a download
    }
  }
  const url = URL.createObjectURL(file);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

function backupJSON() {
  return JSON.stringify({
    app: 'z4-log',
    format: 1,
    exportedAt: new Date().toISOString(),
    garage,
    faults,
    todos,
  }, null, 2);
}

// One spreadsheet cell. Quotes when needed; stops spreadsheet apps from
// treating text like "=..." or "-..." as a formula.
function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // ﻿ tells Excel it's UTF-8
}

function garageCSV() {
  const rows = [...garage].reverse().map((e) => [ // oldest first
    e.date, CATEGORY_LABELS[e.category], e.title, e.cost, e.hours, e.mileage ?? '', e.parts, e.notes,
  ]);
  return toCSV(['Date', 'Category', 'Title', 'Parts cost', 'Labor hours', 'Mileage', 'Parts used', 'Notes'], rows);
}

function faultsCSV() {
  // oldest first; unknown dates at the end
  const rows = [...faults].sort((a, b) => (a.dateSeen || '9').localeCompare(b.dateSeen || '9')).map((f) => [
    KIND_WORD[f.kind], faultLabel(f), f.description, f.dateSeen, f.status === 'open' ? 'Open' : 'Fixed', f.dateFixed, f.fixNotes,
  ]);
  return toCSV(['Type', 'Code or light', 'Description', 'Date seen', 'Status', 'Date fixed', 'Fix notes'], rows);
}

async function exportBackup() {
  const saved = await saveFile(`z4-log-backup-${todayISO()}.json`, 'application/json', backupJSON());
  if (!saved) return;
  storeSet(LAST_BACKUP_KEY, new Date().toISOString());
  updateBackupStatus();
  toast('Backup saved');
}

document.getElementById('export-json').addEventListener('click', exportBackup);
document.getElementById('export-garage-csv').addEventListener('click', () =>
  saveFile(`z4-log-garage-${todayISO()}.csv`, 'text/csv', garageCSV()));
document.getElementById('export-faults-csv').addEventListener('click', () =>
  saveFile(`z4-log-faults-${todayISO()}.csv`, 'text/csv', faultsCSV()));

/* ---------- Backup reminder ----------
   Shows a yellow banner when there are changes that haven't been backed up
   and you've never backed up, or the last backup is a week or more old. */
const LAST_BACKUP_KEY = 'z4log-last-backup';
const LAST_CHANGE_KEY = 'z4log-last-change';
const SNOOZE_KEY = 'z4log-backup-snooze';
const REMIND_AFTER_DAYS = 7;
const SNOOZE_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

function storeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {}
}

function daysAgoText(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function updateBackupStatus() {
  const lastBackup = storeGet(LAST_BACKUP_KEY);
  const lastChange = storeGet(LAST_CHANGE_KEY);
  const snoozeUntil = storeGet(SNOOZE_KEY);

  document.getElementById('last-backup').textContent = lastBackup ? daysAgoText(lastBackup) : 'never';

  const hasData = garage.length > 0 || faults.length > 0 || todos.length > 0;
  const unsaved = !lastBackup || (lastChange && lastChange > lastBackup);
  const overdue = !lastBackup || Date.now() - new Date(lastBackup) >= REMIND_AFTER_DAYS * DAY;
  const snoozed = snoozeUntil && Date.now() < Number(snoozeUntil);
  // With sync on, GitHub keeps every version, so no nagging.
  if (sync.isOn()) { document.getElementById('backup-reminder').hidden = true; return; }

  document.getElementById('backup-reminder').hidden = !(hasData && unsaved && overdue && !snoozed);
  document.getElementById('backup-reminder-text').textContent =
    lastBackup ? `Last backup ${daysAgoText(lastBackup)}.` : 'You haven’t backed up yet.';
}

// Every save stamps the time (the banner re-checks whenever a list redraws)
// and tells sync to upload shortly.
db.onChange = () => {
  storeSet(LAST_CHANGE_KEY, new Date().toISOString());
  sync.soon();
};

document.getElementById('backup-now').addEventListener('click', exportBackup);
document.getElementById('backup-later').addEventListener('click', () => {
  storeSet(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * DAY));
  updateBackupStatus();
});

/* ---------- Sync (see sync.js) ---------- */
function timeAgoText(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return daysAgoText(iso);
}

function renderSync() {
  const on = sync.isOn();
  document.getElementById('sync-on').hidden = !on;
  document.getElementById('sync-off').hidden = on;
  const problem = on && ['auth', 'missing', 'other', 'conflict'].includes(sync.status);
  document.getElementById('backup-note').textContent = on
    ? 'Sync keeps every version on GitHub. A backup file is an extra copy for peace of mind.'
    : 'Your data only lives on this device. Save a backup to iCloud Drive (or AirDrop it to your Mac) every week or two.';
  document.getElementById('sync-pill').hidden = !problem;
  if (!on) return;

  document.getElementById('sync-repo').textContent = sync.repo();
  const status = document.getElementById('sync-status');
  const last = sync.lastSynced();
  status.className = 'sync-status';
  if (sync.status === 'syncing') {
    status.textContent = 'Syncing…';
  } else if (sync.status === 'ok') {
    status.textContent = `✓ Up to date · synced ${timeAgoText(last)}`;
    status.classList.add('ok');
  } else if (sync.status === 'offline') {
    status.textContent = `Offline. Your changes are saved here and will sync when you’re back online.${last ? ` Last synced ${timeAgoText(last)}.` : ''}`;
  } else if (problem) {
    status.textContent = sync.message;
    status.classList.add('problem');
  } else {
    status.textContent = last ? `Last synced ${timeAgoText(last)}` : 'Not synced yet';
  }
}

sync.onStatus = renderSync;
sync.onUpdated = () => {
  loadGarage();
  loadFaults();
  loadTodos();
};

document.getElementById('sync-off').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const err = document.getElementById('sync-error');
  const repo = form.elements.repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
  const token = form.elements.token.value.trim();
  err.hidden = true;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { err.textContent = 'Project should look like name/z4-log-data.'; err.hidden = false; return; }
  if (!token) { err.textContent = 'Paste your access key.'; err.hidden = false; return; }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const { remoteCount } = await sync.connect(repo, token);
    form.elements.token.value = '';
    const localCount = garage.length + faults.length + todos.length;
    let mode = 'merge';
    if (remoteCount && localCount) {
      mode = confirm(
        `Your synced data has ${remoteCount} items. This device has ${localCount}.\n\n` +
        'OK: use the synced data on this device (recommended).\n' +
        'Cancel: combine both. If this device has copies of the same items from an import, you’ll see doubles.'
      ) ? 'replace-local' : 'merge';
    }
    renderSync();
    await sync.run(mode);
    toast(sync.status === 'ok' ? 'Sync is on' : 'Connected. Sync will retry.');
  } catch (e) {
    err.textContent = e.message || 'Couldn’t connect.';
    err.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Connect';
  }
});

document.getElementById('sync-now').addEventListener('click', () => sync.run());
document.getElementById('sync-disconnect').addEventListener('click', () => {
  if (!confirm('Turn off sync on this device? Your data stays here; it just stops matching your other device. You’ll need the access key to turn it back on.')) return;
  sync.disconnect();
  updateBackupStatus();
  toast('Sync turned off on this device');
});

// When to sync: on open, when you come back to the app, when the
// connection returns, and every 2 minutes while the app is on screen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync.run();
});
window.addEventListener('online', () => sync.run());
setInterval(() => {
  if (document.visibilityState === 'visible' && navigator.onLine) sync.run();
}, 2 * 60 * 1000);
setInterval(() => { if (sync.status === 'ok') renderSync(); }, 30 * 1000); // keep "synced 3 min ago" fresh

/* ---------- Start ---------- */
showView();
Promise.all([loadGarage(), loadFaults(), loadTodos()]).then(() => sync.run());
renderSync();
setTheme(getTheme());
updateNetStatus();
requestPersistentStorage().then(refreshFacts);
registerServiceWorker();
