import {
  connectWorkspace,
  requestAccessToken,
  isInsideTrimble
} from './workspace.js';

import {
  listProjectsPage,
  listProjectFiles,
  getDownloadUrl,
  isIfcFile
} from './trimble.js';

import {
  scanIfcUrl
} from './ifc.js';

import {
  versionKey,
  loadCache,
  saveCache,
  clearCache,
  loadLastResults,
  saveLastResults,
  loadProjectListCache,
  saveProjectListCache
} from './cache.js';


/* =========================================================
   INSTELLINGEN
   ========================================================= */

const PROJECT_SELECTION_PREFIX =
  'altez-ifc-monitor-project-selection-v1.3:';

const PROJECT_REGION_KEY =
  'altez-ifc-monitor-project-region-v1.3';

const PROJECT_PAGE_SIZE = 50;

const PROJECT_CACHE_MAX_AGE =
  24 * 60 * 60 * 1000;


/* =========================================================
   DOM
   ========================================================= */

const $ = selector =>
  document.querySelector(selector);

const els = {

  loadProjectsBtn:
    $('#loadProjectsBtn'),

  loadMoreProjectsBtn:
    $('#loadMoreProjectsBtn'),

  scanSelectedBtn:
    $('#scanSelectedBtn'),

  stopBtn:
    $('#stopBtn'),

  banner:
    $('#connectionBanner'),

  standalone:
    $('#standalonePanel'),

  tokenInput:
    $('#tokenInput'),

  useTokenBtn:
    $('#useTokenBtn'),

  target:
    $('#targetPset'),

  search:
    $('#searchInput'),

  filter:
    $('#statusFilter'),

  useCache:
    $('#useCache'),

  clearCache:
    $('#clearCacheBtn'),

  copyErrors:
    $('#copyErrorsBtn'),

  progress:
    $('#progressPanel'),

  progressTitle:
    $('#progressTitle'),

  progressText:
    $('#progressText'),

  progressDetail:
    $('#progressDetail'),

  progressBar:
    $('#progressBar'),

  projectPicker:
    $('#projectPickerPanel'),

  projectList:
    $('#projectList'),

  projectSearch:
    $('#projectSearchInput'),

  projectRegion:
    $('#projectRegionSelect'),

  projectSelectionCount:
    $('#projectSelectionCount'),

  projectAvailableCount:
    $('#projectAvailableCount'),

  projectCacheInfo:
    $('#projectCacheInfo'),

  selectAllProjects:
    $('#selectAllProjectsBtn'),

  clearProjectSelection:
    $('#clearProjectSelectionBtn'),

  projectCount:
    $('#projectCount'),

  modelCount:
    $('#modelCount'),

  okCount:
    $('#okCount'),

  missingCount:
    $('#missingCount'),

  errorCount:
    $('#errorCount'),

  rows:
    $('#rows'),

  warnings:
    $('#warnings'),

  lastScan:
    $('#lastScanText'),

  visibleCount:
    $('#visibleCount')
};


/* =========================================================
   STATE
   ========================================================= */

let accessToken = null;

let availableProjects = [];

let selectedProjectIds = new Set();

let expandedProjectIds = new Set();

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


/* =========================================================
   EXTRA STYLES VOOR PROJECTGROEPERING
   ========================================================= */

function injectProjectGroupStyles() {

  if (
    document.getElementById(
      'altez-project-group-styles'
    )
  ) {
    return;
  }

  const style =
    document.createElement('style');

  style.id =
    'altez-project-group-styles';

  style.textContent = `

    .project-summary-row {
      cursor: pointer;
      background: #f7f9fa;
      font-weight: 600;
    }

    .project-summary-row:hover {
      background: #eef2f4;
    }

    .project-summary-row td {
      border-bottom: 1px solid #dce3e7;
    }

    .project-summary-row:focus {
      outline: 2px solid #667582;
      outline-offset: -2px;
    }

    .project-summary-row.all-ok td:first-child {
      border-left: 4px solid #16794b;
    }

    .project-summary-row.has-missing td:first-child {
      border-left: 4px solid #be3232;
    }

    .project-summary-row.has-errors td:first-child {
      border-left: 4px solid #a87900;
    }

    .project-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .project-chevron {
      width: 18px;
      flex: 0 0 18px;
      text-align: center;
      color: #66717b;
      font-size: 12px;
    }

    .project-summary-name {
      min-width: 0;
    }

    .project-summary-name strong {
      display: block;
      font-size: 14px;
    }

    .project-summary-name small {
      display: block;
      margin-top: 2px;
      color: #8b949c;
      font-size: 10px;
      font-weight: 500;
    }

    .project-stat {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 800;
      margin-right: 5px;
    }

    .project-stat.total {
      background: #eef1f3;
      color: #4f5c67;
    }

    .project-stat.ok {
      background: #e6f5ec;
      color: #11613c;
    }

    .project-stat.missing {
      background: #fde9e9;
      color: #a32626;
    }

    .project-stat.error {
      background: #fff1c7;
      color: #765607;
    }

    .project-open-hint {
      color: #74808a;
      font-size: 11px;
      font-weight: 650;
      white-space: nowrap;
    }

    .project-detail-row {
      background: white;
    }

    .project-detail-row:hover {
      background: #fafcfd;
    }

    .project-detail-row td {
      border-bottom:
        1px solid #edf0f2;
    }

    .project-detail-project {
      color: #9aa2a9;
      text-align: right;
      padding-right: 8px;
    }

    .project-detail-project::before {
      content: "↳";
      font-size: 15px;
    }

    .project-detail-model {
      padding-left: 8px;
    }

    .project-summary-row .badge {
      vertical-align: middle;
    }

    @media (max-width: 900px) {

      .project-summary-row td {
        white-space: nowrap;
      }

    }

  `;

  document.head.appendChild(style);
}


