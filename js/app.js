import { DEFAULT_TASKS, DEFAULT_SETTINGS, SYSTEMS, AREAS, AREAS_VERSION, PRIORITIES } from './tasks-default.js';
import {
  todayStr, addMonths, daysBetween, currentHours, usageRate, allStatuses, sortStatuses,
  taskStatus, lastInterventionFor, interventionCost, issueCost, sortIssues, buildICS, isNum, num, parseNum, round1,
  fmtDate, fmtMoney, fmtHours, hourPoints, sanitizeRecord, tripEngineHours, tripDays, tripStats, fuelCost, fuelConsumption,
} from './logic.js';
import {
  Repo, uid, cloudConfigured, currentUser, signIn, signUp, resetPassword, signOutCloud,
  readLocalDump, clearLocalData, COLLECTIONS,
} from './store.js';

const APP_VERSION = '1.3.0';
const repo = new Repo();
const $view = document.getElementById('view');
const $sync = document.getElementById('sync');
let seededCloud = false;
let draft = null; // formulario de intervención en curso
let tripDraft = null; // formulario de navegación o repostaje en curso
let issueDraft = null; // formulario de correctivo (alta, edición o cierre)
let lastRoute = '';

// ───────────────────────── Utilidades ─────────────────────────
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sysName = (id) => {
  if (id === 'combustible') return 'Combustible';
  if (id === 'varios') return 'Varias áreas';
  return (AREAS.find((s) => s.id === id) || { name: 'Otros' }).name;
};
const areaName = sysName;
const validArea = (id) => AREAS.some((a) => a.id === id);
const prioName = (id) => (PRIORITIES.find((p) => p.id === id) || PRIORITIES[2]).name;

function areaSelect(name, value, { all = false, extra = [] } = {}) {
  const opts = [
    ...(all ? [{ id: '', name: 'Todas las áreas' }] : []),
    ...AREAS,
    ...extra,
  ];
  return `<select name="${esc(name)}">${opts.map((a) => `<option value="${esc(a.id)}" ${a.id === value ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
}

function settings() {
  const doc = repo.state.meta.find((m) => m.id === 'settings') || {};
  return { ...DEFAULT_SETTINGS, ...doc };
}

function saveSettings(patch) {
  const cur = repo.state.meta.find((m) => m.id === 'settings') || { id: 'settings' };
  return repo.put('meta', { ...cur, ...patch, id: 'settings' });
}

function taskById(id) {
  return repo.state.tasks.find((t) => t.id === id);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), Math.min(9000, 2200 + msg.length * 45));
}

function go(hash) {
  if (location.hash === hash) render(true);
  else location.hash = hash;
}

function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  return { parts, params, key: parts[0] || '' };
}

function intervalText(t) {
  const p = [];
  if (isNum(t.intervalHours)) p.push(`${t.intervalHours} h`);
  if (isNum(t.intervalMonths)) p.push(monthsText(t.intervalMonths));
  if (t.type === 'caducidad') {
    return p.length ? `Por fecha de caducidad (si no la anotas: ${p.join(' o ')})` : 'Por fecha de caducidad';
  }
  return p.length ? `Cada ${p.join(' o ')}` : 'Sin intervalo';
}

function monthsText(m) {
  if (m % 12 === 0) return m === 12 ? '1 año' : `${m / 12} años`;
  return m === 1 ? '1 mes' : `${m} meses`;
}

function relDays(d) {
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  if (d > 0) return `en ${d} días`;
  return `hace ${-d} días`;
}

function dueText(s) {
  if (s.status === 'nohistory') return 'Sin registro';
  if (s.status === 'inactive') return 'Desactivada';
  if (s.noDate) return s.task.type === 'caducidad' ? 'Falta la fecha de caducidad' : 'Faltan datos para calcularla';
  const parts = [];
  if (s.hoursLeft !== null) {
    if (s.hoursLeft <= 0) parts.push(`pasada ${fmtHours(-s.hoursLeft)}`);
    else {
      let txt = `faltan ${fmtHours(s.hoursLeft)}`;
      if (s.estDateFromHours) txt += ` (≈ ${fmtDate(s.estDateFromHours, { day: 'numeric', month: 'short' })})`;
      parts.push(txt);
    }
  }
  if (s.dueDate) {
    if (s.daysLeft < 0) parts.push(`venció el ${fmtDate(s.dueDate)}`);
    else if (s.daysLeft <= 60) parts.push(`${relDays(s.daysLeft)}, ${fmtDate(s.dueDate, { day: 'numeric', month: 'short' })}`);
    else parts.push(fmtDate(s.dueDate));
  }
  if (!parts.length && s.missingHours) return 'Faltan las horas del último registro';
  const txt = parts.join(' o ');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

const STATUS_LABEL = {
  overdue: 'Vencida',
  soon: 'Pronto',
  ok: 'Al día',
  nohistory: 'Sin historial',
  inactive: 'Desactivada',
};

const ICON = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v14M12 4l7 12H12M12 6 6 15h6M4 19h16l-2 2H6z"/></svg>',
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h10l3 3v15H6zM9 9h7M9 13h7M9 17h4"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

// ───────────────────────── Arranque ─────────────────────────
async function boot() {
  registerSW();
  window.addEventListener('online', updateSyncBadge);
  window.addEventListener('offline', updateSyncBadge);
  // Pide al navegador que no borre los datos de la app para liberar espacio
  navigator.storage?.persist?.().catch(() => {});

  let usedCloud = false;
  if (localStorage.getItem('velero.mode') === 'cloud' && cloudConfigured()) {
    try {
      const user = await currentUser();
      if (user) {
        await repo.useCloud(user);
        usedCloud = true;
      }
    } catch (e) {
      console.error(e);
    }
  }
  if (!usedCloud) {
    await repo.useLocal();
    await ensureDefaults();
  }

  repo.onChange(() => {
    updateSyncBadge();
    checkCloudSeed();
    scheduleRender();
  });
  checkCloudSeed();
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeViewer();
  });
  updateSyncBadge();
  currentHash = location.hash;
  render(true);
}

// En la nube, las tareas por defecto solo se crean cuando el servidor ha confirmado
// lo que ya hay (si no, otro dispositivo sin sincronizar podría pisar datos).
function checkCloudSeed() {
  const sync = repo.sync;
  if (sync.mode === 'cloud' && sync.serverConfirmed && !seededCloud) {
    seededCloud = true;
    ensureDefaults();
  }
}

// ───────────────────────── Navegación y borradores ─────────────────────────
let currentHash = '';
let formDirty = false;
const DRAFT_PREFIX = 'velero.draft:';

function onHashChange() {
  if (formDirty && location.hash !== currentHash) {
    if (!confirm('Tienes cambios sin guardar. ¿Salir y descartarlos?')) {
      history.replaceState(null, '', currentHash || '#/');
      return;
    }
    dropStoredDraft(currentHash);
  }
  formDirty = false;
  currentHash = location.hash;
  closeViewer();
  render(true);
  $view.focus({ preventScroll: true });
}

function markDirty(d) {
  formDirty = true;
  if (d) storeDraft(d);
}

function formSaved(key) {
  formDirty = false;
  dropStoredDraft(key);
}

function storeDraft(d) {
  clearTimeout(storeDraft.t);
  storeDraft.t = setTimeout(() => {
    const o = { ...d, taskIds: d.taskIds ? [...d.taskIds] : undefined };
    try {
      sessionStorage.setItem(DRAFT_PREFIX + d.key, JSON.stringify(o));
    } catch {
      try { // sin espacio: guardar sin las fotos nuevas
        sessionStorage.setItem(DRAFT_PREFIX + d.key, JSON.stringify({ ...o, photos: (o.photos || []).filter((p) => p.existing) }));
      } catch { /* nada */ }
    }
  }, 250);
}

function loadStoredDraft(key) {
  try {
    const o = JSON.parse(sessionStorage.getItem(DRAFT_PREFIX + key) || 'null');
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.taskIds)) o.taskIds = new Set(o.taskIds);
    formDirty = true;
    return o;
  } catch {
    return null;
  }
}

function dropStoredDraft(key) {
  clearTimeout(storeDraft.t); // que un guardado pendiente no lo resucite
  try { sessionStorage.removeItem(DRAFT_PREFIX + key); } catch { /* nada */ }
}

// Evita guardar dos veces con un doble toque
async function guarded(form, fn) {
  if (form.dataset.busy) return;
  form.dataset.busy = '1';
  const btns = form.querySelectorAll('button[type=submit]');
  btns.forEach((b) => (b.disabled = true));
  try {
    await fn();
  } finally {
    delete form.dataset.busy;
    btns.forEach((b) => (b.disabled = false));
  }
}

// Comprueba que unas horas de motor encajan con las lecturas de alrededor.
// Devuelve un aviso (texto) o null.
function hoursWarning(hours, date) {
  const pts = hourPoints(repo.state);
  let before = null, after = null;
  for (const p of pts) {
    if (p.date <= date) before = p;
    else if (!after) after = p;
  }
  if (before) {
    const days = Math.max(1, daysBetween(before.date, date));
    if (hours < before.hours - 0.05 && before.date < date) return `Es menos que la lectura del ${fmtDate(before.date)} (${fmtHours(before.hours)}).`;
    if (hours > before.hours + 24 * days) return `Son ${fmtHours(round1(hours - before.hours))} más que la lectura del ${fmtDate(before.date)}: más de las que caben en ese tiempo.`;
  }
  if (after && hours > after.hours + 0.05) return `Es más que la lectura posterior del ${fmtDate(after.date)} (${fmtHours(after.hours)}).`;
  return null;
}

function confirmHours(hours, date) {
  if (hours === null) return true;
  const w = hoursWarning(hours, date);
  return !w || confirm(`${w} ¿Guardar ${fmtHours(hours)} igualmente?`);
}

// Añade las tareas del catálogo que falten (también las que traigan versiones nuevas).
async function ensureDefaults() {
  const s = settings();
  const deleted = new Set(s.deletedDefaults || []);
  const have = new Set(repo.state.tasks.map((t) => t.id));
  const missing = DEFAULT_TASKS.filter((t) => !have.has(t.id) && !deleted.has(t.id));
  for (const t of missing) await repo.put('tasks', { ...t, createdAt: new Date().toISOString() });
  if (!repo.state.meta.find((m) => m.id === 'settings')) await saveSettings({ areasVersion: AREAS_VERSION });
  await migrateAreas();
}

// v1.3: las tareas pasan de «sistemas» a «áreas» más finas.
// Las predefinidas toman su área nueva; las propias con un sistema que ya no existe, la más parecida.
async function migrateAreas() {
  const s = settings();
  if ((s.areasVersion || 1) >= AREAS_VERSION) return;
  const byId = new Map(DEFAULT_TASKS.map((t) => [t.id, t]));
  const OLD = { jarcia: 'jarcia-labor' };
  for (const t of repo.state.tasks) {
    const def = t.builtin ? byId.get(t.id) : null;
    const area = def ? def.system : validArea(t.system) ? t.system : OLD[t.system] || 'otros';
    if (area !== t.system) await repo.put('tasks', { ...t, system: area });
  }
  await saveSettings({ areasVersion: AREAS_VERSION });
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render(false);
  });
}

// Las pantallas con formulario no se repintan solas, para no perder lo que escribes.
const FORM_ROUTES = new Set(['registrar', 'editar-intervencion', 'editar-tarea', 'ajustes', 'nueva-tarea', 'navegar', 'editar-navegacion', 'repostar', 'editar-repostaje', 'nuevo-correctivo', 'editar-correctivo', 'cerrar-correctivo']);

function render(force) {
  const r = route();
  const formKey = formRouteKey(r);
  if (!force && FORM_ROUTES.has(formKey)) return;
  // Un formulario que se abandona no debe reaparecer relleno la próxima vez
  if (draft && draft.key !== location.hash) draft = null;
  if (issueDraft && issueDraft.key !== location.hash) issueDraft = null;
  if (tripDraft && tripDraft.key !== location.hash) tripDraft = null;
  const routeId = location.hash;
  const scroll = routeId === lastRoute ? window.scrollY : 0;
  lastRoute = routeId;
  setNav(r.key);
  let html;
  switch (formKey) {
    case '': html = viewHome(); break;
    case 'historial': html = viewHistory(r); break;
    case 'intervencion': html = viewIntervention(r.parts[1]); break;
    case 'registrar': html = viewRegister(r); break;
    case 'editar-intervencion': html = viewRegister(r, r.parts[1]); break;
    case 'tareas': html = viewWork(r, 'preventivos'); break;
    case 'trabajos': html = viewWork(r); break;
    case 'correctivo': html = viewIssue(r.parts[1]); break;
    case 'nuevo-correctivo': html = viewIssueForm(r); break;
    case 'editar-correctivo': html = viewIssueForm(r, r.parts[1]); break;
    case 'cerrar-correctivo': html = viewIssueClose(r.parts[1]); break;
    case 'tarea': html = viewTask(r.parts[1]); break;
    case 'editar-tarea': html = viewTaskEdit(r.parts[1]); break;
    case 'nueva-tarea': html = viewTaskEdit(null); break;
    case 'horas': html = viewHours(); break;
    case 'ajustes': html = viewSettings(); break;
    case 'nuevo': html = viewNew(); break;
    case 'bitacora': html = viewLogbook(r); break;
    case 'navegacion': html = viewTrip(r.parts[1]); break;
    case 'navegar': html = viewTripForm(r); break;
    case 'editar-navegacion': html = viewTripForm(r, r.parts[1]); break;
    case 'repostaje': html = viewFuel(r.parts[1]); break;
    case 'repostar': html = viewFuelForm(r); break;
    case 'editar-repostaje': html = viewFuelForm(r, r.parts[1]); break;
    default: html = viewHome();
  }
  $view.innerHTML = html;
  bindView(formKey, r);
  window.scrollTo(0, scroll);
}

function formRouteKey(r) {
  const [a, b, c] = r.parts;
  if (a === 'intervencion' && c === 'editar') return 'editar-intervencion';
  if (a === 'tarea' && b === 'nueva') return 'nueva-tarea';
  if (a === 'tarea' && c === 'editar') return 'editar-tarea';
  if (a === 'navegacion' && c === 'editar') return 'editar-navegacion';
  if (a === 'repostaje' && c === 'editar') return 'editar-repostaje';
  if (a === 'correctivo' && b === 'nuevo') return 'nuevo-correctivo';
  if (a === 'correctivo' && c === 'editar') return 'editar-correctivo';
  if (a === 'correctivo' && c === 'cerrar') return 'cerrar-correctivo';
  return a || '';
}

function setNav(key) {
  const map = {
    '': 'home', horas: 'home',
    tarea: 'work', tareas: 'work', trabajos: 'work', correctivo: 'work',
    bitacora: 'trips', navegacion: 'trips', navegar: 'add',
    historial: 'log', intervencion: 'log', repostaje: 'log',
    ajustes: 'gear', registrar: 'add', nuevo: 'add', repostar: 'add',
  };
  const cur = map[key] || 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === cur) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function updateSyncBadge() {
  const s = repo.sync;
  const online = navigator.onLine;
  let txt = '';
  let cls = '';
  if (s.mode === 'cloud') {
    if (!online) { txt = 'Sin conexión: se sincronizará al volver la cobertura'; cls = 'off'; }
    else if (s.pending) { txt = 'Sincronizando…'; cls = 'busy'; }
    else { txt = 'Sincronizado'; cls = 'ok'; }
  } else {
    txt = cloudConfigured() ? 'Solo en este dispositivo: entra en Ajustes para sincronizar' : 'Solo en este dispositivo';
    cls = 'local';
  }
  $sync.textContent = txt;
  $sync.className = 'sync ' + cls;
}

