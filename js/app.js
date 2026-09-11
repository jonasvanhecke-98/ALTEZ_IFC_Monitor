import { connectWorkspace, requestAccessToken, isInsideTrimble } from './workspace.js';
import { listProjectsAcrossRegions, listProjectFiles, getDownloadUrl, isIfcFile } from './trimble.js';
import { scanIfcUrl } from './ifc.js';
import { versionKey, loadCache, saveCache, clearCache, loadLastResults, saveLastResults } from './cache.js';

const PROJECT_SELECTION_KEY = 'altez-ifc-monitor-project-selection-v1';
const $ = s => document.querySelector(s);
const els = {
  loadProjectsBtn: $('#loadProjectsBtn'), scanSelectedBtn: $('#scanSelectedBtn'), stopBtn: $('#stopBtn'), banner: $('#connectionBanner'), standalone: $('#standalonePanel'),
  tokenInput: $('#tokenInput'), useTokenBtn: $('#useTokenBtn'), target: $('#targetPset'), search: $('#searchInput'), filter: $('#statusFilter'), useCache: $('#useCache'),
  clearCache: $('#clearCacheBtn'), copyErrors: $('#copyErrorsBtn'), progress: $('#progressPanel'), progressTitle: $('#progressTitle'), progressText: $('#progressText'), progressDetail: $('#progressDetail'), progressBar: $('#progressBar'),
  projectPicker: $('#projectPickerPanel'), projectList: $('#projectList'), projectSearch: $('#projectSearchInput'), projectSelectionCount: $('#projectSelectionCount'), projectAvailableCount: $('#projectAvailableCount'),
  selectAllProjects: $('#selectAllProjectsBtn'), clearProjectSelection: $('#clearProjectSelectionBtn'),
  projectCount: $('#projectCount'), modelCount: $('#modelCount'), okCount: $('#okCount'), missingCount: $('#missingCount'), errorCount: $('#errorCount'),
  rows: $('#rows'), warnings: $('#warnings'), lastScan: $('#lastScanText'), visibleCount: $('#visibleCount')
};

let accessToken = null;
let availableProjects = [];
let selectedProjectIds = new Set();
let results = [];
let warnings = [];
let discoveryWarnings = [];
let controller = null;
let busy = false;
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
function loadSavedProjectSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROJECT_SELECTION_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}
function saveProjectSelection() {
  try { localStorage.setItem(PROJECT_SELECTION_KEY, JSON.stringify([...selectedProjectIds])); } catch {}
}
function renderProjectPicker() {
  const q = els.projectSearch.value.trim().toLowerCase();
  const visible = availableProjects.filter(p => !q || p.name.toLowerCase().includes(q));
  els.projectList.innerHTML = visible.length ? visible.map(project => `
    <label class="project-option">
      <input type="checkbox" data-project-id="${esc(project.id)}" ${selectedProjectIds.has(project.id) ? 'checked' : ''}>
      <span class="project-option-text">
        <strong>${esc(project.name)}</strong>
        <small>${esc(project.id)}</small>
      </span>
    </label>`).join('') : '<div class="empty project-empty">Geen projecten gevonden voor deze zoekopdracht.</div>';

  els.projectSelectionCount.textContent = `${selectedProjectIds.size} geselecteerd`;
  els.projectAvailableCount.textContent = `${availableProjects.length} project${availableProjects.length === 1 ? '' : 'en'} bereikbaar`;
  els.scanSelectedBtn.disabled = busy || !accessToken || selectedProjectIds.size === 0;
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
  els.loadProjectsBtn.disabled = value || !accessToken;
  els.scanSelectedBtn.disabled = value || !accessToken || selectedProjectIds.size === 0;
  els.stopBtn.hidden = !value;
  els.progress.hidden = !value;
  els.target.disabled = value;
  els.projectSearch.disabled = value;
  els.selectAllProjects.disabled = value;
  els.clearProjectSelection.disabled = value;
  els.projectList.querySelectorAll('input[type="checkbox"]').forEach(input => input.disabled = value);
  if (!value) {
    els.loadProjectsBtn.textContent = availableProjects.length ? 'Projecten vernieuwen' : 'Projecten laden';
    els.stopBtn.hidden = true;
  } else if (mode === 'load') {
    els.loadProjectsBtn.textContent = 'Projecten laden…';
  }
}