/* =========================================================
   HULPFUNCTIES
   ========================================================= */

function esc(value) {

  return String(
    value ?? ''
  ).replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char])
  );

}


function setBanner(
  type,
  text
) {

  els.banner.className =
    `banner ${type}`;

  els.banner.textContent =
    text;

}


function fmtDate(value) {

  if (!value) {
    return '—';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.valueOf()
    )
  ) {
    return String(value);
  }

  return date.toLocaleString(
    'nl-BE',
    {
      dateStyle: 'short',
      timeStyle: 'short'
    }
  );

}


function statusBadge(row) {

  if (
    row.status === 'ok'
  ) {

    return `
      <span class="badge ok">
        ● OK
      </span>
    `;

  }

  if (
    row.status === 'missing'
  ) {

    return `
      <span class="badge missing">
        ● ${esc(row.targetPset)} ontbreekt
      </span>
    `;

  }

  return `
    <span class="badge error">
      ● Controlefout
    </span>
  `;

}


function regionKey() {

  return (
    els.projectRegion?.value ||
    'europe'
  );

}


function regionLabel() {

  return (
    els.projectRegion
      ?.selectedOptions?.[0]
      ?.textContent ||
    'Europa'
  );

}


/* =========================================================
   PROJECTSELECTIE OPSLAAN
   ========================================================= */

function loadSavedProjectSelection(
  region = regionKey()
) {

  try {

    const raw =
      JSON.parse(
        localStorage.getItem(
          `${PROJECT_SELECTION_PREFIX}${region}`
        ) || '[]'
      );

    return new Set(
      Array.isArray(raw)
        ? raw.map(String)
        : []
    );

  } catch {

    return new Set();

  }

}


function saveProjectSelection() {

  try {

    localStorage.setItem(
      `${PROJECT_SELECTION_PREFIX}${regionKey()}`,
      JSON.stringify(
        [...selectedProjectIds]
      )
    );

  } catch {}

}


function savePreferredRegion() {

  try {

    localStorage.setItem(
      PROJECT_REGION_KEY,
      regionKey()
    );

  } catch {}

}


function loadPreferredRegion() {

  try {

    return (
      localStorage.getItem(
        PROJECT_REGION_KEY
      ) ||
      'europe'
    );

  } catch {

    return 'europe';

  }

}


/* =========================================================
   PROJECTCACHE
   ========================================================= */

function cacheAgeLabel(savedAt) {

  if (!savedAt) {
    return '';
  }

  const minutes =
    Math.max(
      0,
      Math.round(
        (
          Date.now() -
          savedAt
        ) / 60000
      )
    );

  if (minutes < 2) {
    return 'cache van zonet';
  }

  if (minutes < 60) {
    return `cache van ${minutes} min geleden`;
  }

  const hours =
    Math.round(
      minutes / 60
    );

  return `cache van ${hours} u geleden`;

}


function mergeProjects(
  existing,
  incoming
) {

  const map =
    new Map(
      existing.map(
        project => [
          String(project.id),
          project
        ]
      )
    );

  let added = 0;

  for (
    const project
    of incoming
  ) {

    const id =
      String(project.id);

    if (!map.has(id)) {
      added += 1;
    }

    map.set(
      id,
      project
    );

  }

  return {

    projects:
      [...map.values()]
        .sort(
          (a, b) =>
            a.name.localeCompare(
              b.name,
              'nl'
            )
        ),

    added

  };

}


/* =========================================================
   PROJECT PICKER
   ========================================================= */