// ───────────────────────── Estado (inicio) ─────────────────────────
function viewHome() {
  const st = settings();
  const statuses = sortStatuses(allStatuses(repo.state, st));
  const groups = { overdue: [], soon: [], nohistory: [], ok: [] };
  for (const s of statuses) if (groups[s.status]) groups[s.status].push(s);
  const cur = currentHours(repo.state);
  const rate = usageRate(repo.state);

  const list = (arr) => `<ul class="rows">${arr.map(taskRow).join('')}</ul>`;
  const blank = !groups.overdue.length && !groups.soon.length && !groups.ok.length;

  return `
  <section class="meter-card" aria-labelledby="meter-title">
    <div class="meter-head">
      <h1 id="meter-title">${esc(st.boatName)}</h1>
      <p class="meter-sub">${esc(st.engine)}</p>
    </div>
    ${meterDigits(cur ? cur.hours : null)}
    <p class="meter-info">
      ${cur ? `Lectura del ${fmtDate(cur.date)}.` : 'Apunta las horas que marca el contador del motor.'}
      ${rate ? ` Uso medio: unas ${Math.round(rate * 30.44)} h al mes.` : ''}
    </p>
    <form class="meter-form" id="hours-form">
      <label for="hours-input" class="sr">Horas de motor</label>
      <input id="hours-input" name="hours" type="text" inputmode="decimal"
        placeholder="${cur ? esc(cur.hours.toLocaleString('es-ES')) : 'Horas del contador'}" required>
      <button class="btn primary" type="submit">Anotar horas</button>
    </form>
    <a class="meter-link" href="#/horas">Ver lecturas anteriores</a>
  </section>

  <div class="quick">
    <a class="btn primary" href="#/navegar">Registrar navegación</a>
    <a class="btn" href="#/correctivo/nuevo">Correctivo</a>
    <a class="btn" href="#/registrar">Preventivo</a>
    <a class="btn" href="#/repostar">Repostaje</a>
  </div>
  ${lastTripLine()}
  ${pendingIssuesBlock()}

  ${blank ? `
  <section class="notice">
    <h2>Para empezar</h2>
    <p>Registra cuándo se hizo por última vez cada tarea, aunque sea aproximado (por ejemplo, el último cambio de aceite o la revisión de la balsa). Con eso la app calcula cuándo te toca la siguiente.</p>
    <a class="btn primary" href="#/registrar">Registrar una intervención</a>
  </section>` : ''}

  ${groups.overdue.length ? `<section><h2 class="grp overdue">Preventivo vencido <span class="count">${groups.overdue.length}</span></h2>${list(groups.overdue)}</section>` : ''}
  ${groups.soon.length ? `<section><h2 class="grp soon">Preventivo que toca pronto <span class="count">${groups.soon.length}</span></h2>${list(groups.soon)}</section>` : ''}
  ${!groups.overdue.length && !groups.soon.length && !blank ? `<p class="allclear">Nada vencido ni próximo. Buen viento.</p>` : ''}
  ${groups.nohistory.length ? `
  <details class="fold" ${blank ? '' : ''}>
    <summary><h2 class="grp nohistory">Sin historial <span class="count">${groups.nohistory.length}</span></h2></summary>
    <p class="hint">Estas tareas no tienen ningún registro todavía. Abre una y registra la última vez que se hizo.</p>
    ${list(groups.nohistory)}
  </details>` : ''}
  ${groups.ok.length ? `
  <details class="fold">
    <summary><h2 class="grp ok">Al día <span class="count">${groups.ok.length}</span></h2></summary>
    ${list(groups.ok)}
  </details>` : ''}
  <p class="more"><a href="#/trabajos?tipo=preventivos">Ver y editar las tareas de mantenimiento preventivo</a></p>
  `;
}

function pendingIssuesBlock() {
  const open = sortIssues(repo.state.issues.filter((i) => i.status !== 'hecho'));
  if (!open.length) return '';
  const shown = open.slice(0, 5);
  return `<section>
    <h2 class="grp ${open.some((i) => i.priority === 'urgente') ? 'overdue' : 'soon'}">Correctivos pendientes <span class="count">${open.length}</span></h2>
    <ul class="rows">${shown.map((i) => issueRow(i)).join('')}</ul>
    ${open.length > shown.length ? `<p class="more"><a href="#/trabajos">Ver los ${open.length} correctivos pendientes</a></p>` : ''}
  </section>`;
}

function lastTripLine() {
  const t = [...repo.state.trips].sort(byDateDesc)[0];
  if (!t) return '';
  return `<p class="lasttrip">Última navegación: <a href="#/navegacion/${encodeURIComponent(t.id)}">${fmtDate(t.date)}, ${esc(tripRoute(t))}</a></p>`;
}

function meterDigits(hours) {
  let int = '-----';
  let dec = '-';
  if (isNum(hours)) {
    const [i, d = '0'] = round1(hours).toFixed(1).split('.');
    int = i.padStart(5, '0');
    dec = d;
  }
  const cells = [...int].map((c) => `<span class="dg">${c}</span>`).join('');
  return `<div class="meter" role="img" aria-label="${isNum(hours) ? fmtHours(hours) + ' de motor' : 'Sin lectura de horas'}">
    ${cells}<span class="dg tenth">${dec}</span><span class="unit">h</span></div>`;
}

function taskRow(s) {
  return `<li><a class="row st-${s.status}" href="#/tarea/${encodeURIComponent(s.task.id)}">
    <span class="flag" aria-hidden="true"></span>
    <span class="row-main">
      <span class="row-title">${esc(s.task.name)}</span>
      <span class="row-sub">${esc(sysName(s.task.system))}</span>
    </span>
    <span class="row-due"><span class="sr">${STATUS_LABEL[s.status]}: </span>${esc(dueText(s))}</span>
  </a></li>`;
}

// ───────────────────────── Tarea ─────────────────────────
function viewTask(id) {
  const t = taskById(id);
  if (!t) return notFound('Esta tarea ya no existe.');
  const st = settings();
  const s = taskStatus(t, repo.state, st);
  const hist = repo.state.interventions
    .filter((i) => (i.taskIds || []).includes(t.id))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const facts = [];
  facts.push(['Intervalo', intervalText(t)]);
  facts.push(['Aviso', `${t.noticeHours ?? st.noticeHours} h o ${t.noticeDays ?? st.noticeDays} días antes`]);
  if (s.last) facts.push(['Última vez', `${fmtDate(s.last.date)}${isNum(s.last.engineHours) ? `, a las ${fmtHours(s.last.engineHours)}` : ''}`]);
  if (s.dueDate) facts.push([t.type === 'caducidad' ? 'Caduca / próxima revisión' : 'Próxima por fecha', `${fmtDate(s.dueDate)} (${relDays(s.daysLeft)})`]);
  if (s.dueHours !== null) facts.push(['Próxima por horas', `a las ${fmtHours(s.dueHours)}${s.hoursLeft !== null ? `, ${s.hoursLeft > 0 ? 'faltan ' + fmtHours(s.hoursLeft) : 'pasada ' + fmtHours(-s.hoursLeft)}` : ''}`]);
  if (s.estDateFromHours && s.hoursLeft > 0) facts.push(['Estimación por uso', `hacia el ${fmtDate(s.estDateFromHours)}`]);
  if (s.hoursEstimated) facts.push(['Horas', 'El último registro no tiene horas de motor: se han estimado con tus lecturas de esa época.']);
  if (s.noDate) facts.push(['Próxima', t.type === 'caducidad' ? 'Falta la fecha de caducidad: registra la tarea de nuevo anotándola, o pon un intervalo en meses.' : 'Faltan datos para calcularla.']);
  if (s.missingHours) facts.push(['Horas', 'El último registro no tiene horas de motor: no se puede calcular el aviso por horas.']);

  return `
  ${backLink('#/', 'Estado')}
  <article class="detail">
    <p class="badge st-${s.status}">${STATUS_LABEL[s.status]}</p>
    <h1>${esc(t.name)}</h1>
    <p class="muted">${esc(sysName(t.system))}</p>
    <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ''}
    <div class="actions">
      <a class="btn primary" href="#/registrar?tarea=${encodeURIComponent(t.id)}">Registrar intervención</a>
      <a class="btn" href="#/tarea/${encodeURIComponent(t.id)}/editar">Editar tarea</a>
    </div>
  </article>
  <section>
    <h2>Historial</h2>
    ${hist.length ? `<ul class="log">${hist.map(logRow).join('')}</ul>` : '<p class="muted">Todavía no hay intervenciones de esta tarea.</p>'}
  </section>`;
}

function backLink(href, label) {
  return `<a class="back" href="${href}">${ICON.back}<span>${esc(label)}</span></a>`;
}

function notFound(msg) {
  return `${backLink('#/', 'Estado')}<p class="notice">${esc(msg)}</p>`;
}

// ───────────────────────── Historial ─────────────────────────
function interventionTitle(i) {
  const names = (i.taskIds || []).map((id) => taskById(id)?.name).filter(Boolean);
  if (i.title) return names.length ? `${i.title}: ${names.join(', ')}` : i.title;
  return names.join(', ') || 'Intervención';
}

function interventionSystem(i) {
  const sys = new Set((i.taskIds || []).map((id) => taskById(id)?.system).filter(Boolean));
  if (sys.size === 1) return [...sys][0];
  if (sys.size === 0) return 'otros';
  return 'varios';
}

function logRow(i) {
  const cost = interventionCost(i);
  const photos = (i.photoIds || []).length;
  return `<li><a class="logrow" href="#/intervencion/${encodeURIComponent(i.id)}">
    <time datetime="${esc(i.date)}">${fmtDate(i.date)}</time>
    <span class="log-title">${esc(interventionTitle(i))}</span>
    <span class="log-meta">
      ${isNum(i.engineHours) ? `<span>${fmtHours(i.engineHours)}</span>` : ''}
      <span>${i.doneBy === 'taller' ? esc(i.workshop || 'Taller') : 'Yo'}</span>
      ${cost ? `<span class="money">${fmtMoney(cost)}</span>` : ''}
      ${photos ? `<span class="pic">${ICON.cam}${photos}</span>` : ''}
    </span>
  </a></li>`;
}

const HIST_TYPES = [
  { id: 'todo', name: 'Todo' },
  { id: 'preventivo', name: 'Preventivo' },
  { id: 'correctivo', name: 'Correctivo' },
  { id: 'combustible', name: 'Combustible' },
];

function interventionAreas(i) {
  const set = new Set((i.taskIds || []).map((id) => taskById(id)?.system).filter(Boolean));
  return set.size ? set : new Set(['otros']);
}

function viewHistory(r) {
  let kindParam = r.params.get('tipo');
  if (kindParam === 'mantenimiento') kindParam = 'preventivo'; // enlaces antiguos
  const kind = HIST_TYPES.some((t) => t.id === kindParam) ? kindParam : 'todo';
  const areaParam = r.params.get('area') || '';
  const area = validArea(areaParam) || areaParam === 'combustible' ? areaParam : '';
  const entries = [
    ...repo.state.interventions.map((i) => ({ kind: 'preventivo', date: i.date, obj: i, cost: interventionCost(i), areas: interventionAreas(i) })),
    ...repo.state.issues.filter((i) => i.status === 'hecho').map((i) => ({ kind: 'correctivo', date: i.doneDate, obj: i, cost: issueCost(i), areas: new Set([i.area]) })),
    ...repo.state.fuel.map((f) => ({ kind: 'combustible', date: f.date, obj: f, cost: fuelCost(f), areas: new Set(['combustible']) })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const years = [...new Set(entries.map((e) => e.date.slice(0, 4)))].sort().reverse();
  let year = r.params.get('anio') || (years[0] || '');
  if (year !== 'todo' && !years.includes(year)) year = years[0] || '';
  const list = entries.filter((e) =>
    (year === 'todo' || e.date.startsWith(year)) &&
    (kind === 'todo' || e.kind === kind) &&
    (!area || e.areas.has(area)));
  const total = list.reduce((s, e) => s + e.cost, 0);
  const groups = {};
  for (const e of list) {
    const k = area ? e.kind : e.areas.size === 1 ? [...e.areas][0] : 'varios';
    groups[k] = (groups[k] || 0) + e.cost;
  }
  const rows = Object.entries(groups).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, v]) => v));
  const label = (k) => (area ? (HIST_TYPES.find((t) => t.id === k) || {}).name : areaName(k));
  const work = list.filter((e) => e.kind !== 'combustible');
  const mine = work.filter((e) => e.obj.doneBy !== 'taller').reduce((s, e) => s + e.cost, 0);
  const shops = work.reduce((s, e) => s + e.cost, 0) - mine;
  const fuelList = list.filter((e) => e.kind === 'combustible').map((e) => e.obj);
  const liters = fuelList.reduce((s, f) => s + num(f.liters), 0);
  const cons = fuelConsumption(repo.state.fuel);
  const q = (k, y, a = area) => esc(`#/historial?tipo=${encodeURIComponent(k)}&anio=${encodeURIComponent(y)}${a ? `&area=${encodeURIComponent(a)}` : ''}`);

  if (!entries.length) {
    return `<h1>Historial</h1>
    <section class="notice"><p>Aún no hay nada registrado. Aquí verás el mantenimiento preventivo, los correctivos hechos y el combustible, con lo que ha costado cada cosa.</p>
    <div class="actions"><a class="btn primary" href="#/registrar">Registrar preventivo</a><a class="btn" href="#/repostar">Registrar repostaje</a></div></section>`;
  }

  const count = list.length;
  return `
  <h1>Historial</h1>
  <nav class="chips" aria-label="Tipo">
    ${HIST_TYPES.map((t) => `<a href="${q(t.id, year)}" ${kind === t.id ? 'aria-current="true"' : ''}>${esc(t.name)}</a>`).join('')}
  </nav>
  <nav class="chips" aria-label="Año">
    ${years.map((y) => `<a href="${q(kind, y)}" ${y === year ? 'aria-current="true"' : ''}>${esc(y)}</a>`).join('')}
    <a href="${q(kind, 'todo')}" ${year === 'todo' ? 'aria-current="true"' : ''}>Todos los años</a>
  </nav>
  <form class="areafilter" id="hist-area" data-tipo="${esc(kind)}" data-anio="${esc(year)}">
    <label>Área ${areaSelect('area', area, { all: true, extra: [{ id: 'combustible', name: 'Combustible' }] })}</label>
  </form>
  <section class="spend">
    <p class="spend-total"><span class="money big">${fmtMoney(total)}</span> en ${count} ${count === 1 ? 'apunte' : 'apuntes'}${year === 'todo' ? '' : ` en ${esc(year)}`}${area ? `, ${esc(areaName(area).toLowerCase())}` : ''}</p>
    ${work.length ? `<p class="muted">Trabajos: material propio ${fmtMoney(mine)}, talleres ${fmtMoney(shops)}.</p>` : ''}
    ${fuelList.length ? `<p class="muted">Combustible: ${fmtNum(liters)} L${pplText(fuelList)}.${cons ? ` Consumo medio del motor: ${fmtNum(cons.lph, 2)} L/h.` : ''}</p>` : ''}
    ${rows.length > 1 ? `<ul class="bars">${rows.map(([k, v]) => `
      <li><span class="bar-label">${esc(label(k))}</span>
      <span class="bar"><span class="${k === 'combustible' ? 'fuelbar' : ''}" style="width:${Math.max(2, (v / max) * 100)}%"></span></span>
      <span class="money">${fmtMoney(v)}</span></li>`).join('')}</ul>` : ''}
  </section>
  ${list.length ? `<ul class="log">${list.map((e) => (e.kind === 'combustible' ? fuelRow(e.obj) : e.kind === 'correctivo' ? issueLogRow(e.obj) : logRow(e.obj))).join('')}</ul>`
    : '<p class="muted">Nada registrado con este filtro.</p>'}`;
}

