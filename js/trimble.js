const KNOWN_REGIONS = [
  { key: 'europe', label: 'Europa', origin: 'https://app21.connect.trimble.com' },
  { key: 'north-america', label: 'Noord-Amerika', origin: 'https://app.connect.trimble.com' },
  { key: 'asia', label: 'Azië', origin: 'https://app31.connect.trimble.com' }
];
const MASTER_BASE = 'https://app.connect.trimble.com/tc/api/2.0';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function apiPayload(url, token, signal) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: authHeaders(token), signal });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const suffix = text ? ` — ${text.slice(0, 220)}` : '';
        const error = new Error(`${response.status} ${response.statusText}${suffix}`);
        error.status = response.status;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await sleep(400 * (3 ** attempt), signal);
          continue;
        }
        throw error;
      }

      const text = await response.text();
      if (!text) return {};
      try { return JSON.parse(text); }
      catch { return text; }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      if (attempt < 2 && (error instanceof TypeError || Number(error.status) >= 500)) {
        await sleep(400 * (3 ** attempt), signal);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('Onbekende Trimble API-fout.');
}

function asArray(payload, keys = ['items', 'files', 'projects', 'regions', 'data', 'results', 'value']) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function normalizeApiBase(origin) {
  if (!origin) return null;
  let value = String(origin).replace(/\/$/, '');
  if (!/^https?:\/\//i.test(value)) return null;
  if (!/\/tc\/api\/2\.0$/i.test(value)) value += '/tc/api/2.0';
  return value;
}

function inferRegionKey(raw, origin) {
  const text = `${raw?.name || ''} ${raw?.region || ''} ${raw?.code || ''} ${raw?.id || ''} ${origin || ''}`.toLowerCase();
  if (text.includes('app21.') || text.includes('europe') || text.includes('europa') || /\beu\b/.test(text)) return 'europe';
  if (text.includes('app31.') || text.includes('asia') || /\bas\b/.test(text)) return 'asia';
  if (text.includes('app.connect.trimble.com') || text.includes('north america') || text.includes('america') || text.includes('usa') || text.includes('us')) return 'north-america';
  return null;
}

function normalizeRegion(raw) {
  const origin = raw?.origin || raw?.url || raw?.baseUrl || raw?.apiUrl || raw?.coreApiUrl || raw?.core?.origin;
  const apiBase = normalizeApiBase(origin);
  if (!apiBase) return null;
  const key = inferRegionKey(raw, origin) || `region-${btoa(apiBase).replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()}`;
  const known = KNOWN_REGIONS.find(r => r.key === key);
  return {
    key,
    label: raw?.displayName || raw?.name || known?.label || key,
    origin: String(origin).replace(/\/$/, ''),
    apiBase
  };
}

export function knownRegions() {
  return KNOWN_REGIONS.map(r => ({ ...r, apiBase: normalizeApiBase(r.origin) }));
}

export async function discoverRegions(token, signal) {
  try {
    const payload = await apiPayload(`${MASTER_BASE}/regions`, token, signal);
    const discovered = asArray(payload).map(normalizeRegion).filter(Boolean);
    const byKey = new Map(discovered.map(r => [r.key, r]));
    for (const known of knownRegions()) if (!byKey.has(known.key)) byKey.set(known.key, known);
    return [...byKey.values()];
  } catch {
    return knownRegions();
  }
}

async function resolveRegion(selection, token, signal) {
  const known = knownRegions().find(r => r.key === selection);
  // Fast path: for a specifically chosen known region there is no /regions roundtrip.
  if (known) return known;
  const regions = await discoverRegions(token, signal);
  const region = regions.find(r => r.key === selection);
  if (!region) throw new Error(`Trimble-regio '${selection}' niet gevonden.`);
  return region;
}

function normalizeProject(raw, region) {
  const id = raw.id || raw.projectId || raw.identifier;
  if (!id) return null;
  return {
    ...raw,
    id: String(id),
    name: raw.name || raw.title || String(id),
    rootId: raw.rootId || raw.rootFolderId || raw.root?.id || null,
    _apiBase: region.apiBase,
    _regionKey: region.key,
    _regionLabel: region.label
  };
}

/**
 * Loads exactly one project page for one region. This is the fast UI path.
 * Known regions (Europe/NA/Asia) skip region discovery entirely.
 */
export async function listProjectsPage(selection, token, signal, { page = 1, pageSize = 50 } = {}) {
  const region = await resolveRegion(selection || 'europe', token, signal);
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 50));
  const url = `${region.apiBase}/projects?fullyLoaded=false&page=${safePage}&pageSize=${safePageSize}`;
  const payload = await apiPayload(url, token, signal);
  const rawItems = asArray(payload);
  const projects = rawItems.map(raw => normalizeProject(raw, region)).filter(Boolean);
  const totalRaw = Number(payload?.totalCount ?? payload?.total ?? payload?.count ?? NaN);
  const total = Number.isFinite(totalRaw) ? totalRaw : null;
  const hasMore = total !== null ? safePage * safePageSize < total : rawItems.length >= safePageSize;

  return { projects, page: safePage, pageSize: safePageSize, total, hasMore, region };
}