function renderProjectPicker() {

  if (!els.projectPicker) {
    return;
  }

  const query =
    els.projectSearch
      .value
      .trim()
      .toLowerCase();

  const visible =
    availableProjects.filter(
      project =>
        !query ||
        `${project.name} ${project.id}`
          .toLowerCase()
          .includes(query)
    );

  const noMatchText =
    query &&
    projectHasMore
      ?
        'Geen match in de geladen projecten. Klik op “Meer projecten laden” om verder te zoeken.'
      :
        'Geen projecten gevonden voor deze zoekopdracht.';

  els.projectList.innerHTML =
    visible.length
      ?
        visible
          .map(
            project => `

              <label class="project-option">

                <input
                  type="checkbox"
                  data-project-id="${esc(project.id)}"
                  ${
                    selectedProjectIds.has(
                      String(project.id)
                    )
                      ? 'checked'
                      : ''
                  }
                >

                <span class="project-option-text">

                  <strong>
                    ${esc(project.name)}
                  </strong>

                  <small>
                    ${esc(project.id)}
                  </small>

                </span>

              </label>

            `
          )
          .join('')
      :
        `
          <div class="empty project-empty">
            ${esc(noMatchText)}
          </div>
        `;

  const selectedLoadedCount =
    availableProjects.filter(
      project =>
        selectedProjectIds.has(
          String(project.id)
        )
    ).length;

  els.projectSelectionCount.textContent =
    `${selectedLoadedCount} geselecteerd`;

  const totalText =
    Number.isFinite(
      projectTotalAvailable
    )
      ?
        ` van ${projectTotalAvailable}`
      :
        '';

  els.projectAvailableCount.textContent =
    `${availableProjects.length}${totalText} project(en) geladen uit ${regionLabel()}${projectHasMore ? ' · meer beschikbaar' : ''}`;

  if (
    els.projectCacheInfo
  ) {

    els.projectCacheInfo.textContent =
      projectCacheSavedAt
        ?
          cacheAgeLabel(
            projectCacheSavedAt
          )
        :
          'live lijst';

  }

  els.scanSelectedBtn.disabled =
    busy ||
    !accessToken ||
    selectedLoadedCount === 0;

  if (
    els.loadMoreProjectsBtn
  ) {

    els.loadMoreProjectsBtn.hidden =
      !projectHasMore ||
      !availableProjects.length;

    els.loadMoreProjectsBtn.disabled =
      busy ||
      !accessToken ||
      !projectHasMore;

  }

  els.loadProjectsBtn.textContent =
    availableProjects.length
      ?
        'Vernieuw eerste 50'
      :
        'Laad eerste 50';

}


/* =========================================================
   MODELRESULTATEN PER PROJECT GROEPEREN
   ========================================================= */