function issueLogRow(i) {
  const cost = issueCost(i);
  const photos = (i.photoIds || []).length;
  return `<li><a class="logrow" href="#/correctivo/${encodeURIComponent(i.id)}">
    <time datetime="${esc(i.doneDate)}">${fmtDate(i.doneDate)}</time>
    <span class="log-title">Correctivo: ${esc(i.title)}</span>
    <span class="log-meta">
      <span>${esc(areaName(i.area))}</span>
      <span>${i.doneBy === 'taller' ? esc(i.workshop || 'Taller') : 'Yo'}</span>
      ${cost ? `<span class="money">${fmtMoney(cost)}</span>` : ''}
      ${photos ? `<span class="pic">${ICON.cam}${photos}</span>` : ''}
    </span>
  </a></li>`;
}

function pplText(list) {
  const both = list.filter((f) => num(f.liters) > 0 && num(f.total) > 0);
  const l = both.reduce((s, f) => s + num(f.liters), 0);
  return l ? `, a ${fmtMoney(both.reduce((s, f) => s + num(f.total), 0) / l)} el litro de media` : '';
}

function viewIntervention(id) {
  const i = repo.state.interventions.find((x) => x.id === id);
  if (!i) return notFound('Esta intervención ya no existe.');
  const tasks = (i.taskIds || []).map(taskById).filter(Boolean);
  const cost = interventionCost(i);
  const exps = Object.entries(i.expiries || {}).filter(([, v]) => v);
  return `
  ${backLink('#/historial', 'Historial')}
  <article class="detail">
    <p class="muted">${fmtDate(i.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <h1>${esc(i.title || (tasks.length === 1 ? tasks[0].name : multiTitle(i, tasks)))}</h1>
    <dl class="facts">
      <dt>Horas de motor</dt><dd>${isNum(i.engineHours) ? fmtHours(i.engineHours) : 'No anotadas'}</dd>
      <dt>Hecho por</dt><dd>${i.doneBy === 'taller' ? esc(i.workshop || 'Taller') : 'Yo mismo'}</dd>
      <dt>Coste</dt><dd>${fmtMoney(cost)}</dd>
    </dl>
    ${tasks.length ? `<h2>Tareas</h2><ul class="plain">${tasks.map((t) => `<li><a href="#/tarea/${encodeURIComponent(t.id)}">${esc(t.name)}</a>${i.expiries && i.expiries[t.id] ? `, próxima: ${fmtDate(i.expiries[t.id])}` : ''}</li>`).join('')}</ul>` : ''}
    ${i.doneBy !== 'taller' && (i.materials || []).length ? `<h2>Material</h2>
      <table class="mat"><tbody>${i.materials.map((m) => `<tr><td>${esc(m.desc)}</td><td class="money">${fmtMoney(num(m.cost))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${i.notes ? `<h2>Notas</h2><p class="note pre">${esc(i.notes)}</p>` : ''}
    ${(i.photoIds || []).length ? `<h2>Factura</h2><div class="thumbs" id="thumbs" data-photos>${i.photoIds.map((p) => `<button class="thumb" data-action="open-photo" data-id="${esc(p)}" aria-label="Abrir factura"><span class="ph-loading">Cargando…</span></button>`).join('')}</div>` : ''}
    <div class="actions">
      <a class="btn primary" href="#/intervencion/${encodeURIComponent(i.id)}/editar">Editar</a>
      <button class="btn danger" data-action="delete-intervention" data-id="${esc(i.id)}">Borrar</button>
    </div>
  </article>`;
}

function multiTitle(i, tasks) {
  if (!tasks.length) return 'Intervención';
  const sys = interventionSystem(i);
  return sys === 'varios' ? `${tasks.length} tareas de mantenimiento` : `${tasks.length} tareas: ${sysName(sys).toLowerCase()}`;
}

const photoCache = new Map();

async function loadThumbs() {
  const btns = document.querySelectorAll('[data-photos] .thumb');
  for (const b of btns) {
    const p = await repo.getPhoto(b.dataset.id);
    if (!b.isConnected) return;
    if (!p) { b.innerHTML = '<span class="ph-loading">No disponible sin conexión</span>'; continue; }
    photoCache.set(p.id, p);
    if (p.mime === 'application/pdf') {
      // Enlace de verdad: en iPhone, abrir un PDF tras una espera lo bloquea el navegador
      const a = document.createElement('a');
      a.className = 'thumb';
      a.href = pdfUrl(p.data);
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = `<span class="pdf">PDF<br>${esc(p.name || '')}</span>`;
      b.replaceWith(a);
    } else {
      b.innerHTML = `<img src="${esc(p.data)}" alt="Factura">`;
    }
  }
}

// ───────────────────────── Registrar / editar intervención ─────────────────────────
function newDraft(r, existing) {
  if (existing) {
    return {
      id: existing.id,
      isNew: false,
      date: existing.date,
      engineHours: isNum(existing.engineHours) ? String(existing.engineHours) : '',
      taskIds: new Set(existing.taskIds || []),
      title: existing.title || '',
      doneBy: existing.doneBy || 'yo',
      materials: (existing.materials || []).map((m) => ({ ...m })),
      workshop: existing.workshop || '',
      invoiceTotal: isNum(existing.invoiceTotal) ? String(existing.invoiceTotal) : '',
      expiries: { ...(existing.expiries || {}) },
      notes: existing.notes || '',
      photos: (existing.photoIds || []).map((id) => ({ id, existing: true })),
      removedPhotos: [],
      createdAt: existing.createdAt,
      filter: '',
    };
  }
  const preId = r.params.get('tarea');
  const pre = preId && taskById(preId) ? preId : null;
  const cur = currentHours(repo.state);
  return {
    id: uid(),
    isNew: true,
    date: todayStr(),
    engineHours: '',
    hoursHint: cur ? cur.hours : null,
    taskIds: new Set(pre ? [pre] : []),
    title: '',
    doneBy: 'yo',
    materials: [{ desc: '', cost: '' }],
    workshop: '',
    invoiceTotal: '',
    expiries: {},
    notes: '',
    photos: [],
    removedPhotos: [],
    filter: '',
  };
}

function viewRegister(r, editId) {
  let existing = null;
  if (editId) {
    existing = repo.state.interventions.find((x) => x.id === editId);
    if (!existing) return notFound('Esta intervención ya no existe.');
  }
  const key = location.hash;
  if (!draft || draft.key !== key) {
    draft = loadStoredDraft(key) || newDraft(r, existing);
    draft.key = key;
  }
  const d = draft;
  const back = editId ? `#/intervencion/${encodeURIComponent(editId)}` : (r.params.get('tarea') ? `#/tarea/${encodeURIComponent(r.params.get('tarea'))}` : '#/');
  return `
  ${backLink(back, 'Cancelar')}
  <h1>${editId ? 'Editar intervención' : 'Registrar intervención'}</h1>
  <form id="reg-form" class="form" novalidate>
    <div class="grid2">
      <label>Fecha<input type="date" name="date" value="${esc(d.date)}" required max="${todayStr()}"></label>
      <label>Horas de motor<input type="text" name="engineHours" inputmode="decimal" value="${esc(d.engineHours)}"
        placeholder="${d.hoursHint != null ? 'Última: ' + esc(d.hoursHint.toLocaleString('es-ES')) : 'Si las sabes'}"></label>
    </div>

    <fieldset class="picker">
      <legend>Tareas realizadas <span class="count" id="sel-count">${d.taskIds.size}</span></legend>
      <div id="sel-chips" class="selchips">${selChips()}</div>
      <input type="search" id="task-filter" aria-label="Buscar tarea" enterkeyhint="search" placeholder="Buscar tarea (aceite, balsa, winches…)" value="${esc(d.filter)}" autocomplete="off">
      <div class="picklist" id="picklist">${pickList()}</div>
    </fieldset>

    <div id="expiries">${expiryFields()}</div>

    <label>Descripción <span class="muted">(opcional; obligatoria si no marcas ninguna tarea)</span>
      <input type="text" name="title" value="${esc(d.title)}" placeholder="Por ejemplo: avería de la bomba de achique"></label>

    <fieldset class="seg" role="radiogroup">
      <legend>¿Quién lo hizo?</legend>
      <label><input type="radio" name="doneBy" value="yo" ${d.doneBy === 'yo' ? 'checked' : ''}><span>Yo</span></label>
      <label><input type="radio" name="doneBy" value="taller" ${d.doneBy === 'taller' ? 'checked' : ''}><span>Taller o profesional</span></label>
    </fieldset>

    <div id="cost-block">${costBlock()}</div>

    <label>Notas<textarea name="notes" rows="3" placeholder="Marca del aceite, piezas, observaciones…">${esc(d.notes)}</textarea></label>

    <p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions sticky">
      <button class="btn primary" type="submit">${editId ? 'Guardar cambios' : 'Guardar intervención'}</button>
    </div>
  </form>`;
}

function selChips() {
  return [...draft.taskIds].map((id) => {
    const t = taskById(id);
    if (!t) return '';
    return `<button type="button" class="chip" data-action="unpick" data-id="${esc(id)}" aria-label="Quitar ${esc(t.name)}">${esc(t.name)} <span aria-hidden="true">×</span></button>`;
  }).join('');
}

function pickList() {
  const f = draft.filter.trim().toLowerCase();
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nf = norm(f);
  let html = '';
  for (const sys of SYSTEMS) {
    const tasks = repo.state.tasks
      .filter((t) => t.system === sys.id && (t.active || draft.taskIds.has(t.id)))
      .filter((t) => !nf || norm(t.name).includes(nf) || norm(sys.name).includes(nf))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (!tasks.length) continue;
    html += `<p class="pick-sys">${esc(sys.name)}</p>`;
    html += tasks.map((t) => `<label class="pick"><input type="checkbox" data-pick="${esc(t.id)}" ${draft.taskIds.has(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('');
  }
  return html || '<p class="muted">Ninguna tarea coincide. Puedes escribir una descripción abajo.</p>';
}

function expiryFields() {
  const exps = [...draft.taskIds].map(taskById).filter((t) => t && t.type === 'caducidad');
  if (!exps.length) return '';
  return `<fieldset><legend>Próxima caducidad o revisión</legend>
    <p class="hint">Anota la fecha que figura en la etiqueta o el certificado. Si la dejas vacía, se calculará con el intervalo de la tarea.</p>
    ${exps.map((t) => `<label>${esc(t.name)}<input type="date" data-expiry="${esc(t.id)}" value="${esc(draft.expiries[t.id] || '')}"></label>`).join('')}
  </fieldset>`;
}

// Borrador del formulario visible (mantenimiento o correctivo)
function curDraft() {
  return issueDraft && issueDraft.key === location.hash ? issueDraft : draft;
}

function costBlock(d = curDraft()) {
  if (d.doneBy === 'taller') {
    return `<fieldset><legend>Factura</legend>
      <div class="grid2">
        <label>Taller o profesional<input type="text" data-f="workshop" value="${esc(d.workshop)}" placeholder="Nombre"></label>
        <label>Total de la factura (€)<input type="text" data-f="invoiceTotal" inputmode="decimal" value="${esc(d.invoiceTotal)}"></label>
      </div>
      <div class="thumbs" id="draft-photos">${draftPhotos(d)}</div>
      <label class="btn file">${ICON.cam}<span>Añadir foto o PDF de la factura</span>
        <input type="file" id="photo-input" class="sr" accept="image/*,application/pdf" multiple></label>
    </fieldset>`;
  }
  const total = d.materials.reduce((s, m) => s + num(m.cost), 0);
  return `<fieldset><legend>Material</legend>
    <div id="materials">${d.materials.map((m, idx) => `
      <div class="matrow">
        <input type="text" data-mat="${idx}" data-k="desc" value="${esc(m.desc)}" placeholder="Material o pieza" aria-label="Material ${idx + 1}">
        <input type="text" data-mat="${idx}" data-k="cost" inputmode="decimal" value="${esc(m.cost)}" placeholder="€" aria-label="Coste ${idx + 1}">
        <button type="button" class="icon" data-action="del-mat" data-idx="${idx}" aria-label="Quitar línea">${ICON.trash}</button>
      </div>`).join('')}</div>
    <div class="matfoot"><button type="button" class="btn small" data-action="add-mat">Añadir línea</button>
    <span>Total: <strong class="money" id="mat-total">${fmtMoney(total)}</strong></span></div>
  </fieldset>`;
}

// list: 'photos' (factura) o 'problemPhotos' (fotos de la avería)
const PHOTO_BOX = { photos: 'draft-photos', problemPhotos: 'problem-photos' };

function draftPhotos(d = curDraft(), list = 'photos') {
  const alt = list === 'photos' ? 'Factura' : 'Foto';
  return (d[list] || []).map((p, idx) => `
    <div class="thumb" data-ph="${idx}">
      ${p.data ? (p.mime === 'application/pdf' ? `<span class="pdf">PDF<br>${esc(p.name || '')}</span>` : `<img src="${esc(p.data)}" alt="${alt} ${idx + 1}">`) : '<span class="ph-loading">Cargando…</span>'}
      <button type="button" class="icon del" data-action="del-photo" data-list="${list}" data-idx="${idx}" aria-label="Quitar foto">${ICON.trash}</button>
    </div>`).join('');
}

async function loadDraftPhotos(d = curDraft()) {
  for (const list of Object.keys(PHOTO_BOX)) {
    let changed = false;
    for (const p of d[list] || []) {
      if (p.existing && !p.data) {
        const ph = await repo.getPhoto(p.id);
        if (ph) { p.data = ph.data; p.mime = ph.mime; p.name = ph.name; changed = true; }
      }
    }
    const el = document.getElementById(PHOTO_BOX[list]);
    if (changed && el) el.innerHTML = draftPhotos(d, list);
  }
}

// Campos comunes de coste (material o factura) y fotos. Devuelven true si han tratado el evento.
function handleCostInput(el, d) {
  if (el.dataset.f) { d[el.dataset.f] = el.value; return true; }
  if (el.dataset.mat !== undefined) {
    d.materials[+el.dataset.mat][el.dataset.k] = el.value;
    const tot = document.getElementById('mat-total');
    if (tot) tot.textContent = fmtMoney(d.materials.reduce((s, m) => s + num(m.cost), 0));
    return true;
  }
  return false;
}

async function handleCostChange(el, d) {
  if (el.name === 'doneBy') {
    d.doneBy = el.value;
    document.getElementById('cost-block').innerHTML = costBlock(d);
    loadDraftPhotos(d);
    return true;
  }
  const list = el.id === 'photo-input' ? 'photos' : el.id === 'problem-input' ? 'problemPhotos' : null;
  if (!list) return false;
  const files = [...el.files];
  el.value = '';
  for (const f of files) {
    try {
      d[list].push(await fileToPhoto(f));
    } catch (err) {
      toast(err.message);
    }
  }
  document.getElementById(PHOTO_BOX[list]).innerHTML = draftPhotos(d, list);
  storeDraft(d);
  return true;
}

function bindRegister() {
  const form = document.getElementById('reg-form');
  if (!form) return;
  const d = draft;
  // En iPhone, la tecla «Buscar» del teclado no debe guardar el formulario
  document.getElementById('task-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id !== 'task-filter') markDirty(d);
    if (el.name === 'date') d.date = el.value;
    else if (el.name === 'engineHours') d.engineHours = el.value;
    else if (el.name === 'title') d.title = el.value;
    else if (el.name === 'notes') d.notes = el.value;
    else if (el.id === 'task-filter') { d.filter = el.value; document.getElementById('picklist').innerHTML = pickList(); }
    else if (el.dataset.expiry) d.expiries[el.dataset.expiry] = el.value;
    else handleCostInput(el, d);
  });
  form.addEventListener('change', async (e) => {
    const el = e.target;
    markDirty(d);
    if (el.dataset.pick) {
      if (el.checked) d.taskIds.add(el.dataset.pick); else d.taskIds.delete(el.dataset.pick);
      refreshPicked();
    } else {
      await handleCostChange(el, d);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, saveDraft);
  });
  loadDraftPhotos(d);
}

function refreshPicked() {
  document.getElementById('sel-count').textContent = draft.taskIds.size;
  document.getElementById('sel-chips').innerHTML = selChips();
  document.getElementById('expiries').innerHTML = expiryFields();
  const pl = document.getElementById('picklist');
  pl.querySelectorAll('[data-pick]').forEach((c) => (c.checked = draft.taskIds.has(c.dataset.pick)));
}

async function saveDraft() {
  const d = draft;
  const err = document.getElementById('form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  if (!d.date) return fail('Falta la fecha.');
  if (d.date > todayStr()) return fail('La fecha no puede ser futura.');
  for (const id of [...d.taskIds]) if (!taskById(id)) d.taskIds.delete(id);
  if (!d.taskIds.size && !d.title.trim()) return fail('Marca al menos una tarea o escribe una descripción.');
  const hours = d.engineHours.trim() === '' ? null : parseNum(d.engineHours);
  if (hours !== null && !(hours >= 0)) return fail('Las horas de motor no son válidas. Escribe solo el número, por ejemplo 1180,5.');
  if (d.doneBy === 'taller' && d.invoiceTotal.trim() && !(parseNum(d.invoiceTotal) >= 0)) return fail('El total de la factura no es un importe válido.');
  if (d.doneBy === 'yo' && d.materials.some((m) => String(m.cost).trim() && !(parseNum(m.cost) >= 0))) return fail('Algún coste de material no es un importe válido.');
  for (const id of d.taskIds) {
    const t = taskById(id);
    if (t && t.type === 'caducidad' && !isNum(t.intervalMonths) && !d.expiries[id]) return fail(`Anota la fecha de caducidad o próxima revisión de «${t.name}».`);
  }
  if (!confirmHours(hours, d.date)) return;

  // Fotos: guardar las nuevas, borrar las quitadas
  if (d.doneBy === 'taller') {
    for (const p of d.photos) {
      if (!p.existing) await repo.putPhoto({ id: p.id, data: p.data, mime: p.mime, name: p.name || '', interventionId: d.id });
    }
  }
  for (const id of d.removedPhotos) await repo.delPhoto(id);

  const expiries = {};
  for (const id of d.taskIds) if (d.expiries[id]) expiries[id] = d.expiries[id];

  const obj = {
    id: d.id,
    date: d.date,
    engineHours: hours,
    taskIds: [...d.taskIds].filter((id) => taskById(id)),
    title: d.title.trim(),
    doneBy: d.doneBy,
    materials: d.doneBy === 'yo' ? d.materials.filter((m) => m.desc.trim() || num(m.cost)).map((m) => ({ desc: m.desc.trim(), cost: num(m.cost) })) : [],
    workshop: d.doneBy === 'taller' ? d.workshop.trim() : '',
    invoiceTotal: d.doneBy === 'taller' ? num(d.invoiceTotal) : null,
    photoIds: d.doneBy === 'taller' ? d.photos.map((p) => p.id) : [],
    expiries,
    notes: d.notes.trim(),
    createdAt: d.createdAt || new Date().toISOString(),
  };
  // Si cambia a "yo", las fotos ya no se usan
  if (d.doneBy !== 'taller') for (const p of d.photos) if (p.existing) await repo.delPhoto(p.id);

  await repo.put('interventions', obj);
  formSaved(d.key);
  draft = null;
  toast(d.isNew ? 'Intervención guardada' : 'Cambios guardados');
  go(d.isNew ? '#/' : `#/intervencion/${encodeURIComponent(obj.id)}`);
}

async function fileToPhoto(file) {
  const id = uid();
  if (file.type === 'application/pdf') {
    const data = await readAsDataURL(file);
    if (data.length > 950000) throw new Error('Ese PDF es demasiado grande (máx. unos 700 KB). Haz una foto o captura de la factura.');
    return { id, data, mime: 'application/pdf', name: file.name };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('No se ha podido leer la imagen.'));
      im.src = url;
    });
    for (const max of [1800, 1400, 1100]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.72, 0.6, 0.5, 0.4]) {
        const data = c.toDataURL('image/jpeg', q);
        if (data.length < 900000) return { id, data, mime: 'image/jpeg', name: file.name };
      }
    }
    throw new Error('La imagen es demasiado grande incluso comprimida.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

// ───────────────────────── Tareas ─────────────────────────
function viewTaskEdit(id) {
  const st = settings();
  const areaParam = route().params.get('area');
  const t = id ? taskById(id) : {
    id: 'u-' + uid().slice(0, 8), system: validArea(areaParam) ? areaParam : 'otros', name: '', type: 'intervalo', intervalHours: null,
    intervalMonths: 12, noticeHours: null, noticeDays: null, active: true, notes: '', builtin: false,
  };
  if (!t) return notFound('Esta tarea ya no existe.');
  const back = id ? `#/tarea/${encodeURIComponent(id)}` : '#/trabajos?tipo=preventivos';
  return `
  ${backLink(back, 'Cancelar')}
  <h1>${id ? 'Editar tarea' : 'Nueva tarea'}</h1>
  <form id="task-form" class="form" data-id="${esc(t.id)}" data-new="${id ? '0' : '1'}">
    <label>Nombre<input type="text" name="name" value="${esc(t.name)}" required></label>
    <label>Área${areaSelect('system', validArea(t.system) ? t.system : 'otros')}</label>
    <fieldset class="seg">
      <legend>Cómo se calcula la próxima</legend>
      <label><input type="radio" name="type" value="intervalo" ${t.type !== 'caducidad' ? 'checked' : ''}><span>Por intervalo</span></label>
      <label><input type="radio" name="type" value="caducidad" ${t.type === 'caducidad' ? 'checked' : ''}><span>Por fecha de caducidad</span></label>
    </fieldset>
    <div class="grid2">
      <label>Cada (horas de motor)<input type="number" name="intervalHours" min="0" step="1" inputmode="numeric" value="${esc(t.intervalHours ?? '')}" placeholder="—"></label>
      <label>Cada (meses)<input type="number" name="intervalMonths" min="0" step="1" inputmode="numeric" value="${esc(t.intervalMonths ?? '')}" placeholder="—"></label>
    </div>
    <p class="hint">Si rellenas los dos, avisa con lo que llegue antes. En las tareas por caducidad, los meses solo se usan si no anotas la fecha.</p>
    <div class="grid2">
      <label>Avisar con (horas)<input type="number" name="noticeHours" min="0" step="1" inputmode="numeric" value="${esc(t.noticeHours ?? '')}" placeholder="${esc(st.noticeHours)} (por defecto)"></label>
      <label>Avisar con (días)<input type="number" name="noticeDays" min="0" step="1" inputmode="numeric" value="${esc(t.noticeDays ?? '')}" placeholder="${esc(st.noticeDays)} (por defecto)"></label>
    </div>
    <label>Notas<textarea name="notes" rows="3">${esc(t.notes || '')}</textarea></label>
    <label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}><span>Activa (genera avisos)</span></label>
    <p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions">
      <button class="btn primary" type="submit">Guardar tarea</button>
      ${id ? `<button type="button" class="btn danger" data-action="delete-task" data-id="${esc(t.id)}">Borrar tarea</button>` : ''}
    </div>
  </form>`;
}

function bindTaskForm() {
  const form = document.getElementById('task-form');
  if (!form) return;
  form.addEventListener('input', () => markDirty());
  form.addEventListener('change', () => markDirty());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, () => saveTask(form));
  });
}

