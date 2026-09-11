import { connectWorkspace, requestAccessToken, isInsideTrimble } from './workspace.js';
import { listProjectsPage, listProjectFiles, getDownloadUrl, isIfcFile } from './trimble.js';
import { scanIfcUrl } from './ifc.js';
import {
  versionKey, loadCache, saveCache, clearCache, loadLastResults, saveLastResults,
  loadProjectListCache, saveProjectListCache
} from './cache.js';

const PROJECT_SELECTION_PREFIX = 'altez-ifc-monitor-project-selection-v1.2:';
const PROJECT_REGION_KEY = 'altez-ifc-monitor-project-region-v1.2';
const PROJECT_PAGE_SIZE = 50;
const PROJECT_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const $ = s => document.querySelector(s);
const els = {
  loadProjectsBtn: $('#loadProjectsBtn'), loadMoreProjectsBtn: $('#loadMoreProjectsBtn'), scanSelectedBtn: $('#scanSelectedBtn'), stopBtn: $('#stopBtn'), banner: $('#connectionBanner'), standalone: $('#standalonePanel'),
  tokenInput: $('#tokenInput'), useTokenBtn: $('#useTokenBtn'), target: $('#targetPset'), search: $('#searchInput'), filter: $('#statusFilter'), useCache: $('#useCache'),
  clearCache: $('#clearCacheBtn'), copyErrors: $('#copyErrorsBtn'), progress: $('#progressPanel'), progressTitle: $('#progressTitle'), progressText: $('#progressText'), progressDetail: $('#progressDetail'), progressBar: $('#progressBar'),
  projectPicker: $('#projectPickerPanel'), projectList: $('#projectList'), projectSearch: $('#projectSearchInput'), projectRegion: $('#projectRegionSelect'), projectSelectionCount: $('#projectSelectionCount'), projectAvailableCount: $('#projectAvailableCount'), projectCacheInfo: $('#projectCacheInfo'),
  selectAllProjects: $('#selectAllProjectsBtn'), clearProjectSelection: $('#clearProjectSelectionBtn'),
  projectCount: $('#projectCount'), modelCount: $('#modelCount'), okCount: $('#okCount'), missingCount: $('#missingCount'), errorCount: $('#errorCount'),
  rows: $('#rows'), warnings: $('#warnings'), lastScan: $('#lastScanText'), visibleCount: $('#visibleCount')
};

