'use strict';

/* ---------- On-device database (IndexedDB) ----------
   Three "stores" (like tables) for your data: garage entries, faults & warnings,
   to-dos. A fourth, "deleted", remembers what was deleted and when, so sync can
   tell the other device to delete it too.
   Everything here returns a Promise. */
const DB_NAME = 'z4log';
const DB_VERSION = 3; // 2: added to-dos. 3: added deleted (for sync)
const STORES = ['garage', 'faults', 'todos'];
const ALL_STORES = [...STORES, 'deleted'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ALL_STORES) {
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

// Reads every store inside an open transaction, then calls done(everything).
function readAll(stores, done) {
  const data = {};
  let pending = ALL_STORES.length;
  for (const name of ALL_STORES) {
    const req = stores[name].getAll();
    req.onsuccess = () => {
      data[name] = req.result;
      if (--pending === 0) done(data);
    };
  }
}

function writeAll(stores, data) {
  for (const name of ALL_STORES) {
    stores[name].clear();
    for (const item of data[name] || []) stores[name].put(item);
  }
}

// Calls db.onChange() after any successful write you make (sync and the
// backup reminder listen for this).
function changed(promise) {
  return promise.then((result) => { db.onChange(); return result; });
}

const db = {
  onChange: () => {},

  getAll: (store) => withStores([store], 'readonly', (s) => s[store].getAll()),

  put: (store, item) => changed(withStores([store, 'deleted'], 'readwrite', (s) => {
    s[store].put(item);
    s.deleted.delete(item.id);
  })),

  remove: (store, id) => changed(withStores([store, 'deleted'], 'readwrite', (s) => {
    s[store].delete(id);
    s.deleted.put({ id, store, deletedAt: new Date().toISOString() });
  })),

  // Import: replaces everything with the given records, all-or-nothing.
  // Anything that was here but isn't in the file is recorded as deleted,
  // so sync removes it from your other devices too.
  replaceAll: (data) => changed(withStores(ALL_STORES, 'readwrite', (s) => {
    readAll(s, (current) => {
      const now = new Date().toISOString();
      const incoming = new Set(STORES.flatMap((n) => (data[n] || []).map((r) => r.id)));
      const deleted = [...current.deleted.filter((t) => !incoming.has(t.id))];
      for (const name of STORES) {
        for (const r of current[name]) {
          if (!incoming.has(r.id)) deleted.push({ id: r.id, store: name, deletedAt: now });
        }
      }
      writeAll(s, { ...data, deleted });
    });
  })),

  // Sync: reads everything, lets combine(local) decide the result, writes it
  // back, all in one step so nothing you save can slip in between.
  // Resolves with what was written. Doesn't count as your change.
  merge: async (combine) => {
    let result;
    await withStores(ALL_STORES, 'readwrite', (s) => {
      readAll(s, (local) => {
        result = combine(local);
        writeAll(s, result);
      });
    });
    return result;
  },

  // Everything at once (for sync checks)
  snapshot: async () => {
    let result;
    await withStores(ALL_STORES, 'readonly', (s) => readAll(s, (d) => { result = d; }));
    return result;
  },
};

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