async function saveTask(form) {
  {
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const err = document.getElementById('form-error');
    if (!name) { err.textContent = 'Falta el nombre.'; err.hidden = false; return; }
    const opt = (k) => { const v = String(fd.get(k) || '').trim(); return v === '' ? null : num(v); };
    const id = form.dataset.id;
    const base = taskById(id) || { id, builtin: false, createdAt: new Date().toISOString() };
    const obj = {
      ...base,
      name,
      system: fd.get('system'),
      type: fd.get('type'),
      intervalHours: opt('intervalHours') || null,
      intervalMonths: opt('intervalMonths') || null,
      noticeHours: opt('noticeHours'),
      noticeDays: opt('noticeDays'),
      notes: String(fd.get('notes') || '').trim(),
      active: fd.get('active') === 'on',
    };
    if (obj.type === 'intervalo' && !obj.intervalHours && !obj.intervalMonths) {
      err.textContent = 'Indica cada cuántas horas o cada cuántos meses toca.';
      err.hidden = false;
      return;
    }
    await repo.put('tasks', obj);
    formSaved();
    toast('Tarea guardada');
    go(`#/tarea/${encodeURIComponent(id)}`);
  }
}

// ───────────────────────── Horas ─────────────────────────
function viewHours() {
  const pts = [
    ...repo.state.readings.map((r) => ({ ...r, kind: 'lectura' })),
    ...repo.state.interventions.filter((i) => isNum(i.engineHours)).map((i) => ({ id: i.id, date: i.date, hours: i.engineHours, kind: 'intervencion', title: interventionTitle(i), href: `#/intervencion/${encodeURIComponent(i.id)}` })),
    ...repo.state.trips.flatMap((t) => [
      isNum(t.hoursStart) ? { id: t.id, date: t.date, hours: t.hoursStart, kind: 'otro', title: `Salida: ${tripRoute(t)}`, href: `#/navegacion/${encodeURIComponent(t.id)}` } : null,
      isNum(t.hoursEnd) ? { id: t.id, date: t.endDate || t.date, hours: t.hoursEnd, kind: 'otro', title: `Llegada: ${tripRoute(t)}`, href: `#/navegacion/${encodeURIComponent(t.id)}` } : null,
    ].filter(Boolean)),
    ...repo.state.fuel.filter((f) => isNum(f.engineHours) && !f.tripId).map((f) => ({ id: f.id, date: f.date, hours: f.engineHours, kind: 'otro', title: 'Repostaje', href: `#/repostaje/${encodeURIComponent(f.id)}` })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.hours - a.hours));
  const rate = usageRate(repo.state);
  return `
  ${backLink('#/', 'Estado')}
  <h1>Horas de motor</h1>
  <p class="muted">${rate ? `Uso medio: unas ${Math.round(rate * 30.44)} h al mes. Con este ritmo se estiman las fechas de las tareas por horas.` : 'Con al menos dos lecturas separadas unas semanas, la app estimará en qué fecha te tocará cada tarea por horas.'}</p>
  <form class="form inline" id="reading-form">
    <label>Fecha<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label>
    <label>Horas<input type="text" name="hours" inputmode="decimal" required></label>
    <button class="btn primary" type="submit">Anotar</button>
  </form>
  ${pts.length ? `<ul class="log">${pts.map((p) => `
    <li class="logrow static">
      <time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>
      <span class="log-title">${fmtHours(p.hours)}</span>
      <span class="log-meta">${p.kind === 'lectura'
        ? `<span>Lectura</span><button class="icon" data-action="delete-reading" data-id="${esc(p.id)}" aria-label="Borrar lectura">${ICON.trash}</button>`
        : `<a href="${p.href}">${esc(p.title)}</a>`}</span>
    </li>`).join('')}</ul>` : '<p class="muted">Aún no hay lecturas.</p>'}`;
}

async function addReading(date, hours) {
  await repo.put('readings', { id: uid(), date, hours: round1(hours), createdAt: new Date().toISOString() });
  toast(`Anotadas ${fmtHours(hours)}`);
}

// ───────────────────────── Ajustes ─────────────────────────
function viewSettings() {
  const st = settings();
  const s = repo.sync;
  let syncHtml;
  if (!cloudConfigured()) {
    syncHtml = `<p>La sincronización entre dispositivos aún no está configurada. Mientras tanto, los datos se guardan solo en este dispositivo. Haz copias de seguridad de vez en cuando.</p>`;
  } else if (s.mode === 'cloud') {
    syncHtml = `<p>Conectado como <strong>${esc(s.email || '')}</strong>. Tus datos se guardan en este dispositivo y se sincronizan con tus otros dispositivos cuando hay conexión.</p>
      <p class="muted">${navigator.onLine ? (s.pending ? 'Hay cambios pendientes de subir.' : 'Todo sincronizado.') : 'Ahora mismo sin conexión.'}</p>
      <button class="btn" data-action="signout">Cerrar sesión en este dispositivo</button>`;
  } else {
    syncHtml = `<p>Entra con tu cuenta para tener los mismos datos en el móvil, la tablet y el ordenador. La primera vez en cada dispositivo necesitas conexión.</p>
      <form id="login-form" class="form">
        <label>Correo<input type="email" name="email" autocomplete="username" required></label>
        <label>Contraseña<input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <p class="form-error" id="login-error" role="alert" hidden></p>
        <div class="actions">
          <button class="btn primary" type="submit" name="op" value="in">Entrar</button>
          <button class="btn" type="submit" name="op" value="up">Crear cuenta</button>
          <button class="btn link" type="button" data-action="reset-pw">He olvidado la contraseña</button>
        </div>
      </form>`;
  }
  return `
  <h1>Ajustes</h1>
  <p><a class="btn" href="#/tareas">Tareas de mantenimiento e intervalos</a></p>
  <section>
    <h2>Avisos en el calendario</h2>
    <p>Descarga un archivo con las próximas fechas de mantenimiento (24 meses) y ábrelo para añadirlo al calendario. Cada evento lleva dos avisos: con la antelación de la tarea y el día antes.</p>
    <p class="hint">En iPhone y iPad, al abrirlo elige «Añadir todo» y un calendario propio (por ejemplo «Velero»). Para actualizarlo más adelante, borra ese calendario y vuelve a importar.</p>
    <button class="btn primary" data-action="export-ics">Exportar al calendario</button>
  </section>

  <section>
    <h2>Sincronización</h2>
    ${syncHtml}
  </section>

  <form id="settings-form" class="form">
    <h2>Barco</h2>
    <label>Nombre<input type="text" name="boatName" value="${esc(st.boatName)}"></label>
    <label>Modelo<input type="text" name="boatModel" value="${esc(st.boatModel)}"></label>
    <label>Motor<input type="text" name="engine" value="${esc(st.engine)}"></label>
    <h2>Aviso por defecto</h2>
    <p class="hint">Una tarea pasa a «Toca pronto» cuando le quedan estas horas o estos días. Cada tarea puede tener el suyo.</p>
    <div class="grid2">
      <label>Horas antes<input type="number" name="noticeHours" min="0" step="1" inputmode="numeric" value="${esc(st.noticeHours)}"></label>
      <label>Días antes<input type="number" name="noticeDays" min="0" step="1" inputmode="numeric" value="${esc(st.noticeDays)}"></label>
    </div>
    <div class="actions"><button class="btn primary" type="submit">Guardar ajustes</button></div>
  </form>

  <section>
    <h2>Copia de seguridad</h2>
    <p>Un archivo con todas tus tareas, intervenciones, lecturas y facturas. Guárdalo en iCloud Drive o en tu ordenador.</p>
    <div class="actions">
      <button class="btn" data-action="export-json">Exportar copia</button>
      <label class="btn file"><span>Importar copia</span><input type="file" id="import-input" class="sr" accept="application/json,.json"></label>
    </div>
  </section>

  <section class="about">
    <h2>Acerca de</h2>
    <p>Versión ${APP_VERSION}. Los plazos de seguridad y documentación siguen la normativa de bandera española (RD 339/2021 y RD 1434/1999). Si cambias de bandera, revisa esas tareas.</p>
    <button class="btn link" data-action="check-update">Buscar actualización</button>
  </section>`;
}

