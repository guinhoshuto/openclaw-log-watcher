/* ── State ──────────────────────────────────────────────────────────── */
let allSessions = [];
let filteredSessions = [];
let sessionMap = {};   // key → full session object
let sortCol = 'updatedAt';
let sortDir = 'desc';
let page = 1;
const PAGE_SIZE = 50;

let chartSessions = null;
let chartTokens = null;
let datePicker = null;

let _autoRefreshTimer = null;
const AUTO_REFRESH_MS = 5000;

/* ── Init ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initDatePicker();
  initSortHeaders();
  initFilterListeners();
  loadData();
});

function initDatePicker() {
  datePicker = flatpickr('#filter-date', {
    mode: 'range',
    dateFormat: 'Y-m-d',
    allowInput: false,
    onChange: applyFilters,
  });
}

function initSortHeaders() {
  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      page = 1;
      renderTable();
    });
  });
}

function initFilterListeners() {
  ['filter-model', 'filter-provider', 'filter-origin'].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
  });
}

/* ── Data loading ───────────────────────────────────────────────────── */
async function loadData() {
  const tbody = document.getElementById('sessions-tbody');
  tbody.innerHTML = '<tr><td colspan="16" class="loading">Loading…</td></tr>';

  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allSessions = await res.json();
    sessionMap = Object.fromEntries(allSessions.map(s => [s.key, s]));
    populateFilterOptions();
    applyFilters();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="16" class="empty">Error: ${err.message}</td></tr>`;
  }
}

function toggleAutoRefresh() {
  if (_autoRefreshTimer) {
    clearInterval(_autoRefreshTimer);
    _autoRefreshTimer = null;
    updateAutoRefreshButton();
    return;
  }

  // Refresh immediately, then every 5s
  loadData();
  _autoRefreshTimer = setInterval(loadData, AUTO_REFRESH_MS);
  updateAutoRefreshButton();
}

function updateAutoRefreshButton() {
  const btn = document.getElementById('auto-refresh-btn');
  if (!btn) return;
  const on = Boolean(_autoRefreshTimer);
  btn.classList.toggle('on', on);
  btn.textContent = on ? '⏱ Auto (5s): ON' : '⏱ Auto (5s)';
}

/* ── Filter option population ───────────────────────────────────────── */
function populateFilterOptions() {
  const models   = [...new Set(allSessions.map(s => s.model).filter(Boolean))].sort();
  const providers = [...new Set(allSessions.map(s => s.modelProvider).filter(Boolean))].sort();
  const origins  = [...new Set(allSessions.map(s => s.origin?.provider).filter(Boolean))].sort();

  fillSelect('filter-model',    models,    'All models');
  fillSelect('filter-provider', providers, 'All providers');
  fillSelect('filter-origin',   origins,   'All origins');
}

function fillSelect(id, values, placeholder) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ── Filtering ──────────────────────────────────────────────────────── */
function applyFilters() {
  const model    = document.getElementById('filter-model').value;
  const provider = document.getElementById('filter-provider').value;
  const origin   = document.getElementById('filter-origin').value;
  const dates    = datePicker ? datePicker.selectedDates : [];

  let dateFrom = null;
  let dateTo   = null;
  if (dates.length === 2) {
    dateFrom = dates[0].getTime();
    // end of the selected day
    dateTo   = dates[1].getTime() + 86399999;
  } else if (dates.length === 1) {
    dateFrom = dates[0].getTime();
    dateTo   = dates[0].getTime() + 86399999;
  }

  filteredSessions = allSessions.filter(s => {
    if (model    && s.model          !== model)    return false;
    if (provider && s.modelProvider  !== provider) return false;
    if (origin   && s.origin?.provider !== origin)  return false;
    if (dateFrom !== null && s.updatedAt < dateFrom) return false;
    if (dateTo   !== null && s.updatedAt > dateTo)   return false;
    return true;
  });

  page = 1;
  updateStats();
  updateCharts();
  renderTable();
}

function clearFilters() {
  document.getElementById('filter-model').value    = '';
  document.getElementById('filter-provider').value = '';
  document.getElementById('filter-origin').value   = '';
  if (datePicker) datePicker.clear();
  applyFilters();
}

/* ── Stats ──────────────────────────────────────────────────────────── */
function updateStats() {
  const s = filteredSessions;
  const total   = s.length;
  const totTok  = s.reduce((a, x) => a + (x.totalTokens || 0), 0);
  const inTok   = s.reduce((a, x) => a + (x.inputTokens  || 0), 0);
  const outTok  = s.reduce((a, x) => a + (x.outputTokens || 0), 0);
  const cacheR  = s.reduce((a, x) => a + (x.cacheRead    || 0), 0);
  const cacheW  = s.reduce((a, x) => a + (x.cacheWrite   || 0), 0);
  const aborted = s.filter(x => x.abortedLastRun).length;
  const avg     = total ? Math.round(totTok / total) : 0;

  setText('stat-total',     fmt(total));
  setText('stat-tokens',    fmt(totTok));
  setText('stat-tokens-sub', `↑ ${fmt(inTok)} in  ↓ ${fmt(outTok)} out`);
  setText('stat-avg',       fmt(avg));
  setText('stat-cache-read', fmt(cacheR));
  setText('stat-cache-write', cacheW ? `write ${fmt(cacheW)}` : '');
  setText('stat-aborted',   fmt(aborted));
}

/* ── Charts ─────────────────────────────────────────────────────────── */
function updateCharts() {
  const byDay = {};

  filteredSessions.forEach(s => {
    const d = new Date(s.updatedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!byDay[key]) byDay[key] = { count: 0, input: 0, output: 0 };
    byDay[key].count++;
    byDay[key].input  += s.inputTokens  || 0;
    byDay[key].output += s.outputTokens || 0;
  });

  const days   = Object.keys(byDay).sort();
  const counts = days.map(d => byDay[d].count);
  const inputs = days.map(d => byDay[d].input);
  const outputs = days.map(d => byDay[d].output);

  const chartDefaults = {
    plugins: { legend: { labels: { color: '#8892b0', font: { size: 12 } } } },
    scales: {
      x: { ticks: { color: '#8892b0', maxRotation: 45 }, grid: { color: '#2e3250' } },
      y: { ticks: { color: '#8892b0' }, grid: { color: '#2e3250' } },
    },
  };

  /* Sessions per day */
  const ctxS = document.getElementById('chart-sessions').getContext('2d');
  if (chartSessions) chartSessions.destroy();
  chartSessions = new Chart(ctxS, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        label: 'Sessions',
        data: counts,
        backgroundColor: 'rgba(108,143,255,0.75)',
        borderColor: '#6c8fff',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: { ...chartDefaults, responsive: true },
  });

  /* Tokens per day */
  const ctxT = document.getElementById('chart-tokens').getContext('2d');
  if (chartTokens) chartTokens.destroy();
  chartTokens = new Chart(ctxT, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [
        {
          label: 'Input Tokens',
          data: inputs,
          backgroundColor: 'rgba(167,139,250,0.75)',
          borderColor: '#a78bfa',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'tokens',
        },
        {
          label: 'Output Tokens',
          data: outputs,
          backgroundColor: 'rgba(52,211,153,0.75)',
          borderColor: '#34d399',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'tokens',
        },
      ],
    },
    options: {
      ...chartDefaults,
      responsive: true,
      scales: {
        ...chartDefaults.scales,
        x: { ...chartDefaults.scales.x, stacked: true },
        y: { ...chartDefaults.scales.y, stacked: true },
      },
    },
  });
}

/* ── Token heatmap helper (shared by both tables) ───────────────────── */
function tokenHeatStyle(v, min, max) {
  if (v == null) return '';
  const range = max - min || 1;
  const ratio = (v - min) / range;
  const alpha = 0.12 + ratio * 0.62;
  const r = Math.round(251 - ratio * 60);
  const g = Math.round(191 - ratio * 130);
  const b = Math.round(36  - ratio * 36);
  return ` style="background:rgba(${r},${g},${b},${alpha.toFixed(2)});color:#fff;font-weight:600"`;
}

/* ── Table ──────────────────────────────────────────────────────────── */
function renderTable() {
  updateSortHeaders();

  const sorted = [...filteredSessions].sort((a, b) => {
    let av = colValue(a, sortCol);
    let bv = colValue(b, sortCol);
    if (av == null) av = '';
    if (bv == null) bv = '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(page, totalPages);

  const start = (page - 1) * PAGE_SIZE;
  const slice = sorted.slice(start, start + PAGE_SIZE);

  // Compute token ranges across ALL filtered sessions (not just the current page)
  // so the heatmap scale stays consistent when paginating
  const heatRanges = {
    in:    tokenRange(sorted, 'inputTokens'),
    out:   tokenRange(sorted, 'outputTokens'),
    total: tokenRange(sorted, 'totalTokens'),
  };

  setText('table-count', `${fmt(total)} session${total !== 1 ? 's' : ''}`);

  const tbody = document.getElementById('sessions-tbody');
  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="16" class="empty">No sessions match the current filters.</td></tr>';
  } else {
    tbody.innerHTML = slice.map(s => rowHTML(s, heatRanges)).join('');
  }

  renderPagination(totalPages);
}

function colValue(s, col) {
  if (col === 'origin_provider') return s.origin?.provider || '';
  if (col === 'origin_label')    return s.origin?.label    || '';
  if (col === 'fileKind')        return s.fileKind || '';
  return s[col];
}

function tokenRange(rows, field) {
  const vals = rows.map(r => r[field]).filter(v => v != null && v > 0);
  return { min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 1 };
}

function rowHTML(s, heat = {}) {
  const date = s.updatedAt ? new Date(s.updatedAt).toLocaleString('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }) : '—';

  const sessionLabel   = s.label             || '—';
  const originLabel    = s.origin?.label     || '—';
  const chatType       = s.chatType          || '—';
  const originProvider = s.origin?.provider  || '—';
  const badgeClass = badgeFor(originProvider);
  const fk = s.fileKind || 'active';
  const sourceBadge =
    fk === 'active'
      ? 'badge-source-active'
      : fk === 'reset'
        ? 'badge-source-reset'
        : 'badge-source-deleted';

  const inStyle    = heat.in    ? tokenHeatStyle(s.inputTokens,  heat.in.min,    heat.in.max)    : '';
  const outStyle   = heat.out   ? tokenHeatStyle(s.outputTokens, heat.out.min,   heat.out.max)   : '';
  const totStyle   = heat.total ? tokenHeatStyle(s.totalTokens,  heat.total.min, heat.total.max) : '';

  return `<tr>
    <td class="key" title="${esc(s.key)}">${esc(truncate(s.key, 32))}</td>
    <td class="muted" title="${esc(s.sessionId || '')}">${esc(truncate(s.sessionId || '—', 14))}</td>
    <td class="muted">${date}</td>
    <td title="${esc(sessionLabel)}">${esc(truncate(sessionLabel, 30))}</td>
    <td title="${esc(originLabel)}">${esc(truncate(originLabel, 30))}</td>
    <td>${esc(chatType)}</td>
    <td>${esc(s.model || '—')}</td>
    <td><span class="badge ${badgeClass}">${esc(originProvider)}</span></td>
    <td class="muted"${inStyle}>${fmt(s.inputTokens)}</td>
    <td class="muted"${outStyle}>${fmt(s.outputTokens)}</td>
    <td${totStyle}>${fmt(s.totalTokens)}</td>
    <td class="muted td-num">${fmt(s.cacheRead)}</td>
    <td class="muted td-num">${fmt(s.cacheWrite)}</td>
    <td><span class="badge ${sourceBadge}">${esc(fk)}</span></td>
    <td class="${s.abortedLastRun ? 'aborted-yes' : 'aborted-no'}">${s.abortedLastRun ? 'Yes' : 'No'}</td>
    <td class="actions-cell">
      <button class="btn-view" data-key="${esc(s.key)}" onclick="openModal(this.dataset.key)" title="Session JSON">{ }</button>
      <button class="btn-session" data-file="${esc(s.sessionFile || '')}" data-key="${esc(s.key)}"
        onclick="openSfModal(this.dataset.file, this.dataset.key)"
        ${s.sessionFile ? '' : 'disabled title="No session file"'}
        title="Session file">≡</button>
    </td>
  </tr>`;
}

function badgeFor(p) {
  const m = { telegram: 'badge-telegram', discord: 'badge-discord', heartbeat: 'badge-heartbeat', anthropic: 'badge-anthropic', openai: 'badge-openai' };
  return m[p?.toLowerCase()] || 'badge-default';
}

/* ── Pagination ─────────────────────────────────────────────────────── */
function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const pages = paginationRange(page, totalPages);
  let html = `<button class="page-btn" onclick="goPage(${page-1})" ${page===1?'disabled':''}>‹ Prev</button>`;

  pages.forEach(p => {
    if (p === '…') {
      html += `<span class="page-info">…</span>`;
    } else {
      html += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
    }
  });

  html += `<button class="page-btn" onclick="goPage(${page+1})" ${page===totalPages?'disabled':''}>Next ›</button>`;
  container.innerHTML = html;
}

function paginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const arr = [1];
  if (current > 3)  arr.push('…');
  for (let i = Math.max(2, current-1); i <= Math.min(total-1, current+1); i++) arr.push(i);
  if (current < total - 2) arr.push('…');
  arr.push(total);
  return arr;
}

function goPage(p) {
  page = p;
  renderTable();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Helpers ─────────────────────────────────────────────────────────── */
function fmt(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString();
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function updateSortHeaders() {
  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      if (icon) icon.textContent = sortDir === 'asc' ? '↑' : '↓';
    } else {
      if (icon) icon.textContent = '⇅';
    }
  });
}

/* ── Modal ───────────────────────────────────────────────────────────── */
let _modalJSON = '';

function openModal(key) {
  const session = sessionMap[key];
  if (!session) return;

  _modalJSON = JSON.stringify(session, null, 2);

  document.getElementById('modal-title').textContent = key;
  document.getElementById('modal-subtitle').textContent = session.sessionId || '';
  document.getElementById('modal-json').innerHTML = syntaxHighlight(_modalJSON);

  const copyBtn = document.getElementById('modal-copy-btn');
  copyBtn.textContent = 'Copy JSON';
  copyBtn.classList.remove('copied');

  document.getElementById('json-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('json-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('json-modal')) closeModal();
}

function copyJSON() {
  if (!_modalJSON) return;
  navigator.clipboard.writeText(_modalJSON).then(() => {
    const btn = document.getElementById('modal-copy-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy JSON';
      btn.classList.remove('copied');
    }, 2000);
  });
}

// Close whichever modal is open on Escape
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('sf-modal')?.classList.contains('open')) { closeSfModal(); return; }
  if (document.getElementById('json-modal')?.classList.contains('open')) { closeModal(); }
});

/* ── Session File Modal ──────────────────────────────────────────────── */
let _sfJSON = '';
let _sfData = [];
let _sfView = 'table';

async function openSfModal(filePath, sessionKey) {
  if (!filePath) return;

  const modal    = document.getElementById('sf-modal');
  const body     = document.getElementById('sf-modal-body');
  const title    = document.getElementById('sf-modal-title');
  const subtitle = document.getElementById('sf-modal-subtitle');
  const countEl  = document.getElementById('sf-entry-count');
  const copyBtn  = document.getElementById('sf-copy-btn');

  title.textContent    = filePath.split('/').pop();
  subtitle.textContent = filePath;
  countEl.textContent  = '';
  copyBtn.textContent  = 'Copy JSON';
  copyBtn.classList.remove('copied');

  // Reset to table view
  _sfView = 'table';
  _sfData = [];
  _sfJSON = '';
  setSfViewButtons();

  body.innerHTML = '<div class="sf-loading">Loading…</div>';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const res = await fetch(`/api/session-file?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    _sfData = data;
    _sfJSON = JSON.stringify(data, null, 2);
    countEl.textContent = `${data.length} entr${data.length === 1 ? 'y' : 'ies'}`;
    renderSfView();
  } catch (err) {
    _sfData = [];
    _sfJSON = '';
    body.innerHTML = `<div class="sf-error">Error: ${esc(err.message)}</div>`;
  }
}