function render() {

  const query =
    els.search
      .value
      .trim()
      .toLowerCase();

  const filter =
    els.filter.value;

  /*
   * Eerst de individuele modellen filteren.
   */

  const visible =
    results.filter(
      row => {

        const matchText =
          !query ||
          `
            ${row.projectName}
            ${row.projectId}
            ${row.modelName}
          `
            .toLowerCase()
            .includes(query);

        const matchStatus =
          filter === 'all' ||
          row.status === filter;

        return (
          matchText &&
          matchStatus
        );

      }
    );


  /*
   * Daarna groeperen per project.
   */

  const grouped =
    new Map();

  for (
    const row
    of visible
  ) {

    const projectId =
      String(
        row.projectId ??
        row.projectName ??
        'unknown-project'
      );

    if (
      !grouped.has(
        projectId
      )
    ) {

      grouped.set(
        projectId,
        {
          id: projectId,
          name:
            row.projectName ||
            'Onbekend project',
          rows: []
        }
      );

    }

    grouped
      .get(projectId)
      .rows
      .push(row);

  }


  const projects =
    [...grouped.values()]
      .sort(
        (a, b) =>
          a.name.localeCompare(
            b.name,
            'nl'
          )
      );


  /*
   * Project subtotalen + accordion.
   */

  const html =
    projects
      .map(
        project => {

          const projectRows =
            [...project.rows]
              .sort(
                (a, b) =>
                  a.modelName.localeCompare(
                    b.modelName,
                    'nl'
                  )
              );

          const total =
            projectRows.length;

          const ok =
            projectRows.filter(
              row =>
                row.status === 'ok'
            ).length;

          const missing =
            projectRows.filter(
              row =>
                row.status ===
                'missing'
            ).length;

          const errors =
            projectRows.filter(
              row =>
                row.status ===
                'error'
            ).length;

          const expanded =
            expandedProjectIds.has(
              project.id
            );


          /*
           * Projectstatus.
           */

          let projectClass =
            'all-ok';

          let projectStatus =
            `
              <span class="badge ok">
                ● Project OK
              </span>
            `;

          if (
            missing > 0
          ) {

            projectClass =
              'has-missing';

            projectStatus =
              `
                <span class="badge missing">
                  ● Actie nodig
                </span>
              `;

          } else if (
            errors > 0
          ) {

            projectClass =
              'has-errors';

            projectStatus =
              `
                <span class="badge error">
                  ● Controlefout
                </span>
              `;

          }


          /*
           * Hoofdregel / subtotaal.
           */

          const summaryRow =
            `

              <tr
                class="
                  project-summary-row
                  ${projectClass}
                "
                data-project-summary="true"
                data-project-id="${esc(project.id)}"
                aria-expanded="${expanded}"
                tabindex="0"
              >

                <td>

                  ${projectStatus}

                </td>


                <td>

                  <div class="project-toggle">

                    <span class="project-chevron">
                      ${expanded ? '▼' : '▶'}
                    </span>

                    <span class="project-summary-name">

                      <strong>
                        ${esc(project.name)}
                      </strong>

                      <small>
                        ${esc(project.id)}
                      </small>

                    </span>

                  </div>

                </td>


                <td>

                  <span class="project-stat total">
                    ${total} IFC${total === 1 ? '' : "'s"}
                  </span>

                </td>


                <td>

                  <span class="project-stat ok">
                    ${ok} OK
                  </span>

                </td>


                <td>

                  ${
                    missing > 0
                      ?
                        `
                          <span class="project-stat missing">
                            ${missing} actie nodig
                          </span>
                        `
                      :
                        `
                          <span class="project-stat ok">
                            0 actie nodig
                          </span>
                        `
                  }

                  ${
                    errors > 0
                      ?
                        `
                          <span class="project-stat error">
                            ${errors} controlefout${errors === 1 ? '' : 'en'}
                          </span>
                        `
                      :
                        ''
                  }

                </td>


                <td class="project-open-hint">

                  ${
                    expanded
                      ?
                        'Details sluiten'
                      :
                        'Details openen'
                  }

                </td>

              </tr>

            `;


          /*
           * Project dichtgeklapt.
           */

          if (
            !expanded
          ) {

            return summaryRow;

          }


          /*
           * Detailregels.
           */

          const detailRows =
            projectRows
              .map(
                row => `

                  <tr
                    class="project-detail-row"
                    title="${esc(row.error || '')}"
                  >

                    <td>

                      ${statusBadge(row)}

                      ${
                        row.cached
                          ?
                            `
                              <span class="badge cached">
                                cache
                              </span>
                            `
                          :
                            ''
                      }

                    </td>


                    <td class="project-detail-project">
                    </td>


                    <td
                      class="
                        model-name
                        project-detail-model
                      "
                    >
                      ${esc(row.modelName)}
                    </td>


                    <td>

                      ${esc(
                        row.versionId ??
                        row.version ??
                        '—'
                      )}

                    </td>


                    <td>

                      ${fmtDate(
                        row.modifiedOn
                      )}

                    </td>


                    <td>

                      ${fmtDate(
                        row.checkedAt
                      )}

                    </td>

                  </tr>

                `
              )
              .join('');


          return (
            summaryRow +
            detailRows
          );

        }
      )
      .join('');


  els.rows.innerHTML =
    html ||
    `
      <tr>

        <td
          colspan="6"
          class="empty"
        >
          Geen resultaten voor deze filter.
        </td>

      </tr>
    `;


  /*
   * Algemene dashboardtotalen.
   */

  els.projectCount.textContent =
    projectTotal ||
    new Set(
      results.map(
        row =>
          row.projectId
      )
    ).size;


  els.modelCount.textContent =
    results.length;


  els.okCount.textContent =
    results.filter(
      row =>
        row.status === 'ok'
    ).length;


  els.missingCount.textContent =
    results.filter(
      row =>
        row.status === 'missing'
    ).length;


  els.errorCount.textContent =
    results.filter(
      row =>
        row.status === 'error'
    ).length;


  els.visibleCount.textContent =
    `${projects.length} project${projects.length === 1 ? '' : 'en'} · ${visible.length} model${visible.length === 1 ? '' : 'len'}`;


  els.warnings.innerHTML =
    warnings
      .map(
        warning =>
          `
            <div class="warning">
              ${esc(warning)}
            </div>
          `
      )
      .join('');

}


/* =========================================================
   PROJECT OPEN / DICHT
   ========================================================= */

function toggleProjectRow(
  projectId
) {

  const id =
    String(projectId);

  if (
    expandedProjectIds.has(id)
  ) {

    expandedProjectIds.delete(
      id
    );

  } else {

    expandedProjectIds.add(
      id
    );

  }

  render();

}


/* =========================================================
   PROGRESS
   ========================================================= */

function setProgress(
  done,
  total,
  detail
) {

  const percentage =
    total > 0
      ?
        Math.min(
          100,
          Math.round(
            done /
            total *
            100
          )
        )
      :
        0;

  els.progressBar.style.width =
    `${percentage}%`;

  els.progressText.textContent =
    total > 0
      ?
        `${done} / ${total}`
      :
        '';

  els.progressDetail.textContent =
    detail ||
    '';

}


/* =========================================================
   BUSY STATUS
   ========================================================= */