function bindSettings() {
  const sf = document.getElementById('settings-form');
  sf.addEventListener('input', () => markDirty());
  sf.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(sf, async () => {
    const fd = new FormData(sf);
    const nh = parseNum(fd.get('noticeHours'));
    const nd = parseNum(fd.get('noticeDays'));
    if (!(nh >= 0) || !(nd >= 0)) { toast('Los avisos deben ser números (horas y días).'); return; }
    await saveSettings({
      boatName: String(fd.get('boatName') || '').trim() || DEFAULT_SETTINGS.boatName,
      boatModel: String(fd.get('boatModel') || '').trim(),
      engine: String(fd.get('engine') || '').trim(),
      noticeHours: Math.round(nh),
      noticeDays: Math.round(nd),
    });
    formSaved();
    toast('Ajustes guardados');
    });
  });
  const login = document.getElementById('login-form');
  if (login) {
    login.addEventListener('click', (e) => {
      const b = e.target.closest('button[type=submit]');
      if (b) login.dataset.op = b.value;
    });
    login.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (login.dataset.busy) return;
      const fd = new FormData(login);
      const op = e.submitter?.value || login.dataset.op || 'in';
      const errEl = document.getElementById('login-error');
      errEl.hidden = true;
      login.dataset.busy = '1';
      try {
        const cred = op === 'up'
          ? await signUp(fd.get('email'), fd.get('password'))
          : await signIn(fd.get('email'), fd.get('password'));
        await switchToCloud(cred.user);
      } catch (err) {
        errEl.textContent = authError(err);
        errEl.hidden = false;
      } finally {
        delete login.dataset.busy;
      }
    });
  }
  document.getElementById('import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importBackup(f);
  });
}