async function listAllProjectsInRegion(region, token, signal, onBatch) {
  const found = new Map();
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 100) {
    const result = await listProjectsPage(region.key, token, signal, { page, pageSize: 100 });
    const before = found.size;
    for (const project of result.projects) found.set(project.id, project);
    const added = found.size - before;
    onBatch?.(result.projects, { region, page, loaded: found.size, total: result.total });
    hasMore = result.hasMore && added > 0;
    page += 1;
  }
  return [...found.values()];
}

export async function listProjectsForRegionSelection(selection, token, signal, onBatch) {
  if (selection && selection !== 'all') {
    const region = await resolveRegion(selection, token, signal);
    const projects = await listAllProjectsInRegion(region, token, signal, onBatch);
    return { projects: projects.sort((a,b) => a.name.localeCompare(b.name, 'nl')), warnings: [], regions: [region] };
  }

  const regions = await discoverRegions(token, signal);
  const projects = new Map();
  const warnings = [];
  await Promise.all(regions.map(async region => {
    try {
      const items = await listAllProjectsInRegion(region, token, signal, (batch, meta) => {
        for (const project of batch) projects.set(`${project._regionKey}:${project.id}`, project);
        onBatch?.(batch, { ...meta, totalLoaded: projects.size });
      });
      for (const project of items) projects.set(`${project._regionKey}:${project.id}`, project);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      warnings.push(`${region.label}: ${error.message}`);
    }
  }));

  return { projects: [...projects.values()].sort((a,b) => a.name.localeCompare(b.name, 'nl')), warnings, regions };
}

export async function listProjectsAcrossRegions(token, signal, onBatch) {
  return listProjectsForRegionSelection('all', token, signal, onBatch);
}

function likelyFileName(name) {
  return /\.[a-z0-9]{2,8}$/i.test(String(name || ''));
}

function normalizeFile(raw) {
  const id = raw.id || raw.fileId || raw.identifier;
  const name = raw.name || raw.fileName || raw.filename || raw.title;
  if (!id || !name) return null;
  const type = String(raw.fileType || raw.type || raw.entityType || raw.objectType || '').toLowerCase();
  const isFolder = type.includes('folder') || raw.isFolder === true;
  return {
    ...raw,
    id: String(id),
    name: String(name),
    isFolder,
    fileType: raw.fileType || raw.type || (isFolder ? 'FOLDER' : 'FILE'),
    path: raw.path || raw.fullPath || raw.folderPath || null,
    versionId: raw.versionId || raw.latestVersionId || raw.currentVersion?.id || raw.latestVersion?.id || raw.version?.id || null,
    version: typeof raw.version === 'number' || typeof raw.version === 'string' ? raw.version : raw.versionNumber || raw.latestVersion?.version || null,
    modifiedOn: raw.modifiedOn || raw.updatedAt || raw.lastModified || raw.modified || raw.updatedOn || null,
    downloadUrl: raw.downloadUrl || raw.downloadURL || raw.download?.url || null
  };
}

function joinPath(parent, name) {
  const p = String(parent || '/').replace(/\\/g, '/');
  const cleaned = p === '/' ? '' : p.replace(/\/$/, '');
  return `${cleaned}/${name}`.replace(/\/+/g, '/');
}

