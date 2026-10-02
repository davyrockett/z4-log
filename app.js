'use strict';

const APP_VERSION = '0.1.0';

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

/* ---------- Start ---------- */
showView();
setTheme(getTheme());
updateNetStatus();
requestPersistentStorage().then(refreshFacts);
registerServiceWorker();
