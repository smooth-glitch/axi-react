// Browser-side storage (IndexedDB); there is no backend. Five object stores with out-of-line keys:
//   structs   <structId>              -> struct definition
//   records   <structId>:<recordId>   -> record
//   options   <optionId>              -> option
//   files     <fileId>                -> file metadata (name, size, type, ...)
//   blobs     <fileId>                -> the file itself (a Blob)
// If IndexedDB is unavailable (some private modes, very old browsers) an in-memory Map is used instead, so the app
// still works for the lifetime of the page - it just does not persist.
const STORES = ['structs', 'records', 'options', 'files', 'blobs'];

let dbName = 'tstruct';
let opened = null; // Promise<IDBDatabase | null>  (null = use the memory fallback)
const memory = Object.fromEntries(STORES.map((s) => [s, new Map()]));

// Which database to use. A host can namespace its data with configure({ storageName }).
export function setStorageName(name) {
  const next = String(name || 'tstruct');
  if (next === dbName) return;
  dbName = next;
  opened = null;
}
export const getStorageName = () => dbName;

function open() {
  if (opened) return opened;
  opened = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try {
      req = indexedDB.open(dbName, 1);
    } catch (e) {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // let another tab upgrade / delete the database
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return opened;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function run(store, mode, fn) {
  const db = await open();
  if (!db) return null;
  const tx = db.transaction(store, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const result = await fn(tx.objectStore(store));
  await done;
  return result;
}

// key prefix -> IDBKeyRange (all keys that start with the prefix)
const prefixRange = (prefix) => IDBKeyRange.bound(prefix, `${prefix}￿`);
const inPrefix = (key, prefix) => typeof key === 'string' && key.startsWith(prefix);

export const db = {
  async get(store, key) {
    const db = await open();
    if (!db) return memory[store].get(key);
    return run(store, 'readonly', (s) => wrap(s.get(key)));
  },

  async put(store, key, value) {
    const db = await open();
    if (!db) {
      memory[store].set(key, value);
      return;
    }
    await run(store, 'readwrite', (s) => wrap(s.put(value, key)));
  },

  async del(store, key) {
    const db = await open();
    if (!db) {
      memory[store].delete(key);
      return;
    }
    await run(store, 'readwrite', (s) => wrap(s.delete(key)));
  },

  // every value in the store (or only those whose key starts with `prefix`)
  async all(store, prefix) {
    const db = await open();
    if (!db) return [...memory[store]].filter(([k]) => !prefix || inPrefix(k, prefix)).map(([, v]) => v);
    return run(store, 'readonly', (s) => wrap(s.getAll(prefix ? prefixRange(prefix) : undefined)));
  },

  async count(store, prefix) {
    const db = await open();
    if (!db) return [...memory[store].keys()].filter((k) => !prefix || inPrefix(k, prefix)).length;
    return run(store, 'readonly', (s) => wrap(s.count(prefix ? prefixRange(prefix) : undefined)));
  },
};