async function listProjectFilesByPath(project, token, signal) {
  const files = [];
  const queue = ['/'];
  const visited = new Set();

  while (queue.length) {
    const path = queue.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    let previousSignature = '';

    for (let page = 1; page <= 100; page++) {
      const url = `${project._apiBase}/projects/${encodeURIComponent(project.id)}/files?path=${encodeURIComponent(path)}&page=${page}&pageSize=100`;
      const payload = await apiPayload(url, token, signal);
      const rawItems = asArray(payload, ['files', 'items', 'data', 'results', 'value']);
      if (!rawItems.length) break;

      const signature = rawItems.map(r => r.id || r.fileId || r.identifier || '').join('|');
      if (page > 1 && signature && signature === previousSignature) break;
      previousSignature = signature;

      const items = rawItems.map(normalizeFile).filter(Boolean);
      for (const item of items) {
        if (item.isFolder) {
          let childPath = item.path || joinPath(path, item.name);
          const normalized = String(childPath).replace(/\/$/, '');
          if (!(normalized === item.name || normalized.endsWith(`/${item.name}`))) childPath = joinPath(childPath, item.name);
          queue.push(childPath);
        } else {
          files.push(item);
        }
      }

      const total = Number(payload?.totalCount ?? payload?.total ?? NaN);
      if (rawItems.length < 100 || (Number.isFinite(total) && page * 100 >= total)) break;
    }
  }
  return files;
}

async function listProjectFilesByFolderTree(project, token, signal) {
  if (!project.rootId) throw new Error('Project bevat geen rootId voor folder-tree API.');
  const files = [];
  const queue = [project.rootId];
  const visited = new Set();

  while (queue.length) {
    const folderId = queue.shift();
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);
    const payload = await apiPayload(`${project._apiBase}/folders/${encodeURIComponent(folderId)}/items`, token, signal);
    const items = asArray(payload).map(normalizeFile).filter(Boolean);
    for (const item of items) {
      const rawType = String(item.fileType || '').toLowerCase();
      const folderish = item.isFolder || rawType.includes('folder') || (!likelyFileName(item.name) && !rawType.includes('file'));
      if (folderish) queue.push(item.id);
      else files.push(item);
    }
  }
  return files;
}

export async function listProjectFiles(project, token, signal) {
  const errors = [];
  const loaders = project.rootId
    ? [listProjectFilesByFolderTree, listProjectFilesByPath]
    : [listProjectFilesByPath];

  for (const loader of loaders) {
    try {
      const files = await loader(project, token, signal);
      const dedupe = new Map();
      for (const file of files) dedupe.set(file.id, file);
      return [...dedupe.values()];
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      errors.push(`${loader.name}: ${error.message}`);
    }
  }
  throw new Error(`Bestandslijst niet beschikbaar (${errors.join(' | ')}).`);
}

function extractDownloadUrl(payload) {
  if (!payload) return null;
  if (typeof payload === 'string' && /^https?:/i.test(payload.trim())) return payload.trim();
  return payload.downloadUrl || payload.downloadURL || payload.url || payload.href || payload.link ||
    payload.download?.url || payload.currentVersion?.downloadUrl || payload.latestVersion?.downloadUrl || null;
}

export async function getDownloadUrl(project, file, token, signal) {
  if (file.downloadUrl) return file.downloadUrl;

  const attempts = [
    `${project._apiBase}/files/fs/${encodeURIComponent(file.id)}/downloadurl${file.versionId ? `?versionId=${encodeURIComponent(file.versionId)}` : ''}`,
    `${project._apiBase}/files/${encodeURIComponent(file.id)}`,
    `${project._apiBase}/projects/${encodeURIComponent(project.id)}/files/${encodeURIComponent(file.id)}`
  ];

  const errors = [];
  for (const url of attempts) {
    try {
      const payload = await apiPayload(url, token, signal);
      const found = extractDownloadUrl(payload);
      if (found) return found;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      errors.push(error.message);
    }
  }
  throw new Error(`Geen download-URL gevonden (${errors.join(' | ')}).`);
}

export function isIfcFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return name.endsWith('.ifc') || name.endsWith('.ifczip');
}
