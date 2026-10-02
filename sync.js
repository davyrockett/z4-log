'use strict';

/* ---------- Sync with a private GitHub project ----------
   Your data lives in one file, data.json, in a private GitHub project
   (e.g. davyrockett/z4-log-data). Each device:
     1. downloads data.json,
     2. merges it with what's on the device (newest edit of each item wins;
        deletions are remembered so they don't come back),
     3. uploads the result if anything changed.
   GitHub keeps every upload as a version, so there's a full history.
   The access key stays on this device only (browser storage). */

const SYNC_FILE = 'data.json';
const SYNC_KEYS = {
  repo: 'z4log-sync-repo',
  token: 'z4log-sync-token',
  last: 'z4log-sync-last', // time of the last successful sync
};

function syncGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function syncSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {}
}

class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'auth' | 'offline' | 'missing' | 'conflict' | 'other'
  }
}

/* --- Talking to GitHub --- */

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function github(repo, token, path, options = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (e) {
    throw new SyncError('offline', 'No connection. Will sync when you’re back online.');
  }
  if (res.status === 401) throw new SyncError('auth', 'The access key isn’t working (expired or mistyped).');
  if (res.status === 403) throw new SyncError('auth', 'The access key doesn’t have permission to read and write this project.');
  return res;
}

// Returns { data, sha } — data is null if the project has no data.json yet.
async function downloadData(repo, token) {
  const res = await github(repo, token, `/contents/${SYNC_FILE}`);
  if (res.status === 404) {
    const repoRes = await github(repo, token, '');
    if (repoRes.status === 404) throw new SyncError('missing', `Can’t find the project “${repo}”. Check the name, and that the key includes it.`);
    return { data: null, sha: null };
  }
  if (!res.ok) throw new SyncError('other', `GitHub said ${res.status} when downloading.`);
  const body = await res.json();
  return { data: JSON.parse(fromBase64(body.content)), sha: body.sha };
}

async function uploadData(repo, token, data, sha) {
  const device = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Macintosh/.test(navigator.userAgent) ? 'Mac' : 'device';
  const res = await github(repo, token, `/contents/${SYNC_FILE}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Sync from ${device}`,
      content: toBase64(JSON.stringify(data, null, 2) + '\n'),
      ...(sha ? { sha } : {}),
    }),
  });
  // 409/422: someone else uploaded first. Caller downloads again and retries.
  if (res.status === 409 || res.status === 422) throw new SyncError('conflict', 'Changed on another device at the same moment.');
  if (!res.ok) throw new SyncError('other', `GitHub said ${res.status} when uploading.`);
}

/* --- Merging --- */

// Combines two copies. For each item the newest edit wins; a deletion wins
// over any edit made before it.
function mergeCopies(a, b) {
  const deleted = new Map();
  for (const t of [...(a.deleted || []), ...(b.deleted || [])]) {
    const prev = deleted.get(t.id);
    if (!prev || t.deletedAt > prev.deletedAt) deleted.set(t.id, t);
  }
  const out = {};
  for (const name of STORES) {
    const byId = new Map();
    for (const r of [...(a[name] || []), ...(b[name] || [])]) {
      const prev = byId.get(r.id);
      if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) byId.set(r.id, r);
    }
    out[name] = [...byId.values()].filter((r) => {
      const t = deleted.get(r.id);
      return !t || (r.updatedAt || '') > t.deletedAt;
    });
  }
  const alive = new Set(STORES.flatMap((n) => out[n].map((r) => r.id)));
  out.deleted = [...deleted.values()].filter((t) => !alive.has(t.id));
  return out;
}

// Same content, ignoring order?
function sameData(a, b) {
  const canon = (d) => JSON.stringify(ALL_STORES.map((n) =>
    [...((d && d[n]) || [])].sort((x, y) => x.id.localeCompare(y.id))));
  return canon(a) === canon(b);
}

function remoteShape(merged) {
  return { app: 'z4-log', format: 2, ...Object.fromEntries(ALL_STORES.map((n) => [n, merged[n]])) };
}

/* --- The sync process --- */

const sync = {
  status: 'off', // 'off' | 'syncing' | 'ok' | error kind
  message: '',
  onStatus: () => {},  // app redraws the status line
  onUpdated: () => {}, // app reloads lists when sync brought in changes

  isOn: () => Boolean(syncGet(SYNC_KEYS.repo) && syncGet(SYNC_KEYS.token)),
  repo: () => syncGet(SYNC_KEYS.repo),
  lastSynced: () => syncGet(SYNC_KEYS.last),

  setStatus(status, message = '') {
    this.status = status;
    this.message = message;
    this.onStatus();
  },

  // mode 'merge' (normal) or 'replace-local' (first connect: take what's on GitHub)
  async run(mode = 'merge') {
    if (!this.isOn()) return this.setStatus('off');
    if (this.running) { this.again = true; return; }
    this.running = true;
    this.setStatus('syncing');
    const repo = syncGet(SYNC_KEYS.repo);
    const token = syncGet(SYNC_KEYS.token);
    try {
      for (let attempt = 1; ; attempt++) {
        const { data: remote, sha } = await downloadData(repo, token);
        const before = await db.snapshot();
        const merged = await db.merge((local) => {
          if (mode === 'replace-local' && remote) return mergeCopies({}, remote);
          return mergeCopies(local, remote || {});
        });
        if (!sameData(before, merged)) this.onUpdated();
        if (sameData(remote, merged)) break; // GitHub already has it all
        try {
          await uploadData(repo, token, remoteShape(merged), sha);
          break;
        } catch (e) {
          if (e.kind !== 'conflict' || attempt >= 3) throw e;
          mode = 'merge'; // someone uploaded in between: merge their version too
        }
      }
      syncSet(SYNC_KEYS.last, new Date().toISOString());
      this.setStatus('ok');
    } catch (e) {
      this.setStatus(e.kind || 'other', e.message);
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.run(); }
    }
  },

  // Called after you save something: sync shortly, batching quick edits.
  soon() {
    if (!this.isOn()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 1500);
  },

  // Checks a key and project before saving them. Returns { remoteCount }.
  async connect(repo, token) {
    const { data } = await downloadData(repo, token); // throws if wrong
    syncSet(SYNC_KEYS.repo, repo);
    syncSet(SYNC_KEYS.token, token);
    syncSet(SYNC_KEYS.last, null);
    return { remoteCount: data ? STORES.reduce((n, s) => n + (data[s] || []).length, 0) : 0 };
  },

  disconnect() {
    syncSet(SYNC_KEYS.token, null);
    syncSet(SYNC_KEYS.repo, null);
    syncSet(SYNC_KEYS.last, null);
    this.setStatus('off');
  },
};
