'use strict';

/* ---------- On-device database (IndexedDB) ----------
   Two "stores" (like tables): garage entries and fault codes.
   Everything here returns a Promise. */
const DB_NAME = 'z4log';
const DB_VERSION = 1;
const STORES = ['garage', 'faults'];

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
    req.onsuccess = () => resolve(req.result);
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

const db = {
  getAll: (store) => withStores([store], 'readonly', (s) => s[store].getAll()),
  put: (store, item) => withStores([store], 'readwrite', (s) => { s[store].put(item); }),
  remove: (store, id) => withStores([store], 'readwrite', (s) => { s[store].delete(id); }),

  // Wipes both stores and loads the given records, all-or-nothing.
  replaceAll: (data) => withStores(STORES, 'readwrite', (s) => {
    for (const name of STORES) {
      s[name].clear();
      for (const item of data[name] || []) s[name].put(item);
    }
  }),
};

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
