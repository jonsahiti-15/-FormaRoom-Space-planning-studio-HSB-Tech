(function (App) {
  'use strict';

  const C = App.CONFIG.STORAGE;
  const U = App.Util;
  const MAX_ASSET_URL_CACHE = 200;

  const state = {
    initialized: false,
    local: false,
    idb: false,
    db: null,
    errors: [],
    memory: {
      current: null,
      designs: new Map(),
      catalog: null,
      home: null,
      assets: new Map()
    },
    assetUrlCache: new Map()
  };

  function addError(message) {
    if (!message) return;
    if (state.errors.indexOf(message) === -1) state.errors.push(message);
  }

  function testLocalStorage() {
    try {
      const key = '__formaroom_probe__';
      localStorage.setItem(key, '1');
      const ok = localStorage.getItem(key) === '1';
      localStorage.removeItem(key);
      return ok;
    } catch (err) {
      addError('Browser localStorage is unavailable: ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  function openDatabase() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) {
        addError('IndexedDB is unavailable in this browser.');
        resolve(false);
        return;
      }
      let settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        resolve(ok);
      }
      try {
        const request = indexedDB.open(C.DB_NAME, 1);
        request.onupgradeneeded = function () {
          const db = request.result;
          if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs');
          if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
        };
        request.onsuccess = function () {
          state.db = request.result;
          state.db.onversionchange = function () { try { state.db.close(); } catch (err) { /* ignore */ } };
          done(true);
        };
        request.onerror = function () {
          addError('Could not open the local backup database: ' + (request.error && request.error.message ? request.error.message : 'unknown error'));
          done(false);
        };
        request.onblocked = function () {
          addError('The local backup database is blocked by another tab.');
          done(false);
        };
        setTimeout(function () { if (!settled) { addError('Opening the local backup database timed out.'); done(false); } }, 5000);
      } catch (err) {
        addError('Could not access IndexedDB: ' + (err && err.message ? err.message : err));
        done(false);
      }
    });
  }

  function idbOperation(storeName, mode, operation) {
    return new Promise(function (resolve, reject) {
      if (!state.db) { reject(new Error('Backup store is unavailable.')); return; }
      let tx;
      try {
        tx = state.db.transaction(storeName, mode);
      } catch (err) { reject(err); return; }
      let request;
      let result;
      try {
        request = operation(tx.objectStore(storeName));
      } catch (err) { reject(err); return; }
      if (request && 'onsuccess' in request) {
        request.onsuccess = function () {
          result = request.result;
          if (mode === 'readonly') resolve(result);
        };
        request.onerror = function () { reject(request.error || new Error('Backup storage request failed.')); };
      }
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error || new Error('Backup storage write failed.')); };
      tx.onabort = function () { reject(tx.error || new Error('Backup storage write was aborted.')); };
    });
  }

  async function init() {
    state.local = testLocalStorage();
    state.idb = await openDatabase();
    state.initialized = true;
    return getHealth();
  }

  function getHealth() {
    const persistent = state.local || state.idb;
    let mode = 'session';
    if (state.local && state.idb) mode = 'dual';
    else if (state.local) mode = 'local';
    else if (state.idb) mode = 'idb';
    return {
      initialized: state.initialized,
      local: state.local,
      idb: state.idb,
      persistent: persistent,
      mode: mode,
      errors: state.errors.slice()
    };
  }

  function readLocalJSON(key) {
    if (!state.local) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      addError('A saved local record could not be read: ' + (err && err.message ? err.message : err));
      return null;
    }
  }

  function writeLocalJSON(key, value) {
    if (!state.local) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      addError('Could not write to browser storage (it may be full): ' + (err && err.message ? err.message : err));
      return false;
    }
  }

  function makeCurrentEnvelope(design) {
    return { kind: 'current', design: U.deepClone(design), savedAt: new Date().toISOString() };
  }

  async function saveCurrent(design) {
    if (!design) return { ok: false, local: false, idb: false, savedAt: null };
    const envelope = makeCurrentEnvelope(design);
    state.memory.current = envelope;
    const local = writeLocalJSON(C.CURRENT_KEY, envelope);
    let idb = false;
    if (state.idb) {
      try {
        await idbOperation('designs', 'readwrite', function (store) { return store.put(envelope, 'current'); });
        idb = true;
      } catch (err) {
        addError('Backup save failed: ' + (err && err.message ? err.message : err));
      }
    }
    return { ok: local || idb, local: local, idb: idb, savedAt: envelope.savedAt };
  }

  function saveCurrentSync(design) {
    if (!design) return false;
    const envelope = makeCurrentEnvelope(design);
    state.memory.current = envelope;
    return writeLocalJSON(C.CURRENT_KEY, envelope);
  }

  function envelopeTime(env) {
    if (!env || !env.savedAt) return 0;
    const time = new Date(env.savedAt).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  async function loadCurrent() {
    const candidates = [];
    state.memory.current && candidates.push({ source: 'memory', env: state.memory.current });
    const local = readLocalJSON(C.CURRENT_KEY);
    if (local && local.design) candidates.push({ source: 'local', env: local });
    if (state.idb) {
      try {
        const stored = await idbOperation('designs', 'readonly', function (store) { return store.get('current'); });
        if (stored && stored.design) candidates.push({ source: 'idb', env: stored });
      } catch (err) {
        addError('Could not read the autosaved design backup: ' + (err && err.message ? err.message : err));
      }
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return envelopeTime(b.env) - envelopeTime(a.env); });
    return { design: candidates[0].env.design, savedAt: candidates[0].env.savedAt, source: candidates[0].source };
  }

  function readLocalDesignMap() {
    const map = readLocalJSON(C.DESIGNS_KEY);
    return map && typeof map === 'object' ? map : {};
  }

  async function saveDesign(design) {
    if (!design) throw new Error('There is no design to save.');
    const envelope = {
      kind: 'saved',
      id: design.id,
      design: U.deepClone(design),
      savedAt: new Date().toISOString()
    };
    const map = readLocalDesignMap();
    map[design.id] = envelope;
    const local = writeLocalJSON(C.DESIGNS_KEY, map);
    let idb = false;
    if (state.idb) {
      try {
        await idbOperation('designs', 'readwrite', function (store) { return store.put(envelope, 'saved:' + design.id); });
        idb = true;
      } catch (err) {
        addError('Saved design backup failed: ' + (err && err.message ? err.message : err));
      }
    }
    state.memory.designs.set(design.id, envelope);
    return { ok: local || idb, local: local, idb: idb, savedAt: envelope.savedAt };
  }

  async function listDesigns() {
    const byId = new Map();
    const localMap = readLocalDesignMap();
    Object.keys(localMap).forEach(function (id) {
      const env = localMap[id];
      if (env && env.design && env.design.id) {
        byId.set(env.design.id, { source: 'local', env: env });
      }
    });
    state.memory.designs.forEach(function (env, id) {
      if (env && env.design) {
        const existing = byId.get(id);
        if (!existing || envelopeTime(env) > envelopeTime(existing.env)) byId.set(id, { source: 'memory', env: env });
      }
    });
    if (state.idb) {
      try {
        const all = await idbOperation('designs', 'readonly', function (store) { return store.getAll(); });
        (all || []).forEach(function (env) {
          if (env && env.kind === 'saved' && env.design && env.design.id) {
            const existing = byId.get(env.design.id);
            if (!existing || envelopeTime(env) > envelopeTime(existing.env)) byId.set(env.design.id, { source: 'idb', env: env });
          }
        });
      } catch (err) {
        addError('Could not list saved designs from backup storage: ' + (err && err.message ? err.message : err));
      }
    }
    return Array.from(byId.values()).map(function (entry) { return entry.env; })
      .sort(function (a, b) { return envelopeTime(b) - envelopeTime(a); });
  }

  async function getDesign(id) {
    const localMap = readLocalDesignMap();
    const candidates = [];
    if (localMap[id]) candidates.push(localMap[id]);
    if (state.memory.designs.has(id)) candidates.push(state.memory.designs.get(id));
    if (state.idb) {
      try {
        const env = await idbOperation('designs', 'readonly', function (store) { return store.get('saved:' + id); });
        if (env) candidates.push(env);
      } catch (err) {
        addError('Could not read the saved design: ' + (err && err.message ? err.message : err));
      }
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return envelopeTime(b) - envelopeTime(a); });
    return candidates[0];
  }

  async function deleteDesign(id) {
    const map = readLocalDesignMap();
    if (map[id]) {
      delete map[id];
      writeLocalJSON(C.DESIGNS_KEY, map);
    }
    state.memory.designs.delete(id);
    if (state.idb) {
      try {
        await idbOperation('designs', 'readwrite', function (store) { return store.delete('saved:' + id); });
      } catch (err) {
        addError('Could not remove the design from backup storage: ' + (err && err.message ? err.message : err));
      }
    }
    return true;
  }

  async function saveCatalogMeta(meta) {
    const envelope = { kind: 'catalog', meta: meta, savedAt: new Date().toISOString() };
    state.memory.catalog = envelope;
    const local = writeLocalJSON(C.CATALOG_KEY, envelope);
    let idb = false;
    if (state.idb) {
      try {
        await idbOperation('designs', 'readwrite', function (store) { return store.put(envelope, 'catalog'); });
        idb = true;
      } catch (err) {
        addError('Catalog metadata backup failed: ' + (err && err.message ? err.message : err));
      }
    }
    return { local: local, idb: idb };
  }

  async function loadCatalogMeta() {
    const candidates = [];
    if (state.memory.catalog) candidates.push(state.memory.catalog);
    const local = readLocalJSON(C.CATALOG_KEY);
    if (local && local.meta) candidates.push(local);
    if (state.idb) {
      try {
        const stored = await idbOperation('designs', 'readonly', function (store) { return store.get('catalog'); });
        if (stored && stored.meta) candidates.push(stored);
      } catch (err) {
        addError('Could not read catalog metadata backup: ' + (err && err.message ? err.message : err));
      }
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return envelopeTime(b) - envelopeTime(a); });
    return candidates[0].meta;
  }

  async function saveAsset(blob, info) {
    const key = U.uid('asset');
    const record = {
      key: key,
      blob: blob,
      name: info && info.name || 'asset',
      type: info && info.type || (blob && blob.type) || 'application/octet-stream',
      savedAt: new Date().toISOString()
    };
    state.memory.assets.set(key, record);
    let persisted = false;
    if (state.idb) {
      try {
        await idbOperation('assets', 'readwrite', function (store) { return store.put(record, key); });
        persisted = true;
      } catch (err) {
        addError('Asset could not be stored persistently: ' + (err && err.message ? err.message : err));
      }
    }
    return { key: key, persisted: persisted, name: record.name, type: record.type };
  }

  async function getAsset(key) {
    if (!key) return null;
    if (state.memory.assets.has(key)) return state.memory.assets.get(key);
    if (state.idb) {
      try {
        const record = await idbOperation('assets', 'readonly', function (store) { return store.get(key); });
        if (record) {
          state.memory.assets.set(key, record);
          return record;
        }
      } catch (err) {
        addError('Could not read product asset: ' + (err && err.message ? err.message : err));
      }
    }
    return null;
  }

  async function deleteAsset(key) {
    if (!key) return;
    state.memory.assets.delete(key);
    if (state.assetUrlCache.has(key)) {
      try { URL.revokeObjectURL(state.assetUrlCache.get(key)); } catch (err) { /* ignore */ }
      state.assetUrlCache.delete(key);
    }
    if (state.idb) {
      try {
        await idbOperation('assets', 'readwrite', function (store) { return store.delete(key); });
      } catch (err) {
        addError('Could not remove product asset: ' + (err && err.message ? err.message : err));
      }
    }
  }

  async function getAssetURL(key) {
    if (!key) return null;
    if (state.assetUrlCache.has(key)) return state.assetUrlCache.get(key);
    const record = await getAsset(key);
    if (!record || !record.blob) return null;
    const url = URL.createObjectURL(record.blob);
    if (state.assetUrlCache.size >= MAX_ASSET_URL_CACHE) {
      const firstKey = state.assetUrlCache.keys().next().value;
      try { URL.revokeObjectURL(state.assetUrlCache.get(firstKey)); } catch (err) { /* ignore */ }
      state.assetUrlCache.delete(firstKey);
    }
    state.assetUrlCache.set(key, url);
    return url;
  }

  function invalidateAssetURL(key) {
    if (!key) return;
    if (state.assetUrlCache.has(key)) {
      try { URL.revokeObjectURL(state.assetUrlCache.get(key)); } catch (err) { /* ignore */ }
      state.assetUrlCache.delete(key);
    }
  }

  async function saveHome(home) {
    if (!home) return { ok: false, local: false, idb: false, savedAt: null };
    const envelope = { kind: 'home', home: U.deepClone(home), savedAt: new Date().toISOString() };
    state.memory.home = envelope;
    const local = writeLocalJSON(C.HOME_KEY, envelope);
    let idb = false;
    if (state.idb) {
      try {
        await idbOperation('designs', 'readwrite', function (store) { return store.put(envelope, 'home'); });
        idb = true;
      } catch (err) {
        addError('Whole Home backup save failed: ' + (err && err.message ? err.message : err));
      }
    }
    return { ok: local || idb, local: local, idb: idb, savedAt: envelope.savedAt };
  }

  function saveHomeSync(home) {
    if (!home) return false;
    const envelope = { kind: 'home', home: U.deepClone(home), savedAt: new Date().toISOString() };
    state.memory.home = envelope;
    return writeLocalJSON(C.HOME_KEY, envelope);
  }

  async function loadHome() {
    const candidates = [];
    if (state.memory.home && state.memory.home.home) candidates.push({ source: 'memory', env: state.memory.home });
    const local = readLocalJSON(C.HOME_KEY);
    if (local && local.home) candidates.push({ source: 'local', env: local });
    if (state.idb) {
      try {
        const stored = await idbOperation('designs', 'readonly', function (store) { return store.get('home'); });
        if (stored && stored.home) candidates.push({ source: 'idb', env: stored });
      } catch (err) {
        addError('Could not read the Whole Home backup: ' + (err && err.message ? err.message : err));
      }
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return envelopeTime(b.env) - envelopeTime(a.env); });
    return { home: candidates[0].env.home, savedAt: candidates[0].env.savedAt, source: candidates[0].source };
  }

  function buildDesignBackup(design) {
    return JSON.stringify({
      format: 'formaroom-design',
      version: 1,
      appVersion: App.CONFIG.APP_VERSION,
      exportedAt: new Date().toISOString(),
      design: design
    }, null, 2);
  }

  function parseDesignBackup(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.format !== 'formaroom-design' || !parsed.design) {
      throw new Error('This file is not a FormaRoom design backup.');
    }
    return parsed.design;
  }

  function buildHomeBackup(home, designs) {
    return JSON.stringify({
      format: 'formaroom-home',
      version: 1,
      appVersion: App.CONFIG.APP_VERSION,
      exportedAt: new Date().toISOString(),
      home: home,
      designs: designs || []
    }, null, 2);
  }

  function parseHomeBackup(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.format !== 'formaroom-home' || !parsed.home) {
      throw new Error('This file is not a FormaRoom Whole Home backup.');
    }
    const designs = (Array.isArray(parsed.designs) ? parsed.designs : []).filter(function (design) {
      return design && design.id && design.room;
    });
    return { home: parsed.home, designs: designs, exportedAt: parsed.exportedAt || null };
  }

  App.Storage = {
    init: init,
    getHealth: getHealth,
    saveCurrent: saveCurrent,
    saveCurrentSync: saveCurrentSync,
    loadCurrent: loadCurrent,
    saveDesign: saveDesign,
    listDesigns: listDesigns,
    getDesign: getDesign,
    deleteDesign: deleteDesign,
    saveCatalogMeta: saveCatalogMeta,
    loadCatalogMeta: loadCatalogMeta,
    saveHome: saveHome,
    saveHomeSync: saveHomeSync,
    loadHome: loadHome,
    saveAsset: saveAsset,
    getAsset: getAsset,
    deleteAsset: deleteAsset,
    getAssetURL: getAssetURL,
    invalidateAssetURL: invalidateAssetURL,
    buildDesignBackup: buildDesignBackup,
    parseDesignBackup: parseDesignBackup,
    buildHomeBackup: buildHomeBackup,
    parseHomeBackup: parseHomeBackup
  };
})(window.App = window.App || {});