function authError(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Correo o contraseña incorrectos.';
  if (code.includes('email-already-in-use')) return 'Ya existe una cuenta con ese correo. Usa «Entrar».';
  if (code.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (code.includes('invalid-email')) return 'El correo no es válido.';
  if (code.includes('network')) return 'Sin conexión. Para entrar la primera vez necesitas cobertura.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos.';
  return 'No se ha podido entrar: ' + (err?.message || code);
}

async function switchToCloud(user) {
  const local = await readLocalDump();
  const hasLocal = local.interventions.length || local.readings.length || local.trips.length || local.fuel.length;
  localStorage.setItem('velero.mode', 'cloud');
  seededCloud = false;
  await repo.useCloud(user);
  if (hasLocal) {
    const ok = confirm(`Este dispositivo tiene datos guardados sin cuenta (${local.interventions.length} intervenciones, ${local.trips.length} navegaciones, ${local.fuel.length} repostajes y ${local.readings.length} lecturas). ¿Subirlos a tu cuenta? Si algo ya está en la cuenta, se conserva la versión más reciente.`);
    if (ok) {
      await waitServer(10000);
      const res = await mergeData(local);
      await clearLocalData(); // ya están en la cuenta: que no se vuelvan a ofrecer ni a mezclar
      toast(`Datos subidos a tu cuenta (${res.written} registros)`);
    }
  }
  updateSyncBadge();
  render(true);
}

// Espera a que la nube confirme los datos del servidor (o se agote el tiempo)
function waitServer(ms) {
  return new Promise((resolve) => {
    if (repo.sync.serverConfirmed) return resolve(true);
    const t = setTimeout(() => { off(); resolve(false); }, ms);
    const off = repo.onChange((_, sync) => {
      if (sync.serverConfirmed) { clearTimeout(t); off(); resolve(true); }
    });
  });
}

// Fusiona datos (copia o modo local) con los actuales: añade lo que falta y
// sustituye solo lo que sea más reciente. Descarta registros no válidos.
async function mergeData(data) {
  let written = 0, skipped = 0;
  for (const c of COLLECTIONS) {
    const rows = Array.isArray(data[c]) ? data[c] : [];
    for (const raw of rows) {
      const rec = sanitizeRecord(c, raw);
      if (!rec) { skipped++; continue; }
      const cur = repo.state[c].find((x) => x.id === rec.id);
      if (cur && (cur.updatedAt || '') >= (rec.updatedAt || '')) continue;
      await repo.put(c, rec, { touch: false });
      written++;
    }
  }
  for (const raw of Array.isArray(data.photos) ? data.photos : []) {
    const ph = sanitizeRecord('photos', raw);
    if (!ph) { skipped++; continue; }
    await repo.putPhoto(ph);
  }
  return { written, skipped };
}

// ───────────────────────── Exportaciones ─────────────────────────
async function exportICS() {
  const st = settings();
  const statuses = allStatuses(repo.state, st);
  const ics = buildICS(statuses, st);
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  if (!count) {
    toast('No hay fechas próximas: registra antes alguna intervención.');
    return;
  }
  await shareOrDownload(new Blob([ics], { type: 'text/calendar' }), 'mantenimiento-velero.ics', 'Mantenimiento del velero');
}

async function exportJSON() {
  const photos = [];
  let missing = 0;
  for (const i of [...repo.state.interventions, ...repo.state.issues]) {
    for (const id of [...(i.photoIds || []), ...(i.problemPhotoIds || [])]) {
      const p = await repo.getPhoto(id);
      if (p) photos.push(p);
      else missing++;
    }
  }
  const data = {
    app: 'velero-mantenimiento',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    tasks: repo.state.tasks,
    interventions: repo.state.interventions,
    readings: repo.state.readings,
    trips: repo.state.trips,
    fuel: repo.state.fuel,
    issues: repo.state.issues,
    meta: repo.state.meta,
    photos,
  };
  if (missing) toast(`Atención: ${missing} ${missing === 1 ? 'factura no está' : 'facturas no están'} en este dispositivo y no van en la copia. Hazla con conexión.`);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  await shareOrDownload(blob, `velero-copia-${todayStr()}.json`, 'Copia de seguridad del velero');
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Ese archivo no es una copia válida.');
    return;
  }
  if (!data || typeof data !== 'object' || data.app !== 'velero-mantenimiento') { toast('Ese archivo no es una copia de esta app.'); return; }
  const len = (k) => (Array.isArray(data[k]) ? data[k].length : 0);
  if (!confirm(`La copia tiene ${len('interventions')} intervenciones, ${len('trips')} navegaciones y ${len('fuel')} repostajes. Se añadirá lo que falte y se actualizará lo que en la copia sea más reciente. ¿Continuar?`)) return;
  toast('Importando…');
  try {
    const res = await mergeData(data);
    toast(res.skipped
      ? `Copia importada (${res.written} registros). ${res.skipped} no eran válidos y se han descartado.`
      : `Copia importada (${res.written} registros).`);
  } catch (e) {
    console.error(e);
    toast('La importación se ha detenido por un error: ' + e.message);
  }
  go('#/');
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (isIOS() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      // El permiso del toque ha caducado mientras se preparaba el archivo: pedir otro toque
      if (e.name === 'NotAllowedError') { offerShare(file, title); return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function offerShare(file, title) {
  document.getElementById('sharebar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'sharebar';
  bar.className = 'sharebar';
  bar.innerHTML = `<span>El archivo está listo.</span><button class="btn small primary" type="button">Compartir</button><button class="btn small" type="button">Cerrar</button>`;
  const [share, close] = bar.querySelectorAll('button');
  share.addEventListener('click', () => {
    navigator.share({ files: [file], title }).catch(() => {}).finally(() => bar.remove());
  });
  close.addEventListener('click', () => bar.remove());
  document.body.appendChild(bar);
  share.focus();
}

// ───────────────────────── Eventos ─────────────────────────
function bindView(key) {
  if (key === '') {
    const hf = document.getElementById('hours-form');
    hf.addEventListener('submit', (e) => {
      e.preventDefault();
      guarded(hf, async () => {
        const v = parseNum(hf.hours.value);
        if (!(v >= 0)) { toast('Escribe las horas con números, por ejemplo 1180,5'); return; }
        if (!confirmHours(round1(v), todayStr())) return;
        await addReading(todayStr(), v);
      });
    });
  } else if (key === 'registrar' || key === 'editar-intervencion') {
    bindRegister();
  } else if (key === 'editar-tarea' || key === 'nueva-tarea') {
    bindTaskForm();
  } else if (key === 'ajustes') {
    bindSettings();
  } else if (key === 'navegar' || key === 'editar-navegacion') {
    bindTripForm();
  } else if (key === 'repostar' || key === 'editar-repostaje') {
    bindFuelForm();
  } else if (key === 'intervencion' || key === 'correctivo') {
    loadThumbs();
  } else if (key === 'trabajos' || key === 'tareas') {
    const f = document.getElementById('area-filter');
    f?.addEventListener('change', (e) => {
      const tipo = key === 'tareas' ? 'preventivos' : f.dataset.tipo;
      location.hash = `#/trabajos?tipo=${tipo}${e.target.value ? `&area=${encodeURIComponent(e.target.value)}` : ''}`;
    });
    f?.addEventListener('submit', (e) => e.preventDefault());
  } else if (key === 'historial') {
    const f = document.getElementById('hist-area');
    f?.addEventListener('change', (e) => {
      const v = e.target.value;
      location.hash = `#/historial?tipo=${encodeURIComponent(f.dataset.tipo)}&anio=${encodeURIComponent(f.dataset.anio)}${v ? `&area=${encodeURIComponent(v)}` : ''}`;
    });
    f?.addEventListener('submit', (e) => e.preventDefault());
  } else if (key === 'nuevo-correctivo' || key === 'editar-correctivo') {
    bindIssueForm();
  } else if (key === 'cerrar-correctivo') {
    bindIssueClose();
  } else if (key === 'horas') {
    const rf = document.getElementById('reading-form');
    rf.addEventListener('submit', (e) => {
      e.preventDefault();
      guarded(rf, async () => {
        const v = parseNum(rf.hours.value);
        const date = rf.date.value;
        if (!date || date > todayStr()) { toast('La fecha no es válida.'); return; }
        if (!(v >= 0)) { toast('Escribe las horas con números, por ejemplo 1180,5'); return; }
        if (!confirmHours(round1(v), date)) return;
        await addReading(date, v);
        render(true);
      });
    });
  }
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'unpick') {
    draft.taskIds.delete(el.dataset.id);
    refreshPicked();
  } else if (a === 'add-mat') {
    const d = curDraft();
    d.materials.push({ desc: '', cost: '' });
    markDirty(d);
    document.getElementById('cost-block').innerHTML = costBlock(d);
    const inputs = document.querySelectorAll('[data-k="desc"]');
    inputs[inputs.length - 1]?.focus();
  } else if (a === 'del-mat') {
    const d = curDraft();
    d.materials.splice(+el.dataset.idx, 1);
    if (!d.materials.length) d.materials.push({ desc: '', cost: '' });
    markDirty(d);
    document.getElementById('cost-block').innerHTML = costBlock(d);
  } else if (a === 'del-photo') {
    const d = curDraft();
    const list = el.dataset.list === 'problemPhotos' ? 'problemPhotos' : 'photos';
    const [p] = d[list].splice(+el.dataset.idx, 1);
    if (p?.existing) d.removedPhotos.push(p.id);
    markDirty(d);
    document.getElementById(PHOTO_BOX[list]).innerHTML = draftPhotos(d, list);
  } else if (a === 'open-photo') {
    const p = photoCache.get(el.dataset.id) || (await repo.getPhoto(el.dataset.id));
    if (p) openPhoto(p);
  } else if (a === 'delete-intervention') {
    if (!confirm('¿Borrar esta intervención? No se puede deshacer.')) return;
    const i = repo.state.interventions.find((x) => x.id === el.dataset.id);
    for (const pid of i?.photoIds || []) await repo.delPhoto(pid);
    await repo.del('interventions', el.dataset.id);
    toast('Intervención borrada');
    go('#/historial');
  } else if (a === 'delete-task') {
    const id = el.dataset.id;
    const used = repo.state.interventions.some((i) => (i.taskIds || []).includes(id));
    const msg = used
      ? 'Esta tarea aparece en intervenciones registradas. Si la borras, esas intervenciones se quedan pero sin esta tarea. Si solo quieres dejar de recibir avisos, desactívala. ¿Borrarla?'
      : '¿Borrar esta tarea?';
    if (!confirm(msg)) return;
    const t = taskById(id);
    if (t?.builtin) await saveSettings({ deletedDefaults: [...new Set([...(settings().deletedDefaults || []), id])] });
    await repo.del('tasks', id);
    toast('Tarea borrada');
    go('#/trabajos?tipo=preventivos');
  } else if (a === 'delete-trip') {
    const t = repo.state.trips.find((x) => x.id === el.dataset.id);
    const msg = t?.fuelId ? '¿Borrar esta navegación y el repostaje apuntado en ella? No se puede deshacer.' : '¿Borrar esta navegación? No se puede deshacer.';
    if (!confirm(msg)) return;
    if (t?.fuelId) await repo.del('fuel', t.fuelId);
    await repo.del('trips', el.dataset.id);
    toast('Navegación borrada');
    go('#/bitacora');
  } else if (a === 'delete-fuel') {
    if (!confirm('¿Borrar este repostaje? No se puede deshacer.')) return;
    const f = repo.state.fuel.find((x) => x.id === el.dataset.id);
    if (f?.tripId) {
      const t = repo.state.trips.find((x) => x.id === f.tripId);
      if (t) await repo.put('trips', { ...t, fuelId: null });
    }
    await repo.del('fuel', el.dataset.id);
    toast('Repostaje borrado');
    go('#/historial?tipo=combustible');
  } else if (a === 'delete-issue') {
    if (!confirm('¿Borrar este correctivo y sus fotos? No se puede deshacer.')) return;
    const i = issueById(el.dataset.id);
    for (const pid of [...(i?.problemPhotoIds || []), ...(i?.photoIds || [])]) await repo.delPhoto(pid);
    await repo.del('issues', el.dataset.id);
    toast('Correctivo borrado');
    go('#/trabajos');
  } else if (a === 'reopen-issue') {
    const i = issueById(el.dataset.id);
    if (!i) return;
    if (!confirm('¿Volver a ponerlo como pendiente? Se borrará el trabajo apuntado, su coste y la factura.')) return;
    for (const pid of i.photoIds || []) await repo.delPhoto(pid);
    await repo.put('issues', { ...i, status: 'pendiente', doneDate: '', work: '', engineHours: null, doneBy: 'yo', materials: [], workshop: '', invoiceTotal: null, photoIds: [] });
    toast('Vuelve a estar pendiente');
    render(true);
  } else if (a === 'delete-reading') {
    if (!confirm('¿Borrar esta lectura?')) return;
    await repo.del('readings', el.dataset.id);
    render(true);
  } else if (a === 'export-ics') {
    exportICS();
  } else if (a === 'export-json') {
    exportJSON();
  } else if (a === 'signout') {
    if (!confirm('¿Cerrar sesión en este dispositivo? Tus datos siguen en tu cuenta.')) return;
    await signOutCloud();
    localStorage.setItem('velero.mode', 'local');
    await repo.useLocal();
    updateSyncBadge();
    render(true);
  } else if (a === 'reset-pw') {
    const email = document.querySelector('#login-form [name=email]')?.value;
    if (!email) { toast('Escribe primero tu correo.'); return; }
    try { await resetPassword(email); toast('Te hemos enviado un correo para cambiarla.'); }
    catch (err) { toast(authError(err)); }
  } else if (a === 'check-update') {
    if (!navigator.onLine) { toast('Sin conexión: no se puede buscar ahora.'); return; }
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    try { await reg.update(); } catch { toast('No se ha podido comprobar. Inténtalo más tarde.'); return; }
    toast(reg.installing || reg.waiting ? 'Hay una versión nueva: pulsa «Actualizar» arriba.' : 'Tienes la última versión.');
  } else if (a === 'apply-update') {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.waiting?.postMessage('skipWaiting');
  } else if (a === 'close-viewer') {
    closeViewer();
  } else if (a === 'skip') {
    $view.focus();
  }
}

function closeViewer() {
  document.getElementById('viewer')?.remove();
}

function pdfUrl(data) {
  const bin = atob(data.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function openPhoto(p) {
  closeViewer();
  const v = document.createElement('div');
  v.id = 'viewer';
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-label', 'Factura');
  v.innerHTML = `<button class="btn" data-action="close-viewer">Cerrar</button><img src="${esc(p.data)}" alt="Factura">`;
  document.body.appendChild(v);
  v.querySelector('button').focus();
}

// ───────────────────────── Nuevo apunte ─────────────────────────
function viewNew() {
  return `
  <h1>¿Qué quieres apuntar?</h1>
  <ul class="choices">
    <li><a href="#/navegar"><strong>Navegación</strong><span>Una salida al mar: puertos, horas de motor, millas y, si echaste, combustible.</span></a></li>
    <li><a href="#/correctivo/nuevo"><strong>Correctivo</strong><span>Algo que has visto y hay que arreglar, con su prioridad. Lo marcarás como hecho al arreglarlo.</span></a></li>
    <li><a href="#/registrar"><strong>Mantenimiento preventivo</strong><span>Una tarea periódica hecha por ti o por un taller (aceite, filtros, antifouling…), con material o factura.</span></a></li>
    <li><a href="#/repostar"><strong>Repostaje</strong><span>Combustible en surtidor o con garrafas, aunque no salgas a navegar.</span></a></li>
    <li><a href="#/horas"><strong>Horas de motor</strong><span>Solo la lectura del contador.</span></a></li>
  </ul>`;
}

// ───────────────────────── Bitácora ─────────────────────────
function byDateDesc(a, b) {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '');
}

function fmtNum(n, dec = 1) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec }).format(n || 0);
}

function tripRoute(t) {
  const from = (t.from || '').trim();
  const to = (t.to || '').trim();
  if (from && to && from.toLowerCase() !== to.toLowerCase()) return `${from} – ${to}`;
  if (from || to) return from || to;
  return 'Navegación';
}

function tripDateText(t, long) {
  const opts = long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : undefined;
  if (t.endDate && t.endDate > t.date) return `Del ${fmtDate(t.date, opts)} al ${fmtDate(t.endDate, opts)}`;
  return fmtDate(t.date, opts);
}

function tripRow(t) {
  const eh = tripEngineHours(t);
  const fuel = t.fuelId ? repo.state.fuel.find((f) => f.id === t.fuelId) : null;
  const days = tripDays(t);
  return `<li><a class="logrow" href="#/navegacion/${encodeURIComponent(t.id)}">
    <time datetime="${esc(t.date)}">${fmtDate(t.date)}</time>
    <span class="log-title">${esc(tripRoute(t))}</span>
    <span class="log-meta">
      ${days > 1 ? `<span>${days} días</span>` : ''}
      ${num(t.miles) ? `<span>${fmtNum(num(t.miles))} mn</span>` : ''}
      ${eh !== null ? `<span>${fmtHours(eh)} de motor</span>` : ''}
      ${fuel ? `<span>${fmtNum(num(fuel.liters))} L repostados</span>` : ''}
    </span>
  </a></li>`;
}

function viewLogbook(r) {
  const all = [...repo.state.trips].sort(byDateDesc);
  if (!all.length) {
    return `<h1>Bitácora</h1>
    <section class="notice"><p>Apunta cada salida aunque no hagas mantenimiento: de dónde a dónde, las horas del motor al salir y al volver, las millas y lo que quieras recordar. Así el contador de horas se mantiene al día solo.</p>
    <a class="btn primary" href="#/navegar">Registrar navegación</a></section>`;
  }
  const years = [...new Set(all.map((t) => t.date.slice(0, 4)))].sort().reverse();
  let year = r.params.get('anio') || years[0];
  if (year !== 'todo' && !years.includes(year)) year = years[0];
  const list = year === 'todo' ? all : all.filter((t) => t.date.startsWith(year));
  const st = tripStats(list);
  return `
  <div class="titlebar"><h1>Bitácora</h1><a class="btn small" href="#/navegar">Nueva navegación</a></div>
  <nav class="chips" aria-label="Año">
    ${years.map((y) => `<a href="#/bitacora?anio=${encodeURIComponent(y)}" ${y === year ? 'aria-current="true"' : ''}>${esc(y)}</a>`).join('')}
    <a href="#/bitacora?anio=todo" ${year === 'todo' ? 'aria-current="true"' : ''}>Todos los años</a>
  </nav>
  <dl class="stats">
    <div><dt>Salidas</dt><dd>${st.count}</dd></div>
    <div><dt>Días de mar</dt><dd>${st.days}</dd></div>
    <div><dt>Millas</dt><dd>${fmtNum(st.miles)}</dd></div>
    <div><dt>Horas de motor</dt><dd>${fmtNum(st.engine)}</dd></div>
  </dl>
  <ul class="log">${list.map(tripRow).join('')}</ul>`;
}

function viewTrip(id) {
  const t = repo.state.trips.find((x) => x.id === id);
  if (!t) return notFound('Esta navegación ya no existe.');
  const eh = tripEngineHours(t);
  const fuel = t.fuelId ? repo.state.fuel.find((f) => f.id === t.fuelId) : null;
  const facts = [];
  if (t.from) facts.push(['Salida', t.from]);
  if (t.to) facts.push(['Llegada', t.to]);
  if (num(t.miles)) facts.push(['Millas', `${fmtNum(num(t.miles))} mn`]);
  if (isNum(t.hoursStart) || isNum(t.hoursEnd)) {
    facts.push(['Horas de motor', [isNum(t.hoursStart) ? `al salir ${fmtHours(t.hoursStart)}` : '', isNum(t.hoursEnd) ? `al volver ${fmtHours(t.hoursEnd)}` : ''].filter(Boolean).join(', ') + (eh !== null ? ` (${fmtHours(eh)} de uso)` : '')]);
  }
  if (t.crew) facts.push(['Tripulación', t.crew]);
  if (t.conditions) facts.push(['Viento y mar', t.conditions]);
  return `
  ${backLink('#/bitacora', 'Bitácora')}
  <article class="detail">
    <p class="muted">${tripDateText(t, true)}</p>
    <h1>${esc(tripRoute(t))}</h1>
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    ${t.notes ? `<h2>Notas</h2><p class="note pre">${esc(t.notes)}</p>` : ''}
    ${fuel ? `<h2>Repostaje</h2><p><a href="#/repostaje/${encodeURIComponent(fuel.id)}">${esc(fuelSummary(fuel))}</a></p>` : ''}
    <div class="actions">
      <a class="btn primary" href="#/navegacion/${encodeURIComponent(t.id)}/editar">Editar</a>
      <button class="btn danger" data-action="delete-trip" data-id="${esc(t.id)}">Borrar</button>
    </div>
  </article>`;
}

function knownPlaces() {
  const set = new Set();
  for (const t of repo.state.trips) { if (t.from) set.add(t.from.trim()); if (t.to) set.add(t.to.trim()); }
  for (const f of repo.state.fuel) if (f.place) set.add(f.place.trim());
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
}

function placesDatalist() {
  return `<datalist id="places">${knownPlaces().map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

function newTripDraft(existing) {
  const fuel = existing?.fuelId ? repo.state.fuel.find((f) => f.id === existing.fuelId) : null;
  if (existing) {
    return {
      id: existing.id, isNew: false, createdAt: existing.createdAt,
      date: existing.date, endDate: existing.endDate || '',
      from: existing.from || '', to: existing.to || '',
      hoursStart: isNum(existing.hoursStart) ? fmtInput(existing.hoursStart) : '',
      hoursEnd: isNum(existing.hoursEnd) ? fmtInput(existing.hoursEnd) : '',
      miles: isNum(existing.miles) ? fmtInput(existing.miles) : '',
      crew: existing.crew || '', conditions: existing.conditions || '', notes: existing.notes || '',
      refuel: !!fuel,
      fuelId: fuel?.id || null,
      newFuelId: uid(),
      fuel: fuelFields(fuel),
    };
  }
  const cur = currentHours(repo.state);
  const last = [...repo.state.trips].sort(byDateDesc)[0];
  const home = last ? (last.to || last.from || '') : '';
  return {
    id: uid(), isNew: true, date: todayStr(), endDate: '',
    from: home, to: '',
    hoursStart: cur ? fmtInput(cur.hours) : '', hoursEnd: '', miles: '',
    crew: '', conditions: '', notes: '',
    refuel: false, fuelId: null, newFuelId: uid(), fuel: fuelFields(null),
  };
}

function fuelFields(f) {
  return {
    liters: f && num(f.liters) ? fmtInput(f.liters) : '',
    total: f && num(f.total) ? fmtInput(f.total) : '',
    place: f?.place || '',
    method: f?.method || 'surtidor',
    fullTank: f ? !!f.fullTank : true,
  };
}

function fmtInput(n) {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

function viewTripForm(r, editId) {
  let existing = null;
  if (editId) {
    existing = repo.state.trips.find((x) => x.id === editId);
    if (!existing) return notFound('Esta navegación ya no existe.');
  }
  const key = location.hash;
  if (!tripDraft || tripDraft.key !== key) {
    tripDraft = loadStoredDraft(key) || newTripDraft(existing);
    tripDraft.key = key;
  }
  const d = tripDraft;
  const back = editId ? `#/navegacion/${encodeURIComponent(editId)}` : '#/bitacora';
  return `
  ${backLink(back, 'Cancelar')}
  <h1>${editId ? 'Editar navegación' : 'Registrar navegación'}</h1>
  <form id="trip-form" class="form" novalidate>
    ${placesDatalist()}
    <div class="grid2">
      <label>Fecha de salida<input type="date" name="date" value="${esc(d.date)}" max="${todayStr()}" required></label>
      <label>Fecha de llegada <span class="muted">(si fueron varios días)</span><input type="date" name="endDate" value="${esc(d.endDate)}" max="${todayStr()}"></label>
    </div>
    <div class="grid2">
      <label>Salida<input type="text" name="from" list="places" value="${esc(d.from)}" placeholder="Puerto o fondeo" autocomplete="off"></label>
      <label>Llegada<input type="text" name="to" list="places" value="${esc(d.to)}" placeholder="Igual que la salida si vuelves" autocomplete="off"></label>
    </div>
    <div class="grid2">
      <label>Horas de motor al salir<input type="text" name="hoursStart" inputmode="decimal" value="${esc(d.hoursStart)}" placeholder="Contador"></label>
      <label>Horas de motor al volver<input type="text" name="hoursEnd" inputmode="decimal" value="${esc(d.hoursEnd)}" placeholder="Contador"></label>
    </div>
    <p class="hint" id="trip-engine">${tripEngineHint()}</p>
    <label>Millas <span class="muted">(opcional)</span><input type="text" name="miles" inputmode="decimal" value="${esc(d.miles)}"></label>
    <label>Tripulación<input type="text" name="crew" value="${esc(d.crew)}" placeholder="Quién vino"></label>
    <label>Viento y mar<input type="text" name="conditions" value="${esc(d.conditions)}" placeholder="Por ejemplo: SE 12–15 nudos, marejadilla"></label>
    <label>Notas<textarea name="notes" rows="4" placeholder="Rumbo, fondeos, incidencias, cosas a revisar…">${esc(d.notes)}</textarea></label>

    <label class="check"><input type="checkbox" name="refuel" ${d.refuel ? 'checked' : ''}><span>Repostaje en esta salida</span></label>
    <div id="trip-fuel" ${d.refuel ? '' : 'hidden'}>${fuelFieldset(d.fuel, true)}</div>

    <p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions sticky">
      <button class="btn primary" type="submit">${editId ? 'Guardar cambios' : 'Guardar navegación'}</button>
    </div>
  </form>`;
}

function tripEngineHint() {
  const d = tripDraft;
  const a = d.hoursStart.trim() ? parseNum(d.hoursStart) : NaN;
  const b = d.hoursEnd.trim() ? parseNum(d.hoursEnd) : NaN;
  if (Number.isFinite(a) && Number.isFinite(b)) {
    if (b < a) return 'Las horas al volver son menores que al salir: revísalas.';
    return `Motor en esta salida: ${fmtHours(round1(b - a))}.`;
  }
  return 'Apunta lo que marque el contador; con eso se actualizan las horas del motor.';
}

function fuelFieldset(f, inTrip) {
  const liters = parseNum(f.liters);
  const total = parseNum(f.total);
  const ppl = liters > 0 && total > 0 ? `${fmtMoney(total / liters)} el litro` : '';
  return `<fieldset>
    <legend>Combustible</legend>
    <div class="grid2">
      <label>Litros<input type="text" data-fuel="liters" inputmode="decimal" value="${esc(f.liters)}"></label>
      <label>Importe total (€)<input type="text" data-fuel="total" inputmode="decimal" value="${esc(f.total)}"></label>
    </div>
    <p class="hint" data-ppl>${ppl}</p>
    <label>Lugar<input type="text" data-fuel="place" list="places" value="${esc(f.place)}" placeholder="Gasolinera del puerto, estación de servicio…" autocomplete="off"></label>
    <fieldset class="seg" role="radiogroup">
      <legend>Cómo</legend>
      <label><input type="radio" name="${inTrip ? 'trip-' : ''}method" data-fuel="method" value="surtidor" ${f.method !== 'garrafas' ? 'checked' : ''}><span>Surtidor del puerto</span></label>
      <label><input type="radio" name="${inTrip ? 'trip-' : ''}method" data-fuel="method" value="garrafas" ${f.method === 'garrafas' ? 'checked' : ''}><span>Garrafas</span></label>
    </fieldset>
    <label class="check"><input type="checkbox" data-fuel="fullTank" ${f.fullTank ? 'checked' : ''}><span>Depósito lleno <span class="muted">(sirve para calcular el consumo)</span></span></label>
  </fieldset>`;
}

function bindFuelInputs(container, f) {
  container.addEventListener('input', (e) => {
    const el = e.target;
    const k = el.dataset.fuel;
    if (!k) return;
    if (k === 'fullTank') f.fullTank = el.checked;
    else f[k] = el.value;
    if (k === 'liters' || k === 'total') {
      const l = parseNum(f.liters), t = parseNum(f.total);
      container.querySelector('[data-ppl]').textContent = l > 0 && t > 0 ? `${fmtMoney(t / l)} el litro` : '';
    }
  });
  container.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.fuel === 'fullTank') f.fullTank = el.checked;
    if (el.dataset.fuel === 'method') f.method = el.value;
  });
}

// Valida los campos de combustible. Devuelve el mensaje de error o null.
function fuelError(f) {
  const l = f.liters.trim() ? parseNum(f.liters) : null;
  const t = f.total.trim() ? parseNum(f.total) : null;
  if (l !== null && !(l >= 0)) return 'Los litros no son un número válido.';
  if (t !== null && !(t >= 0)) return 'El importe del combustible no es válido.';
  if (!(l > 0) && !(t > 0)) return 'Indica al menos los litros o el importe del combustible.';
  if (l > 2000) return 'Los litros parecen demasiados: revísalos.';
  return null;
}