async function loadProjects() {
  if (busy || !accessToken) return;
  controller = new AbortController();
  const signal = controller.signal;
  setBusy(true, 'load');
  els.progressTitle.textContent = 'Projecten ophalen…';
  setProgress(0, 0, 'Trimble Connect-regio’s worden gecontroleerd.');

  try {
    const projectResponse = await listProjectsAcrossRegions(accessToken, signal);
    availableProjects = projectResponse.projects;
    discoveryWarnings = projectResponse.warnings || [];

    const saved = loadSavedProjectSelection();
    selectedProjectIds = new Set(availableProjects.filter(p => saved.has(p.id)).map(p => p.id));

    els.projectPicker.hidden = false;
    renderProjectPicker();
    warnings = [...discoveryWarnings];
    render();
    setBanner('success', `${availableProjects.length} project(en) gevonden. Kies welke projecten je wilt controleren.`);
  } catch (error) {
    if (error.name === 'AbortError') setBanner('warning', 'Ophalen van projecten gestopt.');
    else setBanner('error', `Projecten ophalen mislukt: ${error.message}`);
  } finally {
    setBusy(false);
    renderProjectPicker();
  }
}

async function scanSelected() {
  if (busy || !accessToken) return;
  const projects = availableProjects.filter(p => selectedProjectIds.has(p.id));
  if (!projects.length) return setBanner('warning', 'Selecteer eerst minstens één project.');

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
            cache[key] = row;
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            row = {
              projectId: project.id, projectName: project.name, modelId: file.id, modelName: file.name,
              versionId: file.versionId, version: file.version, modifiedOn: file.modifiedOn,
              targetPset, hasPset: null, status: 'error', checkedAt: new Date().toISOString(), error: error.message, cached: false
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
    saveLastResults({ results, warnings, projectTotal, finishedAt, targetPset, selectedProjectIds: [...selectedProjectIds] });
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

async function initialize() {
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
    setBanner('warning', 'Open deze URL als Trimble Connect-extensie voor automatische aanmelding. Buiten Trimble kun je een tijdelijk access token gebruiken.');
    return;
  }

  try {
    setBanner('info', 'Verbinden met Trimble Connect…');
    await connectWorkspace((event, token) => {
      if (event === 'token-refreshed' && token) {
        accessToken = token;
        els.loadProjectsBtn.disabled = false;
        setBanner('success', 'Verbonden met Trimble Connect. Laad eerst de projecten en maak daarna je selectie.');
      }
      if (event === 'session-invalid') {
        accessToken = null;
        els.loadProjectsBtn.disabled = true;
        els.scanSelectedBtn.disabled = true;
        setBanner('warning', 'Trimble-sessie is verlopen. Heropen de extensie of geef opnieuw toestemming.');
      }
    });
    accessToken = await requestAccessToken();
    els.loadProjectsBtn.disabled = false;
    setBanner('success', 'Verbonden met Trimble Connect. Klik op “Projecten laden”.');
  } catch (error) {
    setBanner('error', error.message);
  }
}

els.loadProjectsBtn.addEventListener('click', loadProjects);
els.scanSelectedBtn.addEventListener('click', scanSelected);
els.stopBtn.addEventListener('click', () => controller?.abort());
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
  availableProjects.filter(p => !q || p.name.toLowerCase().includes(q)).forEach(p => selectedProjectIds.add(p.id));
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
  accessToken = token;
  els.tokenInput.value = '';
  els.loadProjectsBtn.disabled = false;
  setBanner('success', 'Tijdelijk access token actief. Klik op “Projecten laden” en kies daarna de projecten.');
});

initialize();
