const CACHE_KEY = 'altez-ifc-monitor:v1:cache';
const RESULTS_KEY = 'altez-ifc-monitor:v1:last-results';
const PROJECT_LIST_PREFIX = 'altez-ifc-monitor:v1.2:projects:';

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

export function saveProjectListCache(regionSelection, projects, meta = {}) {
  const compact = (projects || []).map(p => ({
    id: p.id,
    name: p.name,
    rootId: p.rootId || null,
    _apiBase: p._apiBase,
    _regionKey: p._regionKey,
    _regionLabel: p._regionLabel
  }));
  const payload = {
    savedAt: Date.now(),
    projects: compact,
    page: Number(meta.page) || null,
    pageSize: Number(meta.pageSize) || null,
    hasMore: meta.hasMore !== false,
    total: Number.isFinite(meta.total) ? meta.total : null
  };
  return safeSet(`${PROJECT_LIST_PREFIX}${regionSelection}`, JSON.stringify(payload));
}

export function loadProjectListCache(regionSelection, maxAgeMs = 30 * 60 * 1000) {
  try {
    const value = JSON.parse(safeGet(`${PROJECT_LIST_PREFIX}${regionSelection}`) || 'null');
    if (!value || !Array.isArray(value.projects) || !Number.isFinite(value.savedAt)) return null;
    const ageMs = Date.now() - value.savedAt;
    if (ageMs < 0 || ageMs > maxAgeMs) return null;
    return { ...value, ageMs };
  } catch {
    return null;
  }
}