function bindTripForm() {
  const form = document.getElementById('trip-form');
  if (!form) return;
  const d = tripDraft;
  form.addEventListener('input', (e) => {
    const el = e.target;
    markDirty(d);
    if (el.dataset.fuel) return;
    if (el.name in d && typeof d[el.name] === 'string') d[el.name] = el.value;
    if (el.name === 'hoursStart' || el.name === 'hoursEnd') document.getElementById('trip-engine').textContent = tripEngineHint();
  });
  form.addEventListener('change', (e) => {
    markDirty(d);
    if (e.target.name === 'refuel') {
      d.refuel = e.target.checked;
      document.getElementById('trip-fuel').hidden = !d.refuel;
    }
  });
  bindFuelInputs(document.getElementById('trip-fuel'), d.fuel);
  form.addEventListener('submit', (e) => { e.preventDefault(); guarded(form, saveTrip); });
}

async function saveTrip() {
  const d = tripDraft;
  const err = document.getElementById('form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const today = todayStr();
  if (!d.date) return fail('Falta la fecha de salida.');
  if (d.date > today) return fail('La fecha de salida no puede ser futura.');
  if (d.endDate && d.endDate < d.date) return fail('La llegada no puede ser anterior a la salida.');
  if (d.endDate && d.endDate > today) return fail('La fecha de llegada no puede ser futura.');
  const hs = d.hoursStart.trim() ? parseNum(d.hoursStart) : null;
  const he = d.hoursEnd.trim() ? parseNum(d.hoursEnd) : null;
  if (hs !== null && !(hs >= 0)) return fail('Las horas al salir no son un número válido.');
  if (he !== null && !(he >= 0)) return fail('Las horas al volver no son un número válido.');
  if (hs !== null && he !== null && he < hs) return fail('Las horas al volver no pueden ser menores que al salir.');
  if (hs !== null && he !== null && he - hs > 24 * Math.max(1, (d.endDate ? daysBetween(d.date, d.endDate) + 1 : 1)))
    return fail('Hay más horas de motor que horas tiene la travesía: revisa el contador.');
  const miles = d.miles.trim() ? parseNum(d.miles) : null;
  if (miles !== null && !(miles >= 0)) return fail('Las millas no son un número válido.');
  if (d.refuel) {
    const fe = fuelError(d.fuel);
    if (fe) return fail(fe);
  }
  if (!confirmHours(hs, d.date)) return;
  if (!confirmHours(he, d.endDate || d.date)) return;

  const trip = {
    id: d.id,
    date: d.date,
    endDate: d.endDate && d.endDate > d.date ? d.endDate : '',
    from: d.from.trim(),
    to: d.to.trim(),
    hoursStart: hs !== null ? round1(hs) : null,
    hoursEnd: he !== null ? round1(he) : null,
    miles: miles !== null ? round1(miles) : null,
    crew: d.crew.trim(),
    conditions: d.conditions.trim(),
    notes: d.notes.trim(),
    fuelId: null,
    createdAt: d.createdAt || new Date().toISOString(),
  };
  if (d.refuel) {
    const fuelId = d.fuelId || d.newFuelId || uid();
    const old = repo.state.fuel.find((f) => f.id === fuelId);
    await repo.put('fuel', {
      ...(old || {}),
      id: fuelId,
      date: old?.date && old.date >= trip.date && old.date <= (trip.endDate || trip.date) ? old.date : (trip.endDate || trip.date),
      liters: round2(num(d.fuel.liters)),
      total: round2(num(d.fuel.total)),
      place: d.fuel.place.trim(),
      method: d.fuel.method,
      fullTank: !!d.fuel.fullTank,
      engineHours: trip.hoursEnd ?? trip.hoursStart,
      tripId: trip.id,
      notes: old?.notes || '',
      createdAt: old?.createdAt || new Date().toISOString(),
    });
    trip.fuelId = fuelId;
  } else if (d.fuelId) {
    await repo.del('fuel', d.fuelId);
  }
  await repo.put('trips', trip);
  formSaved(d.key);
  tripDraft = null;
  toast(d.isNew ? 'Navegación guardada' : 'Cambios guardados');
  go(d.isNew ? '#/bitacora' : `#/navegacion/${encodeURIComponent(trip.id)}`);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ───────────────────────── Repostajes ─────────────────────────
function fuelSummary(f) {
  const parts = [];
  if (num(f.liters)) parts.push(`${fmtNum(num(f.liters))} L`);
  if (num(f.total)) parts.push(fmtMoney(num(f.total)));
  if (f.place) parts.push(f.place);
  return parts.join(', ') || 'Repostaje';
}

function fuelRow(f) {
  const l = num(f.liters), t = num(f.total);
  return `<li><a class="logrow" href="#/repostaje/${encodeURIComponent(f.id)}">
    <time datetime="${esc(f.date)}">${fmtDate(f.date)}</time>
    <span class="log-title">Combustible${l ? `: ${fmtNum(l)} L` : ''}</span>
    <span class="log-meta">
      <span>${f.method === 'garrafas' ? 'Garrafas' : 'Surtidor'}</span>
      ${f.place ? `<span>${esc(f.place)}</span>` : ''}
      ${t ? `<span class="money">${fmtMoney(t)}</span>` : ''}
    </span>
  </a></li>`;
}

function viewFuel(id) {
  const f = repo.state.fuel.find((x) => x.id === id);
  if (!f) return notFound('Este repostaje ya no existe.');
  const trip = f.tripId ? repo.state.trips.find((t) => t.id === f.tripId) : null;
  const l = num(f.liters), t = num(f.total);
  return `
  ${backLink('#/historial?tipo=combustible', 'Historial')}
  <article class="detail">
    <p class="muted">${fmtDate(f.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <h1>Combustible${l ? `: ${fmtNum(l)} L` : ''}</h1>
    <dl class="facts">
      <dt>Importe</dt><dd>${t ? fmtMoney(t) : 'No anotado'}</dd>
      ${l && t ? `<dt>Precio</dt><dd>${fmtMoney(t / l)} el litro</dd>` : ''}
      <dt>Cómo</dt><dd>${f.method === 'garrafas' ? 'Con garrafas' : 'Surtidor del puerto'}${f.fullTank ? ', depósito lleno' : ''}</dd>
      ${f.place ? `<dt>Lugar</dt><dd>${esc(f.place)}</dd>` : ''}
      ${isNum(f.engineHours) ? `<dt>Horas de motor</dt><dd>${fmtHours(f.engineHours)}</dd>` : ''}
      ${trip ? `<dt>Navegación</dt><dd><a href="#/navegacion/${encodeURIComponent(trip.id)}">${fmtDate(trip.date)}, ${esc(tripRoute(trip))}</a></dd>` : ''}
    </dl>
    ${f.notes ? `<h2>Notas</h2><p class="note pre">${esc(f.notes)}</p>` : ''}
    <div class="actions">
      <a class="btn primary" href="#/repostaje/${encodeURIComponent(f.id)}/editar">Editar</a>
      <button class="btn danger" data-action="delete-fuel" data-id="${esc(f.id)}">Borrar</button>
    </div>
  </article>`;
}

function viewFuelForm(r, editId) {
  let existing = null;
  if (editId) {
    existing = repo.state.fuel.find((x) => x.id === editId);
    if (!existing) return notFound('Este repostaje ya no existe.');
  }
  const key = location.hash;
  if (!tripDraft || tripDraft.key !== key) tripDraft = loadStoredDraft(key);
  if (!tripDraft || tripDraft.key !== key) {
    const cur = currentHours(repo.state);
    tripDraft = {
      key,
      kind: 'fuel',
      id: existing?.id || uid(),
      isNew: !existing,
      createdAt: existing?.createdAt,
      tripId: existing?.tripId || null,
      date: existing?.date || todayStr(),
      engineHours: existing ? (isNum(existing.engineHours) ? fmtInput(existing.engineHours) : '') : '',
      hoursHint: cur ? cur.hours : null,
      notes: existing?.notes || '',
      fuel: fuelFields(existing),
    };
    if (!existing) tripDraft.fuel.method = 'garrafas';
  }
  const d = tripDraft;
  const back = editId ? `#/repostaje/${encodeURIComponent(editId)}` : '#/historial?tipo=combustible';
  const trip = d.tripId ? repo.state.trips.find((t) => t.id === d.tripId) : null;
  return `
  ${backLink(back, 'Cancelar')}
  <h1>${editId ? 'Editar repostaje' : 'Registrar repostaje'}</h1>
  ${trip ? `<p class="hint">Apuntado en la navegación del ${fmtDate(trip.date)} (${esc(tripRoute(trip))}).</p>` : ''}
  <form id="fuel-form" class="form" novalidate>
    ${placesDatalist()}
    <div class="grid2">
      <label>Fecha<input type="date" name="date" value="${esc(d.date)}" max="${todayStr()}" required></label>
      <label>Horas de motor <span class="muted">(opcional)</span><input type="text" name="engineHours" inputmode="decimal" value="${esc(d.engineHours)}"
        placeholder="${d.hoursHint != null ? 'Última: ' + esc(d.hoursHint.toLocaleString('es-ES')) : ''}"></label>
    </div>
    <div id="fuel-fields">${fuelFieldset(d.fuel, false)}</div>
    <label>Notas<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
    <p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions sticky"><button class="btn primary" type="submit">${editId ? 'Guardar cambios' : 'Guardar repostaje'}</button></div>
  </form>`;
}

function bindFuelForm() {
  const form = document.getElementById('fuel-form');
  if (!form) return;
  const d = tripDraft;
  form.addEventListener('input', (e) => {
    const el = e.target;
    markDirty(d);
    if (el.dataset.fuel) return;
    if (el.name === 'date' || el.name === 'engineHours' || el.name === 'notes') d[el.name] = el.value;
  });
  bindFuelInputs(document.getElementById('fuel-fields'), d.fuel);
  form.addEventListener('change', () => markDirty(d));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, () => saveFuel(d));
  });
}

async function saveFuel(d) {
  {
    const err = document.getElementById('form-error');
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    if (!d.date) return fail('Falta la fecha.');
    if (d.date > todayStr()) return fail('La fecha no puede ser futura.');
    const fe = fuelError(d.fuel);
    if (fe) return fail(fe);
    const h = d.engineHours.trim() ? parseNum(d.engineHours) : null;
    if (h !== null && !(h >= 0)) return fail('Las horas de motor no son un número válido.');
    if (!confirmHours(h, d.date)) return;
    const old = repo.state.fuel.find((f) => f.id === d.id);
    const obj = {
      ...(old || {}),
      id: d.id,
      date: d.date,
      liters: round2(num(d.fuel.liters)),
      total: round2(num(d.fuel.total)),
      place: d.fuel.place.trim(),
      method: d.fuel.method,
      fullTank: !!d.fuel.fullTank,
      engineHours: h !== null ? round1(h) : null,
      tripId: d.tripId,
      notes: d.notes.trim(),
      createdAt: d.createdAt || new Date().toISOString(),
    };
    await repo.put('fuel', obj);
    formSaved(d.key);
    tripDraft = null;
    toast(d.isNew ? 'Repostaje guardado' : 'Cambios guardados');
    go(d.isNew ? '#/historial?tipo=combustible' : `#/repostaje/${encodeURIComponent(obj.id)}`);
  }
}

// ───────────────────────── Trabajos: correctivos y preventivos ─────────────────────────
const PRIO_CLASS = { urgente: 'p-urgente', alta: 'p-alta', media: 'p-media', baja: 'p-baja' };

function issueById(id) {
  return repo.state.issues.find((x) => x.id === id);
}

function issueRow(i, { showArea = true } = {}) {
  const done = i.status === 'hecho';
  const sub = [showArea ? areaName(i.area) : '', done ? `hecho el ${fmtDate(i.doneDate)}` : `desde el ${fmtDate(i.detectedDate)}`].filter(Boolean).join(', ');
  return `<li><a class="row ${done ? 'st-ok' : PRIO_CLASS[i.priority] || 'p-media'}" href="#/correctivo/${encodeURIComponent(i.id)}">
    <span class="flag" aria-hidden="true"></span>
    <span class="row-main">
      <span class="row-title">${esc(i.title)}</span>
      <span class="row-sub">${esc(sub.charAt(0).toUpperCase() + sub.slice(1))}</span>
    </span>
    <span class="row-due">${done ? (issueCost(i) ? `<span class="money">${fmtMoney(issueCost(i))}</span>` : 'Hecho') : esc(prioName(i.priority))}</span>
  </a></li>`;
}

function workQuery(tipo, area) {
  return esc(`#/trabajos?tipo=${encodeURIComponent(tipo)}${area ? `&area=${encodeURIComponent(area)}` : ''}`);
}

function viewWork(r, forced) {
  const tipoParam = forced || r.params.get('tipo');
  const tipo = tipoParam === 'preventivos' ? 'preventivos' : 'correctivos';
  const areaParam = r.params.get('area') || '';
  const area = validArea(areaParam) ? areaParam : '';
  const pending = repo.state.issues.filter((i) => i.status !== 'hecho');
  const head = `
  <div class="titlebar"><h1>Trabajos</h1>
    ${tipo === 'correctivos'
      ? `<a class="btn small primary" href="#/correctivo/nuevo${area ? `?area=${encodeURIComponent(area)}` : ''}">Nuevo correctivo</a>`
      : `<a class="btn small" href="#/tarea/nueva${area ? `?area=${encodeURIComponent(area)}` : ''}">Nueva tarea</a>`}
  </div>
  <nav class="seglinks" aria-label="Tipo de trabajo">
    <a href="${workQuery('correctivos', area)}" ${tipo === 'correctivos' ? 'aria-current="true"' : ''}>Correctivos${pending.length ? ` <span class="count">${pending.length}</span>` : ''}</a>
    <a href="${workQuery('preventivos', area)}" ${tipo === 'preventivos' ? 'aria-current="true"' : ''}>Preventivos</a>
  </nav>
  <form class="areafilter" id="area-filter" data-tipo="${tipo}">
    <label>Área ${areaSelect('area', area, { all: true })}</label>
  </form>`;

  if (tipo === 'preventivos') return head + preventiveList(area);

  const inArea = (i) => !area || i.area === area;
  const open = sortIssues(pending.filter(inArea));
  const done = repo.state.issues.filter((i) => i.status === 'hecho' && inArea(i))
    .sort((a, b) => (a.doneDate < b.doneDate ? 1 : -1));
  if (!repo.state.issues.length) {
    return head + `<section class="notice"><p>Aquí van las cosas que encuentras y hay que arreglar: una polea rota, una vía de agua, un winch que patina… Apúntalas con su prioridad y márcalas como hechas cuando las arregles, con el trabajo y el coste.</p>
    <a class="btn primary" href="#/correctivo/nuevo">Apuntar un correctivo</a></section>`;
  }
  return head + `
  <section>
    <h2 class="grp">Pendientes <span class="count">${open.length}</span></h2>
    ${open.length ? `<ul class="rows">${open.map((i) => issueRow(i, { showArea: !area })).join('')}</ul>` : `<p class="allclear">Nada pendiente${area ? ' en esta área' : ''}.</p>`}
  </section>
  ${done.length ? `<details class="fold">
    <summary><h2 class="grp ok">Hechos <span class="count">${done.length}</span></h2></summary>
    <ul class="rows">${done.map((i) => issueRow(i, { showArea: !area })).join('')}</ul>
  </details>` : ''}`;
}

function preventiveList(area) {
  const st = settings();
  const statuses = allStatuses(repo.state, st).filter((s) => !area || s.task.system === area);
  const byArea = {};
  for (const s of statuses) (byArea[validArea(s.task.system) ? s.task.system : 'otros'] ||= []).push(s);
  if (!statuses.length) return '<p class="muted">No hay tareas de mantenimiento en esta área.</p>';
  return `<p class="muted">Mantenimiento periódico, por horas de motor o por fecha. Toca una tarea para ver su historial o cambiar el intervalo.</p>
  ${AREAS.filter((a) => byArea[a.id]).map((a) => `
    <section>
      <h2>${esc(a.name)}</h2>
      <ul class="rows">${byArea[a.id].sort((x, y) => x.task.name.localeCompare(y.task.name, 'es')).map((s) => `
        <li><a class="row st-${s.status}" href="#/tarea/${encodeURIComponent(s.task.id)}">
          <span class="flag" aria-hidden="true"></span>
          <span class="row-main"><span class="row-title">${esc(s.task.name)}</span>
          <span class="row-sub">${esc(intervalText(s.task))}. ${STATUS_LABEL[s.status]}.</span></span>
        </a></li>`).join('')}</ul>
    </section>`).join('')}`;
}

