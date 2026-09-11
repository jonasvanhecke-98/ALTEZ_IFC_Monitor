const CACHE_KEY = 'altez-ifc-monitor:v1:cache';
const RESULTS_KEY = 'altez-ifc-monitor:v1:last-results';

function safeGet(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

function safeRemove(key) {
  try { localStorage.removeItem(key); return true; }
  catch { return false; }
}

export function versionKey(projectId, file, targetPset) {
  const version = file.versionId ?? file.version ?? file.modifiedOn ?? file.updatedAt ?? 'latest';
  return `${String(targetPset).toLowerCase()}::${projectId}::${file.id}::${version}`;
}

export function loadCache() {
  try {
    const value = JSON.parse(safeGet(CACHE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function saveCache(cache) {
  const entries = Object.entries(cache);
  const compact = entries.length > 5000 ? Object.fromEntries(entries.slice(-5000)) : cache;
  return safeSet(CACHE_KEY, JSON.stringify(compact));
}

export function clearCache() {
  return safeRemove(CACHE_KEY);
}

export function saveLastResults(payload) {
  return safeSet(RESULTS_KEY, JSON.stringify(payload));
}

export function loadLastResults() {
  try { return JSON.parse(safeGet(RESULTS_KEY) || 'null'); }
  catch { return null; }
}