function setBusy(
  value,
  mode = ''
) {

  busy =
    value;

  busyMode =
    value
      ?
        mode
      :
        '';

  els.loadProjectsBtn.disabled =
    value ||
    !accessToken;

  if (
    els.loadMoreProjectsBtn
  ) {

    els.loadMoreProjectsBtn.disabled =
      value ||
      !accessToken ||
      !projectHasMore;

  }

  els.scanSelectedBtn.disabled =
    value ||
    !accessToken ||
    availableProjects
      .filter(
        project =>
          selectedProjectIds.has(
            String(project.id)
          )
      )
      .length === 0;

  els.stopBtn.hidden =
    !value;

  els.progress.hidden =
    !value;

  els.target.disabled =
    value &&
    mode === 'scan';

  els.projectRegion.disabled =
    value;

  els.projectSearch.disabled =
    value &&
    mode === 'scan';

  els.selectAllProjects.disabled =
    value &&
    mode === 'scan';

  els.clearProjectSelection.disabled =
    value &&
    mode === 'scan';

  els.projectList
    .querySelectorAll(
      'input[type="checkbox"]'
    )
    .forEach(
      input => {

        input.disabled =
          value &&
          mode === 'scan';

      }
    );


  if (
    !value
  ) {

    els.stopBtn.hidden =
      true;

    renderProjectPicker();

  } else if (
    mode === 'load'
  ) {

    els.loadProjectsBtn.textContent =
      projectPage
        ?
          'Projecten laden…'
        :
          'Eerste 50 laden…';

  } else if (
    mode === 'more' &&
    els.loadMoreProjectsBtn
  ) {

    els.loadMoreProjectsBtn.textContent =
      'Meer laden…';

  }

}


/* =========================================================
   PROJECTCACHE HERSTELLEN
   ========================================================= */

function restoreCachedProjects({
  quiet = false
} = {}) {

  availableProjects = [];

  selectedProjectIds =
    new Set();

  projectPage = 0;

  projectHasMore = true;

  projectTotalAvailable = null;

  projectCacheSavedAt = null;


  const cached =
    loadProjectListCache(
      regionKey(),
      PROJECT_CACHE_MAX_AGE
    );


  if (
    cached?.projects?.length
  ) {

    availableProjects =
      cached.projects;

    projectPage =
      Number(cached.page) ||
      Math.max(
        1,
        Math.ceil(
          availableProjects.length /
          PROJECT_PAGE_SIZE
        )
      );

    projectHasMore =
      cached.hasMore !== false;

    projectTotalAvailable =
      Number.isFinite(
        cached.total
      )
        ?
          cached.total
        :
          null;

    projectCacheSavedAt =
      cached.savedAt;


    const saved =
      loadSavedProjectSelection();


    selectedProjectIds =
      new Set(
        availableProjects
          .filter(
            project =>
              saved.has(
                String(project.id)
              )
          )
          .map(
            project =>
              String(project.id)
          )
      );


    els.projectPicker.hidden =
      false;

    renderProjectPicker();


    if (
      !quiet
    ) {

      setBanner(
        'success',
        `${availableProjects.length} ${regionLabel()}-project(en) direct uit cache geladen. Je kunt meteen zoeken of de lijst vernieuwen.`
      );

    }

    return true;

  }


  els.projectPicker.hidden =
    false;

  renderProjectPicker();


  if (
    !quiet
  ) {

    setBanner(
      'info',
      `${regionLabel()} geselecteerd. Klik op “Laad eerste 50”; de monitor haalt niet langer automatisch alle projecten op.`
    );

  }

  return false;

}


/* =========================================================
   PROJECTEN LADEN
   ========================================================= */

async function loadProjectBatch({
  reset = false
} = {}) {

  if (
    busy ||
    !accessToken
  ) {
    return;
  }


  controller =
    new AbortController();

  const signal =
    controller.signal;

  const mode =
    reset
      ?
        'load'
      :
        'more';


  setBusy(
    true,
    mode
  );


  els.progressTitle.textContent =
    reset
      ?
        `Eerste projecten uit ${regionLabel()} ophalen…`
      :
        `Volgende projecten uit ${regionLabel()} ophalen…`;


  setProgress(
    0,
    1,
    reset
      ?
        `Maximaal ${PROJECT_PAGE_SIZE} projecten in deze aanvraag.`
      :
        `Pagina ${projectPage + 1} · maximaal ${PROJECT_PAGE_SIZE} projecten.`
  );


  try {

    const pageToLoad =
      reset
        ?
          1
        :
          projectPage + 1;


    const response =
      await listProjectsPage(
        regionKey(),
        accessToken,
        signal,
        {
          page: pageToLoad,
          pageSize:
            PROJECT_PAGE_SIZE
        }
      );


    const base =
      reset
        ?
          []
        :
          availableProjects;


    const merged =
      mergeProjects(
        base,
        response.projects
      );


    availableProjects =
      merged.projects;

    projectPage =
      response.page;

    projectTotalAvailable =
      response.total;

    projectHasMore =
      response.hasMore &&
      (
        reset ||
        merged.added > 0
      );

    projectCacheSavedAt =
      Date.now();


    const saved =
      loadSavedProjectSelection();


    selectedProjectIds =
      new Set(
        availableProjects
          .filter(
            project =>
              saved.has(
                String(project.id)
              )
          )
          .map(
            project =>
              String(project.id)
          )
      );


    saveProjectListCache(
      regionKey(),
      availableProjects,
      {
        page:
          projectPage,

        pageSize:
          PROJECT_PAGE_SIZE,

        hasMore:
          projectHasMore,

        total:
          projectTotalAvailable
      }
    );


    els.projectPicker.hidden =
      false;


    renderProjectPicker();


    warnings =
      [...discoveryWarnings];


    render();


    setProgress(
      1,
      1,
      `${response.projects.length} project(en) ontvangen.`
    );


    const totalText =
      Number.isFinite(
        projectTotalAvailable
      )
        ?
          ` van ${projectTotalAvailable}`
        :
          '';


    setBanner(
      'success',
      `${availableProjects.length}${totalText} project(en) uit ${regionLabel()} geladen. Je kunt nu meteen zoeken/selecteren${projectHasMore ? ' of nog 50 laden' : ''}.`
    );

  } catch (
    error
  ) {

    if (
      error.name ===
      'AbortError'
    ) {

      setBanner(
        'warning',
        'Ophalen van projecten gestopt. Reeds geladen projecten blijven beschikbaar.'
      );

    } else {

      setBanner(
        'error',
        `Projecten ophalen mislukt: ${error.message}`
      );

    }

  } finally {

    setBusy(
      false
    );


    if (
      els.loadMoreProjectsBtn
    ) {

      els.loadMoreProjectsBtn.textContent =
        'Meer projecten laden';

    }


    renderProjectPicker();

  }

}