let accessToken = null;
let availableProjects = [];
let selectedProjectIds = new Set();
let projectPage = 0;
let projectHasMore = true;
let projectTotalAvailable = null;
let projectCacheSavedAt = null;
let results = [];
let warnings = [];
let discoveryWarnings = [];
let controller = null;
let busy = false;
let busyMode = '';
let projectTotal = 0;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function setBanner(type, text) {
  els.banner.className = `banner ${type}`;
  els.banner.textContent = text;
}
function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? String(value) : d.toLocaleString('nl-BE', { dateStyle:'short', timeStyle:'short' });
}
function statusBadge(row) {
  if (row.status === 'ok') return '<span class="badge ok">● OK</span>';
  if (row.status === 'missing') return `<span class="badge missing">● ${esc(row.targetPset)} ontbreekt</span>`;
  return '<span class="badge error">● Controlefout</span>';
}
function regionKey() {
  return els.projectRegion?.value || 'europe';
}
function regionLabel() {
  return els.projectRegion?.selectedOptions?.[0]?.textContent || 'Europa';
}
function loadSavedProjectSelection(region = regionKey()) {
  try {
    const raw = JSON.parse(localStorage.getItem(`${PROJECT_SELECTION_PREFIX}${region}`) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}
function saveProjectSelection() {
  try { localStorage.setItem(`${PROJECT_SELECTION_PREFIX}${regionKey()}`, JSON.stringify([...selectedProjectIds])); } catch {}
}
function savePreferredRegion() {
  try { localStorage.setItem(PROJECT_REGION_KEY, regionKey()); } catch {}
}
function loadPreferredRegion() {
  try { return localStorage.getItem(PROJECT_REGION_KEY) || 'europe'; } catch { return 'europe'; }
}
function cacheAgeLabel(savedAt) {
  if (!savedAt) return '';
  const mins = Math.max(0, Math.round((Date.now() - savedAt) / 60000));
  if (mins < 2) return 'cache van zonet';
  if (mins < 60) return `cache van ${mins} min geleden`;
  const hours = Math.round(mins / 60);
  return `cache van ${hours} u geleden`;
}
function mergeProjects(existing, incoming) {
  const map = new Map(existing.map(p => [String(p.id), p]));
  let added = 0;
  for (const project of incoming) {
    const id = String(project.id);
    if (!map.has(id)) added += 1;
    map.set(id, project);
  }
  return { projects: [...map.values()].sort((a,b) => a.name.localeCompare(b.name, 'nl')), added };
}
function renderProjectPicker() {
  if (!els.projectPicker) return;
  const q = els.projectSearch.value.trim().toLowerCase();
  const visible = availableProjects.filter(p => !q || `${p.name} ${p.id}`.toLowerCase().includes(q));
  const noMatchText = q && projectHasMore
    ? 'Geen match in de geladen projecten. Klik op “Meer projecten laden” om verder te zoeken.'
    : 'Geen projecten gevonden voor deze zoekopdracht.';
  els.projectList.innerHTML = visible.length ? visible.map(project => `
    <label class="project-option">
      <input type="checkbox" data-project-id="${esc(project.id)}" ${selectedProjectIds.has(String(project.id)) ? 'checked' : ''}>
      <span class="project-option-text">
        <strong>${esc(project.name)}</strong>
        <small>${esc(project.id)}</small>
      </span>
    </label>`).join('') : `<div class="empty project-empty">${esc(noMatchText)}</div>`;

  const selectedLoadedCount = availableProjects.filter(p => selectedProjectIds.has(String(p.id))).length;
  els.projectSelectionCount.textContent = `${selectedLoadedCount} geselecteerd`;
  const totalText = Number.isFinite(projectTotalAvailable) ? ` van ${projectTotalAvailable}` : '';
  els.projectAvailableCount.textContent = `${availableProjects.length}${totalText} project(en) geladen uit ${regionLabel()}${projectHasMore ? ' · meer beschikbaar' : ''}`;
  if (els.projectCacheInfo) els.projectCacheInfo.textContent = projectCacheSavedAt ? cacheAgeLabel(projectCacheSavedAt) : 'live lijst';
  els.scanSelectedBtn.disabled = busy || !accessToken || selectedLoadedCount === 0;
  if (els.loadMoreProjectsBtn) {
    els.loadMoreProjectsBtn.hidden = !projectHasMore || !availableProjects.length;
    els.loadMoreProjectsBtn.disabled = busy || !accessToken || !projectHasMore;
  }
  els.loadProjectsBtn.textContent = availableProjects.length ? 'Vernieuw eerste 50' : 'Laad eerste 50';
}
function render() {
  const q = els.search.value.trim().toLowerCase();
  const filter = els.filter.value;
  const visible = results.filter(r => {
    const matchText = !q || `${r.projectName} ${r.modelName}`.toLowerCase().includes(q);
    const matchStatus = filter === 'all' || r.status === filter;
    return matchText && matchStatus;
  });

  els.rows.innerHTML = visible.length ? visible.map(r => `
    <tr title="${esc(r.error || '')}">
      <td>${statusBadge(r)}${r.cached ? '<span class="badge cached">cache</span>' : ''}</td>
      <td>${esc(r.projectName)}</td>
      <td class="model-name">${esc(r.modelName)}</td>
      <td>${esc(r.versionId ?? r.version ?? '—')}</td>
      <td>${fmtDate(r.modifiedOn)}</td>
      <td>${fmtDate(r.checkedAt)}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">Geen resultaten voor deze filter.</td></tr>';

  els.projectCount.textContent = projectTotal || new Set(results.map(r => r.projectId)).size;
  els.modelCount.textContent = results.length;
  els.okCount.textContent = results.filter(r => r.status === 'ok').length;
  els.missingCount.textContent = results.filter(r => r.status === 'missing').length;
  els.errorCount.textContent = results.filter(r => r.status === 'error').length;
  els.visibleCount.textContent = `${visible.length} resultaat${visible.length === 1 ? '' : 'en'}`;
  els.warnings.innerHTML = warnings.map(w => `<div class="warning">${esc(w)}</div>`).join('');
}
function setProgress(done, total, detail) {
  const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressText.textContent = total > 0 ? `${done} / ${total}` : '';
  els.progressDetail.textContent = detail || '';
}
function setBusy(value, mode = '') {
  busy = value;
  busyMode = value ? mode : '';
  els.loadProjectsBtn.disabled = value || !accessToken;
  if (els.loadMoreProjectsBtn) els.loadMoreProjectsBtn.disabled = value || !accessToken || !projectHasMore;
  els.scanSelectedBtn.disabled = value || !accessToken || availableProjects.filter(p => selectedProjectIds.has(String(p.id))).length === 0;
  els.stopBtn.hidden = !value;
  els.progress.hidden = !value;
  els.target.disabled = value && mode === 'scan';
  els.projectRegion.disabled = value;
  els.projectSearch.disabled = value && mode === 'scan';
  els.selectAllProjects.disabled = value && mode === 'scan';
  els.clearProjectSelection.disabled = value && mode === 'scan';
  els.projectList.querySelectorAll('input[type="checkbox"]').forEach(input => input.disabled = value && mode === 'scan');
  if (!value) {
    els.stopBtn.hidden = true;
    renderProjectPicker();
  } else if (mode === 'load') {
    els.loadProjectsBtn.textContent = projectPage ? 'Projecten laden…' : 'Eerste 50 laden…';
  } else if (mode === 'more' && els.loadMoreProjectsBtn) {
    els.loadMoreProjectsBtn.textContent = 'Meer laden…';
  }
}

function restoreCachedProjects({ quiet = false } = {}) {
  availableProjects = [];
  selectedProjectIds = new Set();
  projectPage = 0;
  projectHasMore = true;
  projectTotalAvailable = null;
  projectCacheSavedAt = null;

  const cached = loadProjectListCache(regionKey(), PROJECT_CACHE_MAX_AGE);
  if (cached?.projects?.length) {
    availableProjects = cached.projects;
    projectPage = Number(cached.page) || Math.max(1, Math.ceil(availableProjects.length / PROJECT_PAGE_SIZE));
    projectHasMore = cached.hasMore !== false;
    projectTotalAvailable = Number.isFinite(cached.total) ? cached.total : null;
    projectCacheSavedAt = cached.savedAt;
    const saved = loadSavedProjectSelection();
    selectedProjectIds = new Set(availableProjects.filter(p => saved.has(String(p.id))).map(p => String(p.id)));
    els.projectPicker.hidden = false;
    renderProjectPicker();
    if (!quiet) setBanner('success', `${availableProjects.length} ${regionLabel()}-project(en) direct uit cache geladen. Je kunt meteen zoeken of de lijst vernieuwen.`);
    return true;
  }

  els.projectPicker.hidden = false;
  renderProjectPicker();
  if (!quiet) setBanner('info', `${regionLabel()} geselecteerd. Klik op “Laad eerste 50”; de monitor haalt niet langer automatisch alle projecten op.`);
  return false;
}

async function loadProjectBatch({ reset = false } = {}) {
  if (busy || !accessToken) return;
  controller = new AbortController();
  const signal = controller.signal;
  const mode = reset ? 'load' : 'more';
  setBusy(true, mode);
  els.progressTitle.textContent = reset ? `Eerste projecten uit ${regionLabel()} ophalen…` : `Volgende projecten uit ${regionLabel()} ophalen…`;
  setProgress(0, 1, reset ? `Maximaal ${PROJECT_PAGE_SIZE} projecten in deze aanvraag.` : `Pagina ${projectPage + 1} · maximaal ${PROJECT_PAGE_SIZE} projecten.`);

  try {
    const pageToLoad = reset ? 1 : projectPage + 1;
    const response = await listProjectsPage(regionKey(), accessToken, signal, { page: pageToLoad, pageSize: PROJECT_PAGE_SIZE });
    const base = reset ? [] : availableProjects;
    const merged = mergeProjects(base, response.projects);
    availableProjects = merged.projects;
    projectPage = response.page;
    projectTotalAvailable = response.total;
    projectHasMore = response.hasMore && (reset || merged.added > 0);
    projectCacheSavedAt = Date.now();

    const saved = loadSavedProjectSelection();
    selectedProjectIds = new Set(availableProjects.filter(p => saved.has(String(p.id))).map(p => String(p.id)));
    saveProjectListCache(regionKey(), availableProjects, {
      page: projectPage,
      pageSize: PROJECT_PAGE_SIZE,
      hasMore: projectHasMore,
      total: projectTotalAvailable
    });

    els.projectPicker.hidden = false;
    renderProjectPicker();
    warnings = [...discoveryWarnings];
    render();
    setProgress(1, 1, `${response.projects.length} project(en) ontvangen.`);
    const totalText = Number.isFinite(projectTotalAvailable) ? ` van ${projectTotalAvailable}` : '';
    setBanner('success', `${availableProjects.length}${totalText} project(en) uit ${regionLabel()} geladen. Je kunt nu meteen zoeken/selecteren${projectHasMore ? ' of nog 50 laden' : ''}.`);
  } catch (error) {
    if (error.name === 'AbortError') setBanner('warning', 'Ophalen van projecten gestopt. Reeds geladen projecten blijven beschikbaar.');
    else setBanner('error', `Projecten ophalen mislukt: ${error.message}`);
  } finally {
    setBusy(false);
    if (els.loadMoreProjectsBtn) els.loadMoreProjectsBtn.textContent = 'Meer projecten laden';
    renderProjectPicker();
  }
}

async function scanSelected() {
  if (busy || !accessToken) return;
  const projects = availableProjects.filter(p => selectedProjectIds.has(String(p.id)));
  if (!projects.length) return setBanner('warning', 'Selecteer eerst minstens één geladen project.');

  const targetPset = els.target.value.trim() || 'Altez_IFC';
  controller = new AbortController();
  const signal = controller.signal;
  setBusy(true, 'scan');
  results = [];
  warnings = [...discoveryWarnings];
  projectTotal = projects.length;
  render();

  try {
    const cache = loadCache();
    const projectFiles = [];
    els.progressTitle.textContent = 'IFC-modellen zoeken in geselecteerde projecten…';

    for (let p = 0; p < projects.length; p++) {
      const project = projects[p];
      setProgress(p + 1, projects.length, project.name);
      try {
        const files = (await listProjectFiles(project, accessToken, signal)).filter(isIfcFile);
        projectFiles.push(...files.map(file => ({ project, file })));
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        warnings.push(`${project.name}: ${error.message}`);
      }
    }

    els.progressTitle.textContent = `IFC-modellen controleren op ${targetPset}…`;
    setProgress(0, projectFiles.length, `${projectFiles.length} IFC-model(len) gevonden in ${projects.length} geselecteerde project(en).`);

    let done = 0;
    const concurrency = 3;
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= projectFiles.length) return;
        const { project, file } = projectFiles[i];
        const key = versionKey(project.id, file, targetPset);
        const cached = els.useCache.checked ? cache[key] : null;
        let row;

        if (cached) {
          row = { ...cached, cached: true };
        } else {
          try {
            const downloadUrl = await getDownloadUrl(project, file, accessToken, signal);
            const hasPset = await scanIfcUrl(downloadUrl, file.name, targetPset, signal);
            row = {
              projectId: project.id, projectName: project.name, modelId: file.id, modelName: file.name,
              versionId: file.versionId, version: file.version, modifiedOn: file.modifiedOn,
              targetPset, hasPset, status: hasPset ? 'ok' : 'missing', checkedAt: new Date().toISOString(), cached: false
            };
            cache[key] = { ...row, cached: false };
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            row = {
              projectId: project.id, projectName: project.name, modelId: file.id, modelName: file.name,
              versionId: file.versionId, version: file.version, modifiedOn: file.modifiedOn,
              targetPset, status: 'error', error: error.message, checkedAt: new Date().toISOString(), cached: false
            };
          }
        }

        results.push(row);
        done += 1;
        results.sort((a,b) => a.projectName.localeCompare(b.projectName, 'nl') || a.modelName.localeCompare(b.modelName, 'nl'));
        setProgress(done, projectFiles.length, `${project.name} · ${file.name}`);
        render();
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, projectFiles.length || 1) }, worker));

    saveCache(cache);
    saveProjectSelection();
    const finishedAt = new Date().toISOString();
    saveLastResults({ results, warnings, projectTotal, finishedAt, targetPset, selectedProjectIds: [...selectedProjectIds], region: regionKey() });
    els.lastScan.textContent = `Laatste controle: ${fmtDate(finishedAt)} · ${projects.length} project(en) · propertyset ${targetPset}`;
    const missing = results.filter(r => r.status === 'missing').length;
    setBanner(missing ? 'warning' : 'success', `Controle klaar: ${missing} model(len) missen ${targetPset}.`);
  } catch (error) {
    if (error.name === 'AbortError') setBanner('warning', 'Controle gestopt. Reeds gevonden resultaten blijven zichtbaar.');
    else setBanner('error', `Controle mislukt: ${error.message}`);
  } finally {
    setBusy(false);
    render();
    renderProjectPicker();
  }
}

function activateToken(token, message = 'Verbonden met Trimble Connect.') {
  const firstActivation = !accessToken;
  accessToken = token;
  els.loadProjectsBtn.disabled = false;
  els.projectPicker.hidden = false;
  if (firstActivation) {
    const hadCache = restoreCachedProjects({ quiet: true });
    setBanner(hadCache ? 'success' : 'success', hadCache
      ? `${message} ${availableProjects.length} ${regionLabel()}-project(en) zijn direct uit cache beschikbaar.`
      : `${message} Regio ${regionLabel()} staat klaar. Laad alleen de eerste ${PROJECT_PAGE_SIZE} projecten.`);
  }
}

async function initialize() {
  const preferred = loadPreferredRegion();
  if ([...els.projectRegion.options].some(o => o.value === preferred)) els.projectRegion.value = preferred;

  const previous = loadLastResults();
  if (previous) {
    results = previous.results || [];
    warnings = previous.warnings || [];
    projectTotal = previous.projectTotal || 0;
    if (previous.targetPset) els.target.value = previous.targetPset;
    els.lastScan.textContent = previous.finishedAt ? `Laatste controle: ${fmtDate(previous.finishedAt)} · ${previous.projectTotal || 0} project(en) · propertyset ${previous.targetPset || 'Altez_IFC'}` : 'Vorige resultaten geladen.';
    render();
  }

  if (!isInsideTrimble()) {
    els.standalone.hidden = false;
    els.projectPicker.hidden = false;
    restoreCachedProjects({ quiet: true });
    setBanner('warning', 'Open deze URL als Trimble Connect-extensie voor automatische aanmelding. Buiten Trimble kun je een tijdelijk access token gebruiken.');
    return;
  }

  try {
    setBanner('info', 'Verbinden met Trimble Connect…');
    await connectWorkspace((event, token) => {
      if (event === 'token-refreshed' && token) activateToken(token, 'Trimble-token vernieuwd.');
      if (event === 'session-invalid') {
        accessToken = null;
        els.loadProjectsBtn.disabled = true;
        els.scanSelectedBtn.disabled = true;
        if (els.loadMoreProjectsBtn) els.loadMoreProjectsBtn.disabled = true;
        setBanner('warning', 'Trimble-sessie is verlopen. Heropen de extensie of geef opnieuw toestemming.');
      }
    });
    activateToken(await requestAccessToken());
  } catch (error) {
    setBanner('error', error.message);
  }
}

els.loadProjectsBtn.addEventListener('click', () => loadProjectBatch({ reset: true }));
els.loadMoreProjectsBtn?.addEventListener('click', () => loadProjectBatch({ reset: false }));
els.scanSelectedBtn.addEventListener('click', scanSelected);
els.stopBtn.addEventListener('click', () => controller?.abort());
els.projectRegion.addEventListener('change', () => {
  if (busy) return;
  savePreferredRegion();
  restoreCachedProjects();
});
els.projectSearch.addEventListener('input', renderProjectPicker);
els.projectList.addEventListener('change', event => {
  const input = event.target.closest('input[type="checkbox"][data-project-id]');
  if (!input) return;
  const id = String(input.dataset.projectId);
  if (input.checked) selectedProjectIds.add(id); else selectedProjectIds.delete(id);
  saveProjectSelection();
  renderProjectPicker();
});
els.selectAllProjects.addEventListener('click', () => {
  const q = els.projectSearch.value.trim().toLowerCase();
  availableProjects.filter(p => !q || `${p.name} ${p.id}`.toLowerCase().includes(q)).forEach(p => selectedProjectIds.add(String(p.id)));
  saveProjectSelection();
  renderProjectPicker();
});
els.clearProjectSelection.addEventListener('click', () => {
  selectedProjectIds.clear();
  saveProjectSelection();
  renderProjectPicker();
});
els.search.addEventListener('input', render);
els.filter.addEventListener('change', render);
els.clearCache.addEventListener('click', () => {
  clearCache();
  setBanner('info', 'Lokale scan-cache is gewist. De volgende scan controleert de modellen opnieuw.');
});
els.copyErrors.addEventListener('click', async () => {
  const bad = results.filter(r => r.status !== 'ok');
  const text = bad.length ? bad.map(r => `${r.projectName}\t${r.modelName}\t${r.status === 'missing' ? `${r.targetPset} ontbreekt` : r.error || 'controlefout'}`).join('\n') : 'Geen fouten.';
  try {
    await navigator.clipboard.writeText(text);
    setBanner('success', `${bad.length} foutregel(s) gekopieerd.`);
  } catch {
    setBanner('warning', 'Kopiëren naar klembord werd door de browser geblokkeerd.');
  }
});
els.useTokenBtn.addEventListener('click', () => {
  const token = els.tokenInput.value.trim();
  if (!token) return setBanner('warning', 'Plak eerst een geldig Trimble user-context access token.');
  els.tokenInput.value = '';
  activateToken(token, 'Tijdelijk access token actief.');
});

initialize();
