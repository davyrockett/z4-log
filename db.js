'use strict';

/* ---------- On-device database (IndexedDB) ----------
   Three "stores" (like tables): garage entries, faults & warnings, to-dos.
   Everything here returns a Promise. */
const DB_NAME = 'z4log';
const DB_VERSION = 2; // 2: added to-dos
const STORES = ['garage', 'faults', 'todos'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app (in another tab) needs to upgrade the database:
      // close this copy and reload so it picks up the new version too.
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Runs fn(stores) inside one transaction; resolves when everything is saved.
async function withStores(names, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    const ret = fn(stores);
    if (ret && 'onsuccess' in ret) ret.onsuccess = () => { result = ret.result; };
  });
}

// Calls db.onChange() after any successful write (used for the backup reminder).
function changed(promise) {
  return promise.then((result) => { db.onChange(); return result; });
}

const db = {
  onChange: () => {},

  getAll: (store) => withStores([store], 'readonly', (s) => s[store].getAll()),
  put: (store, item) => changed(withStores([store], 'readwrite', (s) => { s[store].put(item); })),
  remove: (store, id) => changed(withStores([store], 'readwrite', (s) => { s[store].delete(id); })),

  // Wipes both stores and loads the given records, all-or-nothing.
  replaceAll: (data) => changed(withStores(STORES, 'readwrite', (s) => {
    for (const name of STORES) {
      s[name].clear();
      for (const item of data[name] || []) s[name].put(item);
    }
  })),
};

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