/* =========================================================
   GESELECTEERDE PROJECTEN SCANNEN
   ========================================================= */

async function scanSelected() {

  if (
    busy ||
    !accessToken
  ) {
    return;
  }


  const projects =
    availableProjects.filter(
      project =>
        selectedProjectIds.has(
          String(project.id)
        )
    );


  if (
    !projects.length
  ) {

    setBanner(
      'warning',
      'Selecteer eerst minstens één geladen project.'
    );

    return;

  }


  const targetPset =
    els.target.value.trim() ||
    'Altez_IFC';


  controller =
    new AbortController();

  const signal =
    controller.signal;


  setBusy(
    true,
    'scan'
  );


  results = [];

  warnings =
    [...discoveryWarnings];

  projectTotal =
    projects.length;

  expandedProjectIds =
    new Set();

  render();


  try {

    const cache =
      loadCache();


    const projectFiles =
      [];


    els.progressTitle.textContent =
      'IFC-modellen zoeken in geselecteerde projecten…';


    for (
      let projectIndex = 0;
      projectIndex < projects.length;
      projectIndex++
    ) {

      const project =
        projects[projectIndex];


      setProgress(
        projectIndex + 1,
        projects.length,
        project.name
      );


      try {

        const files =
          (
            await listProjectFiles(
              project,
              accessToken,
              signal
            )
          ).filter(
            isIfcFile
          );


        projectFiles.push(
          ...files.map(
            file => ({
              project,
              file
            })
          )
        );

      } catch (
        error
      ) {

        if (
          error.name ===
          'AbortError'
        ) {
          throw error;
        }


        warnings.push(
          `${project.name}: ${error.message}`
        );

      }

    }


    els.progressTitle.textContent =
      `IFC-modellen controleren op ${targetPset}…`;


    setProgress(
      0,
      projectFiles.length,
      `${projectFiles.length} IFC-model(len) gevonden in ${projects.length} geselecteerde project(en).`
    );


    let done = 0;

    const concurrency = 3;

    let cursor = 0;


    async function worker() {

      while (
        true
      ) {

        const index =
          cursor++;


        if (
          index >=
          projectFiles.length
        ) {
          return;
        }


        const {
          project,
          file
        } =
          projectFiles[index];


        const key =
          versionKey(
            project.id,
            file,
            targetPset
          );


        const cached =
          els.useCache.checked
            ?
              cache[key]
            :
              null;


        let row;


        if (
          cached
        ) {

          row = {
            ...cached,
            cached: true
          };

        } else {

          try {

            const downloadUrl =
              await getDownloadUrl(
                project,
                file,
                accessToken,
                signal
              );


            const hasPset =
              await scanIfcUrl(
                downloadUrl,
                file.name,
                targetPset,
                signal
              );


            row = {

              projectId:
                project.id,

              projectName:
                project.name,

              modelId:
                file.id,

              modelName:
                file.name,

              versionId:
                file.versionId,

              version:
                file.version,

              modifiedOn:
                file.modifiedOn,

              targetPset,

              hasPset,

              status:
                hasPset
                  ?
                    'ok'
                  :
                    'missing',

              checkedAt:
                new Date()
                  .toISOString(),

              cached:
                false

            };


            cache[key] = {
              ...row,
              cached: false
            };

          } catch (
            error
          ) {

            if (
              error.name ===
              'AbortError'
            ) {
              throw error;
            }


            row = {

              projectId:
                project.id,

              projectName:
                project.name,

              modelId:
                file.id,

              modelName:
                file.name,

              versionId:
                file.versionId,

              version:
                file.version,

              modifiedOn:
                file.modifiedOn,

              targetPset,

              status:
                'error',

              error:
                error.message,

              checkedAt:
                new Date()
                  .toISOString(),

              cached:
                false

            };

          }

        }


        results.push(
          row
        );


        done += 1;


        results.sort(
          (a, b) =>
            a.projectName.localeCompare(
              b.projectName,
              'nl'
            ) ||
            a.modelName.localeCompare(
              b.modelName,
              'nl'
            )
        );


        setProgress(
          done,
          projectFiles.length,
          `${project.name} · ${file.name}`
        );


        render();

      }

    }


    await Promise.all(
      Array.from(
        {
          length:
            Math.min(
              concurrency,
              projectFiles.length ||
              1
            )
        },
        worker
      )
    );


    saveCache(
      cache
    );


    saveProjectSelection();


    const finishedAt =
      new Date()
        .toISOString();


    saveLastResults({

      results,

      warnings,

      projectTotal,

      finishedAt,

      targetPset,

      selectedProjectIds:
        [...selectedProjectIds],

      region:
        regionKey()

    });


    els.lastScan.textContent =
      `Laatste controle: ${fmtDate(finishedAt)} · ${projects.length} project(en) · propertyset ${targetPset}`;


    const missing =
      results.filter(
        row =>
          row.status ===
          'missing'
      ).length;


    const errors =
      results.filter(
        row =>
          row.status ===
          'error'
      ).length;


    if (
      missing > 0
    ) {

      setBanner(
        'warning',
        `Controle klaar: ${missing} model(len) missen ${targetPset}${errors ? ` · ${errors} controlefout(en)` : ''}.`
      );

    } else if (
      errors > 0
    ) {

      setBanner(
        'warning',
        `Controle klaar: geen ontbrekende ${targetPset} gevonden, maar ${errors} model(len) konden niet gecontroleerd worden.`
      );

    } else {

      setBanner(
        'success',
        `Controle klaar: alle ${results.length} IFC-model(len) bevatten ${targetPset}.`
      );

    }

  } catch (
    error
  ) {

    if (
      error.name ===
      'AbortError'
    ) {

      setBanner(
        'warning',
        'Controle gestopt. Reeds gevonden resultaten blijven zichtbaar.'
      );

    } else {

      setBanner(
        'error',
        `Controle mislukt: ${error.message}`
      );

    }

  } finally {

    setBusy(
      false
    );

    render();

    renderProjectPicker();

  }

}


