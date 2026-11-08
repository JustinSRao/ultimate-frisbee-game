// ============================================================================
// STORAGE: device-local persistence.
// Web: localStorage. Tauri: the store plugin (a JSON file in the app data dir),
// mirrored into memory so reads stay synchronous. initStorage() must resolve
// before the first read.
// ============================================================================
import { DEFAULTS } from '../../shared/config.js';

const KEY = 'wul-ultimate-v1';
const mem = new Map();
let tauriStore = null;

function ls() { try { return window.localStorage; } catch (e) { return null; } }

export async function initStorage() {
  const T = typeof window !== 'undefined' && window.__TAURI__;
  if (T && T.store && T.store.load) {
    try {
      tauriStore = await T.store.load('wul-settings.json', { defaults: {}, autoSave: 200 });
      for (const [k, v] of await tauriStore.entries()) mem.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      return;
    } catch (e) { tauriStore = null; }
  }
  const s = ls(); if (!s) return;
  try { for (let i = 0; i < s.length; i++) { const k = s.key(i); mem.set(k, s.getItem(k)); } } catch (e) { }
}

export function getItem(k) { return mem.has(k) ? mem.get(k) : null; }
export function setItem(k, v) {
  mem.set(k, v);
  if (tauriStore) { tauriStore.set(k, v).catch(() => { }); return; }
  try { ls()?.setItem(k, v); } catch (e) { }
}
export function removeItem(k) {
  mem.delete(k);
  if (tauriStore) { tauriStore.delete(k).catch(() => { }); return; }
  try { ls()?.removeItem(k); } catch (e) { }
}
export function getJSON(k, fallback = null) { try { const r = getItem(k); return r ? JSON.parse(r) : fallback; } catch (e) { return fallback; } }
export function setJSON(k, v) { setItem(k, JSON.stringify(v)); }

export function loadSaved() {
  const out = { athlete: { ...DEFAULTS.athlete }, settings: { ...DEFAULTS.settings } };
  const j = getJSON(KEY);
  if (j) { Object.assign(out.athlete, j.athlete || {}); Object.assign(out.settings, j.settings || {}); }
  return out;
}
export function save(state) { setJSON(KEY, { athlete: state.athlete, settings: state.settings }); }

// Online identity: a random player ID plus a display name, both stored on the device. No accounts.
export function playerId() {
  let id = getItem('wul-player-id');
  if (!id) {
    const b = new Uint8Array(12); crypto.getRandomValues(b);
    id = 'p_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    setItem('wul-player-id', id);
  }
  return id;
}