function setSfView(view) {
  _sfView = view;
  setSfViewButtons();
  renderSfView();
}

function setSfViewButtons() {
  document.getElementById('sf-toggle-table').classList.toggle('active', _sfView === 'table');
  document.getElementById('sf-toggle-raw').classList.toggle('active',   _sfView === 'raw');
}

function renderSfView() {
  const body = document.getElementById('sf-modal-body');
  body.innerHTML = _sfView === 'table' ? sfTableHTML(_sfData) : sfRawHTML(_sfData);
}

/* ── SF Raw view ─────────────────────────────────────────────────────── */
function sfRawHTML(data) {
  if (!data.length) return '<div class="sf-loading">No entries.</div>';
  return data.map((entry, i) => {
    const type = entry.type || entry.role || 'unknown';
    const typeClass = `type-${type.replace(/[^a-z_]/g, '')}`;
    const json = JSON.stringify(entry, null, 2);
    return `<div class="sf-entry">
      <div class="sf-entry-header">
        <span class="sf-idx">#${i + 1}</span>
        <span class="sf-type ${typeClass}">${esc(type)}</span>
      </div>
      <pre>${syntaxHighlight(esc(json))}</pre>
    </div>`;
  }).join('');
}

/* ── SF Table view ───────────────────────────────────────────────────── */
function sfTableHTML(data) {
  if (!data.length) return '<div class="sf-loading">No entries.</div>';

  // Pre-compute total-token range for heatmap
  const tokenValues = data
    .map(e => e.message?.usage?.totalTokens ?? e.totalTokens)
    .filter(v => v != null);
  const minTok = tokenValues.length ? Math.min(...tokenValues) : 0;
  const maxTok = tokenValues.length ? Math.max(...tokenValues) : 1;
  const tokRange = maxTok - minTok || 1;

  const heatStyle = v => tokenHeatStyle(v, minTok, maxTok);

  // Candidate columns in priority order
  // Helper: resolve a field from both the entry root and entry.message.*
  // logfile.json nests most data inside entry.message; fallback format is flat.
  const msgField = (e, ...keys) => {
    for (const k of keys) {
      const top = k.split('.').reduce((o, p) => o?.[p], e);
      if (top != null) return top;
      const nested = k.split('.').reduce((o, p) => o?.[p], e.message);
      if (nested != null) return nested;
    }
    return null;
  };

  const candidates = [
    {
      key: 'type',
      label: 'Type',
      present: d => d.some(e => e.type || e.role),
      cell: e => {
        const val = e.type || e.role || '—';
        const cls = `sf-type type-${val.replace(/[^a-z_]/g, '')}`;
        return `<td><span class="${cls}">${esc(val)}</span></td>`;
      },
    },
    {
      key: 'modelId',
      label: 'Model',
      present: d => d.some(e => e.modelId || e.message?.model || e.model),
      cell: e => {
        const v = e.modelId || e.message?.model || e.model || null;
        return `<td class="td-mono">${esc(v || '—')}</td>`;
      },
    },
    {
      key: 'role',
      label: 'Role',
      present: d => d.some(e => e.message?.role),
      cell: e => `<td class="td-mono">${esc(e.message?.role || '—')}</td>`,
    },
    {
      key: 'content',
      label: 'Content',
      present: d => d.some(e => e.content != null || e.message?.content != null),
      cell: e => {
        const raw = e.message?.content ?? e.content;
        let text = '—';
        if (typeof raw === 'string') {
          text = raw;
        } else if (Array.isArray(raw)) {
          text = raw.map(b =>
            typeof b === 'string' ? b : b?.text || b?.thinking || b?.name || b?.type || JSON.stringify(b)
          ).join(' ');
        } else if (raw != null) {
          text = JSON.stringify(raw);
        }
        return `<td class="td-content" title="${esc(text)}">${esc(truncate(text, 80))}</td>`;
      },
    },
    {
      key: 'id',
      label: 'ID',
      present: d => d.some(e => e.id),
      cell: e => `<td class="td-mono" title="${esc(e.id || '')}">${esc(truncate(e.id || '—', 12))}</td>`,
    },
    {
      key: 'stop_reason',
      label: 'Stop reason',
      present: d => d.some(e => e.stop_reason || e.message?.stopReason),
      cell: e => `<td class="td-mono">${esc(e.stop_reason || e.message?.stopReason || '—')}</td>`,
    },
    {
      key: 'in_tokens',
      label: 'In tokens',
      present: d => d.some(e => e.usage?.input_tokens != null || e.inputTokens != null || e.message?.usage?.input != null),
      cell: e => {
        const v = e.message?.usage?.input ?? e.usage?.input_tokens ?? e.inputTokens;
        return `<td class="td-num">${v != null ? fmt(v) : '—'}</td>`;
      },
    },
    {
      key: 'out_tokens',
      label: 'Out tokens',
      present: d => d.some(e => e.usage?.output_tokens != null || e.outputTokens != null || e.message?.usage?.output != null),
      cell: e => {
        const v = e.message?.usage?.output ?? e.usage?.output_tokens ?? e.outputTokens;
        return `<td class="td-num">${v != null ? fmt(v) : '—'}</td>`;
      },
    },
    {
      key: 'total_tokens',
      label: 'Total tokens',
      present: d => d.some(e => e.totalTokens != null || e.message?.usage?.totalTokens != null),
      cell: e => {
        const v = e.message?.usage?.totalTokens ?? e.totalTokens;
        return `<td class="td-num"${heatStyle(v)}>${v != null ? fmt(v) : '—'}</td>`;
      },
    },
    {
      key: 'timestamp',
      label: 'Timestamp',
      present: d => d.some(e => e.timestamp),
      cell: e => {
        if (!e.timestamp) return '<td class="td-mono">—</td>';
        const d = new Date(e.timestamp).toLocaleString('en-CA', {
          month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        return `<td class="td-mono">${d}</td>`;
      },
    },
    {
      key: 'updatedAt',
      label: 'Date',
      present: d => d.some(e => e.updatedAt),
      cell: e => {
        if (!e.updatedAt) return '<td class="td-mono">—</td>';
        const d = new Date(e.updatedAt).toLocaleString('en-CA', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        });
        return `<td class="td-mono">${d}</td>`;
      },
    },
    {
      key: '_key',
      label: 'Session Key',
      present: d => d.some(e => e._key),
      cell: e => `<td class="td-mono" title="${esc(e._key || '')}">${esc(truncate(e._key || '—', 32))}</td>`,
    },
  ];

  const cols = candidates.filter(c => c.present(data));

  const thead = `<thead><tr>
    <th>#</th>
    ${cols.map(c => `<th>${c.label}</th>`).join('')}
  </tr></thead>`;

  const colCount = cols.length + 1; // +1 for the # column

  const tbody = `<tbody>${data.map((entry, i) => `<tr class="sf-data-row" data-idx="${i}" onclick="toggleSfRow(this)">
    <td class="td-idx">${i + 1}</td>
    ${cols.map(c => c.cell(entry, i)).join('')}
  </tr>`).join('')}</tbody>`;

  return `<table class="sf-table" data-col-count="${colCount}">${thead}${tbody}</table>`;
}

/* ── Row accordion ───────────────────────────────────────────────────── */
function toggleSfRow(tr) {
  const idx    = parseInt(tr.dataset.idx, 10);
  const next   = tr.nextElementSibling;
  const isOpen = tr.classList.contains('sf-row-open');

  // Collapse all open rows first
  document.querySelectorAll('.sf-expand-row').forEach(r => r.remove());
  document.querySelectorAll('.sf-row-open').forEach(r => r.classList.remove('sf-row-open'));

  if (isOpen) return; // was already open — just collapse

  const entry    = _sfData[idx];
  const colCount = parseInt(tr.closest('table').dataset.colCount, 10) || tr.cells.length;

  const expandTr  = document.createElement('tr');
  expandTr.className = 'sf-expand-row';
  const td = document.createElement('td');
  td.colSpan = colCount;
  td.innerHTML = buildExpandContent(entry);
  expandTr.appendChild(td);

  tr.parentNode.insertBefore(expandTr, tr.nextSibling);
  tr.classList.add('sf-row-open');
  tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function buildExpandContent(entry) {
  const blocks = entry.message?.content ?? entry.content ?? null;

  // No content array — fall back to showing the raw entry JSON
  if (!blocks || (Array.isArray(blocks) && blocks.length === 0)) {
    const json = JSON.stringify(entry, null, 2);
    return `<div class="sf-expand-inner"><div class="sf-block">
      <span class="sf-block-type btype-other">raw</span>
      <div class="sf-block-body muted">${syntaxHighlight(esc(json))}</div>
    </div></div>`;
  }

  const items = Array.isArray(blocks) ? blocks : [{ type: 'text', text: String(blocks) }];

  const html = items.map(block => {
    const btype = block.type || 'other';
    const cls   = `btype-${btype.replace(/[^a-zA-Z]/g, '')}`;
    let body    = '';

    if (btype === 'text') {
      body = esc(block.text || '');
    } else if (btype === 'thinking') {
      body = `<span style="color:var(--muted);font-style:italic">${esc(truncate(block.thinking || '', 400))}</span>`;
    } else if (btype === 'toolCall') {
      const args = JSON.stringify(block.arguments ?? {}, null, 2);
      body = `<strong style="color:#fbbf24">${esc(block.name || '')}</strong>` +
             `<span style="color:var(--muted)"> #${esc(block.id || '')}</span>\n` +
             syntaxHighlight(esc(args));
    } else if (btype === 'toolResult') {
      const txt = Array.isArray(block.content)
        ? block.content.map(c => c?.text ?? JSON.stringify(c)).join('\n')
        : (block.content ?? '');
      body = esc(String(txt));
    } else {
      body = syntaxHighlight(esc(JSON.stringify(block, null, 2)));
    }

    return `<div class="sf-block">
      <span class="sf-block-type ${cls}">${esc(btype)}</span>
      <div class="sf-block-body">${body}</div>
    </div>`;
  }).join('');

  return `<div class="sf-expand-inner">${html}</div>`;
}

function closeSfModal() {
  document.getElementById('sf-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function handleSfOverlayClick(e) {
  if (e.target === document.getElementById('sf-modal')) closeSfModal();
}

function copySFJSON() {
  if (!_sfJSON) return;
  navigator.clipboard.writeText(_sfJSON).then(() => {
    const btn = document.getElementById('sf-copy-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy JSON';
      btn.classList.remove('copied');
    }, 2000);
  });
}

function syntaxHighlight(json) {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          return `<span class="json-key">${match}</span>`;
        }
        return `<span class="json-str">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span class="json-bool">${match}</span>`;
      if (/null/.test(match))       return `<span class="json-null">${match}</span>`;
      return `<span class="json-num">${match}</span>`;
    }
  );
}