/* =========================================================
   TOKEN ACTIVEREN
   ========================================================= */

function activateToken(
  token,
  message =
    'Verbonden met Trimble Connect.'
) {

  const firstActivation =
    !accessToken;


  accessToken =
    token;


  els.loadProjectsBtn.disabled =
    false;


  els.projectPicker.hidden =
    false;


  if (
    firstActivation
  ) {

    const hadCache =
      restoreCachedProjects({
        quiet: true
      });


    setBanner(
      'success',
      hadCache
        ?
          `${message} ${availableProjects.length} ${regionLabel()}-project(en) zijn direct uit cache beschikbaar.`
        :
          `${message} Regio ${regionLabel()} staat klaar. Laad alleen de eerste ${PROJECT_PAGE_SIZE} projecten.`
    );

  }

}


/* =========================================================
   INITIALISEREN
   ========================================================= */

async function initialize() {

  injectProjectGroupStyles();


  const preferred =
    loadPreferredRegion();


  if (
    [...els.projectRegion.options]
      .some(
        option =>
          option.value ===
          preferred
      )
  ) {

    els.projectRegion.value =
      preferred;

  }


  const previous =
    loadLastResults();


  if (
    previous
  ) {

    results =
      previous.results ||
      [];

    warnings =
      previous.warnings ||
      [];

    projectTotal =
      previous.projectTotal ||
      0;


    if (
      previous.targetPset
    ) {

      els.target.value =
        previous.targetPset;

    }


    els.lastScan.textContent =
      previous.finishedAt
        ?
          `Laatste controle: ${fmtDate(previous.finishedAt)} · ${previous.projectTotal || 0} project(en) · propertyset ${previous.targetPset || 'Altez_IFC'}`
        :
          'Vorige resultaten geladen.';


    render();

  }


  if (
    !isInsideTrimble()
  ) {

    els.standalone.hidden =
      false;

    els.projectPicker.hidden =
      false;


    restoreCachedProjects({
      quiet: true
    });


    setBanner(
      'warning',
      'Open deze URL als Trimble Connect-extensie voor automatische aanmelding. Buiten Trimble kun je een tijdelijk access token gebruiken.'
    );


    return;

  }


  try {

    setBanner(
      'info',
      'Verbinden met Trimble Connect…'
    );


    await connectWorkspace(
      (
        event,
        token
      ) => {

        if (
          event ===
            'token-refreshed' &&
          token
        ) {

          activateToken(
            token,
            'Trimble-token vernieuwd.'
          );

        }


        if (
          event ===
          'session-invalid'
        ) {

          accessToken =
            null;

          els.loadProjectsBtn.disabled =
            true;

          els.scanSelectedBtn.disabled =
            true;


          if (
            els.loadMoreProjectsBtn
          ) {

            els.loadMoreProjectsBtn.disabled =
              true;

          }


          setBanner(
            'warning',
            'Trimble-sessie is verlopen. Heropen de extensie of geef opnieuw toestemming.'
          );

        }

      }
    );


    activateToken(
      await requestAccessToken()
    );

  } catch (
    error
  ) {

    setBanner(
      'error',
      error.message
    );

  }

}