function viewIssue(id) {
  const i = issueById(id);
  if (!i) return notFound('Este correctivo ya no existe.');
  const done = i.status === 'hecho';
  const cost = issueCost(i);
  return `
  ${backLink('#/trabajos', 'Trabajos')}
  <article class="detail">
    <p class="badge ${done ? 'st-ok' : PRIO_CLASS[i.priority]}">${done ? 'Hecho' : `Prioridad ${esc(prioName(i.priority).toLowerCase())}`}</p>
    <h1>${esc(i.title)}</h1>
    <dl class="facts">
      <dt>Área</dt><dd><a href="${workQuery('correctivos', i.area)}">${esc(areaName(i.area))}</a></dd>
      <dt>Detectado</dt><dd>${fmtDate(i.detectedDate)}</dd>
      ${done ? '' : `<dt>Prioridad</dt><dd>${esc(prioName(i.priority))}: ${esc((PRIORITIES.find((p) => p.id === i.priority) || {}).hint || '')}</dd>`}
    </dl>
    ${i.description ? `<p class="note pre">${esc(i.description)}</p>` : ''}
    ${(i.problemPhotoIds || []).length ? `<div class="thumbs" data-photos>${i.problemPhotoIds.map((p) => `<button class="thumb" data-action="open-photo" data-id="${esc(p)}" aria-label="Abrir foto"><span class="ph-loading">Cargando…</span></button>`).join('')}</div>` : ''}
    ${done ? `
    <section class="donebox">
      <h2>Trabajo hecho</h2>
      <dl class="facts">
        <dt>Fecha</dt><dd>${fmtDate(i.doneDate)}</dd>
        <dt>Hecho por</dt><dd>${i.doneBy === 'taller' ? esc(i.workshop || 'Taller') : 'Yo mismo'}</dd>
        <dt>Coste</dt><dd>${fmtMoney(cost)}</dd>
        ${isNum(i.engineHours) ? `<dt>Horas de motor</dt><dd>${fmtHours(i.engineHours)}</dd>` : ''}
      </dl>
      ${i.work ? `<p class="note pre">${esc(i.work)}</p>` : ''}
      ${i.doneBy !== 'taller' && (i.materials || []).length ? `<table class="mat"><tbody>${i.materials.map((m) => `<tr><td>${esc(m.desc)}</td><td class="money">${fmtMoney(num(m.cost))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(i.photoIds || []).length ? `<h3>Factura</h3><div class="thumbs" data-photos>${i.photoIds.map((p) => `<button class="thumb" data-action="open-photo" data-id="${esc(p)}" aria-label="Abrir factura"><span class="ph-loading">Cargando…</span></button>`).join('')}</div>` : ''}
    </section>` : ''}
    <div class="actions">
      ${done
        ? `<a class="btn" href="#/correctivo/${encodeURIComponent(i.id)}/cerrar">Editar trabajo hecho</a>
           <button class="btn" data-action="reopen-issue" data-id="${esc(i.id)}">Volver a pendiente</button>`
        : `<a class="btn primary" href="#/correctivo/${encodeURIComponent(i.id)}/cerrar">Marcar como hecho</a>`}
      <a class="btn" href="#/correctivo/${encodeURIComponent(i.id)}/editar">Editar</a>
      <button class="btn danger" data-action="delete-issue" data-id="${esc(i.id)}">Borrar</button>
    </div>
  </article>`;
}

function newIssueDraft(r, existing) {
  if (existing) {
    return {
      kind: 'issue', id: existing.id, isNew: false,
      title: existing.title, area: existing.area, priority: existing.priority,
      detectedDate: existing.detectedDate, description: existing.description || '',
      problemPhotos: (existing.problemPhotoIds || []).map((id) => ({ id, existing: true })),
      photos: [], materials: [], removedPhotos: [],
    };
  }
  const a = r.params.get('area');
  return {
    kind: 'issue', id: uid(), isNew: true,
    title: '', area: validArea(a) ? a : '', priority: 'media',
    detectedDate: todayStr(), description: '',
    problemPhotos: [], photos: [], materials: [], removedPhotos: [],
  };
}

function viewIssueForm(r, editId) {
  let existing = null;
  if (editId) {
    existing = issueById(editId);
    if (!existing) return notFound('Este correctivo ya no existe.');
  }
  const key = location.hash;
  if (!issueDraft || issueDraft.key !== key) {
    issueDraft = loadStoredDraft(key) || newIssueDraft(r, existing);
    issueDraft.key = key;
  }
  const d = issueDraft;
  const back = editId ? `#/correctivo/${encodeURIComponent(editId)}` : '#/trabajos';
  return `
  ${backLink(back, 'Cancelar')}
  <h1>${editId ? 'Editar correctivo' : 'Nuevo correctivo'}</h1>
  <p class="hint">Algo que has visto y hay que arreglar. Cuando lo hagas, márcalo como hecho y apunta el trabajo y el coste.</p>
  <form id="issue-form" class="form" novalidate>
    <label>Qué hay que arreglar<input type="text" name="title" value="${esc(d.title)}" placeholder="Por ejemplo: cambiar la polea del pie de palo" maxlength="200" required></label>
    <label>Área${areaSelect('area', d.area, { extra: d.area ? [] : [] }).replace('<select name="area">', `<select name="area" required><option value="" ${d.area ? '' : 'selected'} disabled>Elige un área</option>`)}</label>
    <fieldset class="seg prio" role="radiogroup">
      <legend>Prioridad</legend>
      ${PRIORITIES.map((p) => `<label><input type="radio" name="priority" value="${p.id}" ${d.priority === p.id ? 'checked' : ''}><span class="${PRIO_CLASS[p.id]}">${esc(p.name)}</span></label>`).join('')}
    </fieldset>
    <p class="hint" id="prio-hint">${esc((PRIORITIES.find((p) => p.id === d.priority) || {}).hint || '')}</p>
    <label>Detectado el<input type="date" name="detectedDate" value="${esc(d.detectedDate)}" max="${todayStr()}" required></label>
    <label>Descripción <span class="muted">(opcional)</span><textarea name="description" rows="3" placeholder="Qué le pasa, medidas, referencia de la pieza…">${esc(d.description)}</textarea></label>
    <fieldset>
      <legend>Fotos <span class="muted">(opcional)</span></legend>
      <div class="thumbs" id="problem-photos">${draftPhotos(d, 'problemPhotos')}</div>
      <label class="btn file">${ICON.cam}<span>Añadir foto</span>
        <input type="file" id="problem-input" class="sr" accept="image/*" multiple></label>
    </fieldset>
    <p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions sticky"><button class="btn primary" type="submit">${editId ? 'Guardar cambios' : 'Guardar correctivo'}</button></div>
  </form>`;
}

function bindIssueForm() {
  const form = document.getElementById('issue-form');
  if (!form) return;
  const d = issueDraft;
  form.addEventListener('input', (e) => {
    const el = e.target;
    markDirty(d);
    if (['title', 'detectedDate', 'description', 'area'].includes(el.name)) d[el.name] = el.value;
  });
  form.addEventListener('change', async (e) => {
    const el = e.target;
    markDirty(d);
    if (el.name === 'area') d.area = el.value;
    else if (el.name === 'priority') {
      d.priority = el.value;
      document.getElementById('prio-hint').textContent = (PRIORITIES.find((p) => p.id === d.priority) || {}).hint || '';
    } else await handleCostChange(el, d);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, saveIssue);
  });
  loadDraftPhotos(d);
}

async function saveIssue() {
  const d = issueDraft;
  const err = document.getElementById('form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  if (!d.title.trim()) return fail('Escribe qué hay que arreglar.');
  if (!validArea(d.area)) return fail('Elige el área del barco.');
  if (!d.detectedDate) return fail('Falta la fecha.');
  if (d.detectedDate > todayStr()) return fail('La fecha no puede ser futura.');
  const old = issueById(d.id);
  if (old?.status === 'hecho' && old.doneDate && d.detectedDate > old.doneDate) return fail('No puede detectarse después de haberse arreglado.');
  for (const p of d.problemPhotos) {
    if (!p.existing) await repo.putPhoto({ id: p.id, data: p.data, mime: p.mime, name: p.name || '', interventionId: d.id });
  }
  for (const id of d.removedPhotos) await repo.delPhoto(id);
  const obj = {
    ...(old || { status: 'pendiente', createdAt: new Date().toISOString() }),
    id: d.id,
    title: d.title.trim().slice(0, 200),
    area: d.area,
    priority: d.priority,
    detectedDate: d.detectedDate,
    description: d.description.trim(),
    problemPhotoIds: d.problemPhotos.map((p) => p.id),
  };
  await repo.put('issues', obj);
  formSaved(d.key);
  issueDraft = null;
  toast(d.isNew ? 'Correctivo apuntado' : 'Cambios guardados');
  go(d.isNew ? '#/trabajos' : `#/correctivo/${encodeURIComponent(obj.id)}`);
}

function viewIssueClose(id) {
  const i = issueById(id);
  if (!i) return notFound('Este correctivo ya no existe.');
  const key = location.hash;
  if (!issueDraft || issueDraft.key !== key) {
    const stored = loadStoredDraft(key);
    const done = i.status === 'hecho';
    const cur = currentHours(repo.state);
    issueDraft = stored || {
      kind: 'close', id: i.id, wasDone: done,
      doneDate: done ? i.doneDate : todayStr(),
      work: done ? i.work || '' : '',
      engineHours: done && isNum(i.engineHours) ? String(i.engineHours).replace('.', ',') : '',
      hoursHint: cur ? cur.hours : null,
      doneBy: done ? i.doneBy : 'yo',
      materials: done && (i.materials || []).length ? i.materials.map((m) => ({ desc: m.desc, cost: String(m.cost).replace('.', ',') })) : [{ desc: '', cost: '' }],
      workshop: done ? i.workshop || '' : '',
      invoiceTotal: done && isNum(i.invoiceTotal) ? String(i.invoiceTotal).replace('.', ',') : '',
      photos: done ? (i.photoIds || []).map((pid) => ({ id: pid, existing: true })) : [],
      problemPhotos: [],
      removedPhotos: [],
    };
    issueDraft.key = key;
  }
  const d = issueDraft;
  return `
  ${backLink(`#/correctivo/${encodeURIComponent(i.id)}`, 'Cancelar')}
  <h1>${d.wasDone ? 'Editar trabajo hecho' : 'Marcar como hecho'}</h1>
  <p class="muted">${esc(i.title)}</p>
  <form id="close-form" class="form" novalidate>
    <div class="grid2">
      <label>Fecha<input type="date" name="doneDate" value="${esc(d.doneDate)}" min="${esc(i.detectedDate)}" max="${todayStr()}" required></label>
      <label>Horas de motor <span class="muted">(opcional)</span><input type="text" name="engineHours" inputmode="decimal" value="${esc(d.engineHours)}"
        placeholder="${d.hoursHint != null ? 'Última: ' + esc(d.hoursHint.toLocaleString('es-ES')) : ''}"></label>
    </div>
    <label>Trabajo hecho<textarea name="work" rows="3" placeholder="Qué se hizo, piezas cambiadas…">${esc(d.work)}</textarea></label>
    <fieldset class="seg" role="radiogroup">
      <legend>¿Quién lo hizo?</legend>
      <label><input type="radio" name="doneBy" value="yo" ${d.doneBy !== 'taller' ? 'checked' : ''}><span>Yo</span></label>
      <label><input type="radio" name="doneBy" value="taller" ${d.doneBy === 'taller' ? 'checked' : ''}><span>Taller o profesional</span></label>
    </fieldset>
    <div id="cost-block">${costBlock(d)}</div>
    <p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions sticky"><button class="btn primary" type="submit">${d.wasDone ? 'Guardar cambios' : 'Guardar como hecho'}</button></div>
  </form>`;
}

function bindIssueClose() {
  const form = document.getElementById('close-form');
  if (!form) return;
  const d = issueDraft;
  form.addEventListener('input', (e) => {
    const el = e.target;
    markDirty(d);
    if (['doneDate', 'work', 'engineHours'].includes(el.name)) d[el.name] = el.value;
    else handleCostInput(el, d);
  });
  form.addEventListener('change', async (e) => {
    markDirty(d);
    await handleCostChange(e.target, d);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, saveIssueClose);
  });
  loadDraftPhotos(d);
}

async function saveIssueClose() {
  const d = issueDraft;
  const i = issueById(d.id);
  const err = document.getElementById('form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  if (!i) return fail('Este correctivo ya no existe.');
  if (!d.doneDate) return fail('Falta la fecha.');
  if (d.doneDate > todayStr()) return fail('La fecha no puede ser futura.');
  if (d.doneDate < i.detectedDate) return fail(`La fecha no puede ser anterior a cuando se detectó (${fmtDate(i.detectedDate)}).`);
  const hours = d.engineHours.trim() === '' ? null : parseNum(d.engineHours);
  if (hours !== null && !(hours >= 0)) return fail('Las horas de motor no son válidas.');
  if (d.doneBy === 'taller' && d.invoiceTotal.trim() && !(parseNum(d.invoiceTotal) >= 0)) return fail('El total de la factura no es un importe válido.');
  if (d.doneBy !== 'taller' && d.materials.some((m) => String(m.cost).trim() && !(parseNum(m.cost) >= 0))) return fail('Algún coste de material no es un importe válido.');
  if (!confirmHours(hours === null ? null : round1(hours), d.doneDate)) return;

  if (d.doneBy === 'taller') {
    for (const p of d.photos) {
      if (!p.existing) await repo.putPhoto({ id: p.id, data: p.data, mime: p.mime, name: p.name || '', interventionId: i.id });
    }
  } else {
    for (const p of d.photos) if (p.existing) await repo.delPhoto(p.id);
  }
  for (const id of d.removedPhotos) await repo.delPhoto(id);

  await repo.put('issues', {
    ...i,
    status: 'hecho',
    doneDate: d.doneDate,
    work: d.work.trim(),
    engineHours: hours === null ? null : round1(hours),
    doneBy: d.doneBy === 'taller' ? 'taller' : 'yo',
    materials: d.doneBy !== 'taller' ? d.materials.filter((m) => m.desc.trim() || num(m.cost)).map((m) => ({ desc: m.desc.trim(), cost: num(m.cost) })) : [],
    workshop: d.doneBy === 'taller' ? d.workshop.trim() : '',
    invoiceTotal: d.doneBy === 'taller' ? num(d.invoiceTotal) : null,
    photoIds: d.doneBy === 'taller' ? d.photos.map((p) => p.id) : [],
  });
  formSaved(d.key);
  issueDraft = null;
  toast(d.wasDone ? 'Cambios guardados' : 'Correctivo hecho');
  go(`#/correctivo/${encodeURIComponent(i.id)}`);
}

// ───────────────────────── Service worker ─────────────────────────
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const show = () => {
      const b = document.getElementById('update');
      b.hidden = false;
    };
    if (reg.waiting) show();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) show();
      });
    });
  }).catch((e) => console.warn('SW', e));
  // Recargar solo al pasar de una versión a otra (no en la primera instalación)
  let reloading = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

boot().catch((e) => {
  console.error(e);
  $view.innerHTML = `<p class="notice">No se ha podido abrir la app: ${esc(e.message)}</p>`;
});