/* =========================================================
   EVENTS
   ========================================================= */

els.loadProjectsBtn
  .addEventListener(
    'click',
    () =>
      loadProjectBatch({
        reset: true
      })
  );


els.loadMoreProjectsBtn
  ?.addEventListener(
    'click',
    () =>
      loadProjectBatch({
        reset: false
      })
  );


els.scanSelectedBtn
  .addEventListener(
    'click',
    scanSelected
  );


els.stopBtn
  .addEventListener(
    'click',
    () =>
      controller?.abort()
  );


els.projectRegion
  .addEventListener(
    'change',
    () => {

      if (
        busy
      ) {
        return;
      }

      savePreferredRegion();

      restoreCachedProjects();

    }
  );


els.projectSearch
  .addEventListener(
    'input',
    renderProjectPicker
  );


els.projectList
  .addEventListener(
    'change',
    event => {

      const input =
        event.target.closest(
          'input[type="checkbox"][data-project-id]'
        );


      if (
        !input
      ) {
        return;
      }


      const id =
        String(
          input.dataset.projectId
        );


      if (
        input.checked
      ) {

        selectedProjectIds.add(
          id
        );

      } else {

        selectedProjectIds.delete(
          id
        );

      }


      saveProjectSelection();

      renderProjectPicker();

    }
  );


els.selectAllProjects
  .addEventListener(
    'click',
    () => {

      const query =
        els.projectSearch
          .value
          .trim()
          .toLowerCase();


      availableProjects
        .filter(
          project =>
            !query ||
            `${project.name} ${project.id}`
              .toLowerCase()
              .includes(query)
        )
        .forEach(
          project =>
            selectedProjectIds.add(
              String(project.id)
            )
        );


      saveProjectSelection();

      renderProjectPicker();

    }
  );


els.clearProjectSelection
  .addEventListener(
    'click',
    () => {

      selectedProjectIds.clear();

      saveProjectSelection();

      renderProjectPicker();

    }
  );


/* ---------------------------------------------------------
   PROJECTDETAIL OPEN / DICHT
   --------------------------------------------------------- */

els.rows
  .addEventListener(
    'click',
    event => {

      const row =
        event.target.closest(
          'tr[data-project-summary]'
        );


      if (
        !row
      ) {
        return;
      }


      toggleProjectRow(
        row.dataset.projectId
      );

    }
  );


els.rows
  .addEventListener(
    'keydown',
    event => {

      if (
        event.key !== 'Enter' &&
        event.key !== ' '
      ) {
        return;
      }


      const row =
        event.target.closest(
          'tr[data-project-summary]'
        );


      if (
        !row
      ) {
        return;
      }


      event.preventDefault();


      toggleProjectRow(
        row.dataset.projectId
      );

    }
  );


/* ---------------------------------------------------------
   FILTERS
   --------------------------------------------------------- */

els.search
  .addEventListener(
    'input',
    render
  );


els.filter
  .addEventListener(
    'change',
    render
  );


/* ---------------------------------------------------------
   CACHE
   --------------------------------------------------------- */

els.clearCache
  .addEventListener(
    'click',
    () => {

      clearCache();


      setBanner(
        'info',
        'Lokale scan-cache is gewist. De volgende scan controleert de modellen opnieuw.'
      );

    }
  );


/* ---------------------------------------------------------
   FOUTEN KOPIËREN
   --------------------------------------------------------- */

els.copyErrors
  .addEventListener(
    'click',
    async () => {

      const bad =
        results.filter(
          row =>
            row.status !== 'ok'
        );


      const text =
        bad.length
          ?
            bad
              .map(
                row =>
                  `${row.projectName}\t${row.modelName}\t${
                    row.status === 'missing'
                      ?
                        `${row.targetPset} ontbreekt`
                      :
                        row.error ||
                        'controlefout'
                  }`
              )
              .join('\n')
          :
            'Geen fouten.';


      try {

        await navigator.clipboard.writeText(
          text
        );


        setBanner(
          'success',
          `${bad.length} foutregel(s) gekopieerd.`
        );

      } catch {

        setBanner(
          'warning',
          'Kopiëren naar klembord werd door de browser geblokkeerd.'
        );

      }

    }
  );


/* ---------------------------------------------------------
   HANDMATIG TOKEN
   --------------------------------------------------------- */

els.useTokenBtn
  .addEventListener(
    'click',
    () => {

      const token =
        els.tokenInput
          .value
          .trim();


      if (
        !token
      ) {

        setBanner(
          'warning',
          'Plak eerst een geldig Trimble user-context access token.'
        );

        return;

      }


      els.tokenInput.value =
        '';


      activateToken(
        token,
        'Tijdelijk access token actief.'
      );

    }
  );


/* =========================================================
   START
   ========================================================= */

initialize();
