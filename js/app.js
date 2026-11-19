import { DEFAULT_TASKS, DEFAULT_SETTINGS, SYSTEMS } from './tasks-default.js';
import {
  todayStr, addMonths, daysBetween, currentHours, usageRate, allStatuses, sortStatuses,
  taskStatus, lastInterventionFor, interventionCost, buildICS, isNum, num, parseNum, round1,
  fmtDate, fmtMoney, fmtHours,
} from './logic.js';
import {
  Repo, uid, cloudConfigured, currentUser, signIn, signUp, resetPassword, signOutCloud,
  readLocalDump, COLLECTIONS,
} from './store.js';

const APP_VERSION = '1.0.0';
const repo = new Repo();
const $view = document.getElementById('view');
const $sync = document.getElementById('sync');
let seededCloud = false;
let draft = null; // formulario de intervención en curso
let lastRoute = '';

// ───────────────────────── Utilidades ─────────────────────────
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sysName = (id) => (SYSTEMS.find((s) => s.id === id) || { name: 'Otros' }).name;

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
  toast.t = setTimeout(() => (el.hidden = true), 2600);
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

  let usedCloud = false;
  if (localStorage.getItem('velero.mode') === 'cloud' && cloudConfigured()) {
    try {
      const user = await currentUser();
      if (user) {
        const r = await repo.useCloud(user);
        usedCloud = true;
        if (r.fresh) await ensureDefaults();
      }
    } catch (e) {
      console.error(e);
    }
  }
  if (!usedCloud) {
    await repo.useLocal();
    await ensureDefaults();
  }

  repo.onChange((state, sync) => {
    updateSyncBadge();
    if (sync.mode === 'cloud' && sync.serverConfirmed && !seededCloud) {
      seededCloud = true;
      ensureDefaults();
    }
    scheduleRender();
  });
  window.addEventListener('hashchange', () => render(true));
  document.addEventListener('click', onClick);
  updateSyncBadge();
  render(true);
}

// Añade las tareas del catálogo que falten (también las que traigan versiones nuevas).
async function ensureDefaults() {
  const s = settings();
  const deleted = new Set(s.deletedDefaults || []);
  const have = new Set(repo.state.tasks.map((t) => t.id));
  const missing = DEFAULT_TASKS.filter((t) => !have.has(t.id) && !deleted.has(t.id));
  for (const t of missing) await repo.put('tasks', { ...t, createdAt: new Date().toISOString() });
  if (!repo.state.meta.find((m) => m.id === 'settings')) await saveSettings({});
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
const FORM_ROUTES = new Set(['registrar', 'editar-intervencion', 'editar-tarea', 'ajustes', 'nueva-tarea']);

function render(force) {
  const r = route();
  const formKey = formRouteKey(r);
  if (!force && FORM_ROUTES.has(formKey)) return;
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
    case 'tareas': html = viewTasks(); break;
    case 'tarea': html = viewTask(r.parts[1]); break;
    case 'editar-tarea': html = viewTaskEdit(r.parts[1]); break;
    case 'nueva-tarea': html = viewTaskEdit(null); break;
    case 'horas': html = viewHours(); break;
    case 'ajustes': html = viewSettings(); break;
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
  return a || '';
}

function setNav(key) {
  const map = { '': 'home', tarea: 'home', horas: 'home', historial: 'log', intervencion: 'log', tareas: 'tasks', ajustes: 'gear', registrar: 'add' };
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

  ${blank ? `
  <section class="notice">
    <h2>Para empezar</h2>
    <p>Registra cuándo se hizo por última vez cada tarea, aunque sea aproximado (por ejemplo, el último cambio de aceite o la revisión de la balsa). Con eso la app calcula cuándo te toca la siguiente.</p>
    <a class="btn primary" href="#/registrar">Registrar una intervención</a>
  </section>` : ''}

  ${groups.overdue.length ? `<section><h2 class="grp overdue">Vencidas <span class="count">${groups.overdue.length}</span></h2>${list(groups.overdue)}</section>` : ''}
  ${groups.soon.length ? `<section><h2 class="grp soon">Toca pronto <span class="count">${groups.soon.length}</span></h2>${list(groups.soon)}</section>` : ''}
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
  `;
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

function viewHistory(r) {
  const all = [...repo.state.interventions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const years = [...new Set(all.map((i) => i.date.slice(0, 4)))].sort().reverse();
  const year = r.params.get('anio') || (years[0] || '');
  const list = year === 'todo' ? all : all.filter((i) => i.date.startsWith(year));
  const total = list.reduce((s, i) => s + interventionCost(i), 0);
  const bySys = {};
  for (const i of list) {
    const k = interventionSystem(i);
    bySys[k] = (bySys[k] || 0) + interventionCost(i);
  }
  const sysRows = Object.entries(bySys).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...sysRows.map(([, v]) => v));
  const mine = list.filter((i) => i.doneBy !== 'taller').reduce((s, i) => s + interventionCost(i), 0);

  if (!all.length) {
    return `<h1>Historial</h1>
    <section class="notice"><p>Aún no hay intervenciones. Cada vez que hagas o encargues un mantenimiento, regístralo aquí con la fecha, las horas y el coste.</p>
    <a class="btn primary" href="#/registrar">Registrar una intervención</a></section>`;
  }

  return `
  <h1>Historial</h1>
  <nav class="chips" aria-label="Año">
    ${years.map((y) => `<a href="#/historial?anio=${y}" ${y === year ? 'aria-current="true"' : ''}>${y}</a>`).join('')}
    <a href="#/historial?anio=todo" ${year === 'todo' ? 'aria-current="true"' : ''}>Todo</a>
  </nav>
  <section class="spend">
    <p class="spend-total"><span class="money big">${fmtMoney(total)}</span> en ${list.length} ${list.length === 1 ? 'intervención' : 'intervenciones'}${year === 'todo' ? '' : ` en ${year}`}</p>
    <p class="muted">Material propio: ${fmtMoney(mine)}. Talleres: ${fmtMoney(total - mine)}.</p>
    ${sysRows.length ? `<ul class="bars">${sysRows.map(([k, v]) => `
      <li><span class="bar-label">${esc(k === 'varios' ? 'Varios sistemas' : sysName(k))}</span>
      <span class="bar"><span style="width:${Math.max(2, (v / max) * 100)}%"></span></span>
      <span class="money">${fmtMoney(v)}</span></li>`).join('')}</ul>` : ''}
  </section>
  <ul class="log">${list.map(logRow).join('')}</ul>`;
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
    ${(i.photoIds || []).length ? `<h2>Factura</h2><div class="thumbs" id="thumbs">${i.photoIds.map((p) => `<button class="thumb" data-action="open-photo" data-id="${esc(p)}" aria-label="Abrir factura"><span class="ph-loading">Cargando…</span></button>`).join('')}</div>` : ''}
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

async function loadThumbs() {
  const btns = document.querySelectorAll('#thumbs .thumb');
  for (const b of btns) {
    const p = await repo.getPhoto(b.dataset.id);
    if (!b.isConnected) return;
    if (!p) { b.innerHTML = '<span class="ph-loading">No disponible sin conexión</span>'; continue; }
    b.innerHTML = p.mime === 'application/pdf'
      ? `<span class="pdf">PDF<br>${esc(p.name || '')}</span>`
      : `<img src="${p.data}" alt="Factura">`;
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
  const pre = r.params.get('tarea');
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
    draft = newDraft(r, existing);
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
      <input type="search" id="task-filter" placeholder="Buscar tarea (aceite, balsa, winches…)" value="${esc(d.filter)}" autocomplete="off">
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

function costBlock() {
  const d = draft;
  if (d.doneBy === 'taller') {
    return `<fieldset><legend>Factura</legend>
      <div class="grid2">
        <label>Taller o profesional<input type="text" data-f="workshop" value="${esc(d.workshop)}" placeholder="Nombre"></label>
        <label>Total de la factura (€)<input type="text" data-f="invoiceTotal" inputmode="decimal" value="${esc(d.invoiceTotal)}"></label>
      </div>
      <div class="thumbs" id="draft-photos">${draftPhotos()}</div>
      <label class="btn file">${ICON.cam}<span>Añadir foto o PDF de la factura</span>
        <input type="file" id="photo-input" accept="image/*,application/pdf" multiple hidden></label>
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

function draftPhotos() {
  return draft.photos.map((p, idx) => `
    <div class="thumb" data-ph="${idx}">
      ${p.data ? (p.mime === 'application/pdf' ? `<span class="pdf">PDF<br>${esc(p.name || '')}</span>` : `<img src="${p.data}" alt="Factura ${idx + 1}">`) : '<span class="ph-loading">Cargando…</span>'}
      <button type="button" class="icon del" data-action="del-photo" data-idx="${idx}" aria-label="Quitar foto">${ICON.trash}</button>
    </div>`).join('');
}

async function loadDraftPhotos() {
  let changed = false;
  for (const p of draft.photos) {
    if (p.existing && !p.data) {
      const ph = await repo.getPhoto(p.id);
      if (ph) { p.data = ph.data; p.mime = ph.mime; p.name = ph.name; changed = true; }
    }
  }
  const el = document.getElementById('draft-photos');
  if (changed && el) el.innerHTML = draftPhotos();
}

function bindRegister() {
  const form = document.getElementById('reg-form');
  const d = draft;
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.name === 'date') d.date = el.value;
    else if (el.name === 'engineHours') d.engineHours = el.value;
    else if (el.name === 'title') d.title = el.value;
    else if (el.name === 'notes') d.notes = el.value;
    else if (el.id === 'task-filter') { d.filter = el.value; document.getElementById('picklist').innerHTML = pickList(); }
    else if (el.dataset.expiry) d.expiries[el.dataset.expiry] = el.value;
    else if (el.dataset.f) d[el.dataset.f] = el.value;
    else if (el.dataset.mat !== undefined) {
      d.materials[+el.dataset.mat][el.dataset.k] = el.value;
      const tot = document.getElementById('mat-total');
      if (tot) tot.textContent = fmtMoney(d.materials.reduce((s, m) => s + num(m.cost), 0));
    }
  });
  form.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.pick) {
      if (el.checked) d.taskIds.add(el.dataset.pick); else d.taskIds.delete(el.dataset.pick);
      refreshPicked();
    } else if (el.name === 'doneBy') {
      d.doneBy = el.value;
      document.getElementById('cost-block').innerHTML = costBlock();
      loadDraftPhotos();
    } else if (el.id === 'photo-input') {
      const files = [...el.files];
      el.value = '';
      for (const f of files) {
        try {
          const ph = await fileToPhoto(f);
          d.photos.push(ph);
        } catch (err) {
          toast(err.message);
        }
      }
      document.getElementById('draft-photos').innerHTML = draftPhotos();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveDraft();
  });
  loadDraftPhotos();
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
  if (!d.taskIds.size && !d.title.trim()) return fail('Marca al menos una tarea o escribe una descripción.');
  const hours = d.engineHours.trim() === '' ? null : parseNum(d.engineHours);
  if (hours !== null && !(hours >= 0)) return fail('Las horas de motor no son válidas. Escribe solo el número, por ejemplo 1180,5.');
  if (d.doneBy === 'taller' && d.invoiceTotal.trim() && !(parseNum(d.invoiceTotal) >= 0)) return fail('El total de la factura no es un importe válido.');
  if (d.doneBy === 'yo' && d.materials.some((m) => String(m.cost).trim() && !(parseNum(m.cost) >= 0))) return fail('Algún coste de material no es un importe válido.');

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
    taskIds: [...d.taskIds],
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
function viewTasks() {
  const st = settings();
  const statuses = allStatuses(repo.state, st);
  const bySys = {};
  for (const s of statuses) (bySys[s.task.system] ||= []).push(s);
  return `
  <div class="titlebar"><h1>Tareas</h1><a class="btn small" href="#/tarea/nueva">Nueva tarea</a></div>
  <p class="muted">Toca una tarea para ver su historial o cambiar el intervalo. Las desactivadas no generan avisos.</p>
  ${SYSTEMS.filter((s) => bySys[s.id]).map((sys) => `
    <section>
      <h2>${esc(sys.name)}</h2>
      <ul class="rows">${bySys[sys.id].sort((a, b) => a.task.name.localeCompare(b.task.name, 'es')).map((s) => `
        <li><a class="row st-${s.status}" href="#/tarea/${encodeURIComponent(s.task.id)}">
          <span class="flag" aria-hidden="true"></span>
          <span class="row-main"><span class="row-title">${esc(s.task.name)}</span>
          <span class="row-sub">${esc(intervalText(s.task))}. ${STATUS_LABEL[s.status]}.</span></span>
        </a></li>`).join('')}</ul>
    </section>`).join('')}`;
}

function viewTaskEdit(id) {
  const st = settings();
  const t = id ? taskById(id) : {
    id: 'u-' + uid().slice(0, 8), system: 'otros', name: '', type: 'intervalo', intervalHours: null,
    intervalMonths: 12, noticeHours: null, noticeDays: null, active: true, notes: '', builtin: false,
  };
  if (!t) return notFound('Esta tarea ya no existe.');
  const back = id ? `#/tarea/${encodeURIComponent(id)}` : '#/tareas';
  return `
  ${backLink(back, 'Cancelar')}
  <h1>${id ? 'Editar tarea' : 'Nueva tarea'}</h1>
  <form id="task-form" class="form" data-id="${esc(t.id)}" data-new="${id ? '0' : '1'}">
    <label>Nombre<input type="text" name="name" value="${esc(t.name)}" required></label>
    <label>Sistema<select name="system">${SYSTEMS.map((s) => `<option value="${s.id}" ${s.id === t.system ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <fieldset class="seg">
      <legend>Cómo se calcula la próxima</legend>
      <label><input type="radio" name="type" value="intervalo" ${t.type !== 'caducidad' ? 'checked' : ''}><span>Por intervalo</span></label>
      <label><input type="radio" name="type" value="caducidad" ${t.type === 'caducidad' ? 'checked' : ''}><span>Por fecha de caducidad</span></label>
    </fieldset>
    <div class="grid2">
      <label>Cada (horas de motor)<input type="number" name="intervalHours" min="0" step="1" inputmode="numeric" value="${t.intervalHours ?? ''}" placeholder="—"></label>
      <label>Cada (meses)<input type="number" name="intervalMonths" min="0" step="1" inputmode="numeric" value="${t.intervalMonths ?? ''}" placeholder="—"></label>
    </div>
    <p class="hint">Si rellenas los dos, avisa con lo que llegue antes. En las tareas por caducidad, los meses solo se usan si no anotas la fecha.</p>
    <div class="grid2">
      <label>Avisar con (horas)<input type="number" name="noticeHours" min="0" step="1" inputmode="numeric" value="${t.noticeHours ?? ''}" placeholder="${st.noticeHours} (por defecto)"></label>
      <label>Avisar con (días)<input type="number" name="noticeDays" min="0" step="1" inputmode="numeric" value="${t.noticeDays ?? ''}" placeholder="${st.noticeDays} (por defecto)"></label>
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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
    toast('Tarea guardada');
    go(`#/tarea/${encodeURIComponent(id)}`);
  });
}

// ───────────────────────── Horas ─────────────────────────
function viewHours() {
  const pts = [
    ...repo.state.readings.map((r) => ({ ...r, kind: 'lectura' })),
    ...repo.state.interventions.filter((i) => isNum(i.engineHours)).map((i) => ({ id: i.id, date: i.date, hours: i.engineHours, kind: 'intervencion', title: interventionTitle(i) })),
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
        : `<a href="#/intervencion/${encodeURIComponent(p.id)}">${esc(p.title)}</a>`}</span>
    </li>`).join('')}</ul>` : '<p class="muted">Aún no hay lecturas.</p>'}`;
}

async function addReading(date, hours) {
  await repo.put('readings', { id: uid(), date, hours: round1(hours) });
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
      <label class="btn file"><span>Importar copia</span><input type="file" id="import-input" accept="application/json,.json" hidden></label>
    </div>
  </section>

  <section class="about">
    <h2>Acerca de</h2>
    <p>Versión ${APP_VERSION}. Los plazos de seguridad y documentación siguen la normativa de bandera española (RD 339/2021 y RD 1434/1999). Si cambias de bandera, revisa esas tareas.</p>
    <button class="btn link" data-action="check-update">Buscar actualización</button>
  </section>`;
}

function bindSettings() {
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await saveSettings({
      boatName: String(fd.get('boatName') || '').trim() || DEFAULT_SETTINGS.boatName,
      boatModel: String(fd.get('boatModel') || '').trim(),
      engine: String(fd.get('engine') || '').trim(),
      noticeHours: num(fd.get('noticeHours')),
      noticeDays: num(fd.get('noticeDays')),
    });
    toast('Ajustes guardados');
  });
  const login = document.getElementById('login-form');
  if (login) {
    login.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(login);
      const op = e.submitter?.value || 'in';
      const errEl = document.getElementById('login-error');
      errEl.hidden = true;
      try {
        const cred = op === 'up'
          ? await signUp(fd.get('email'), fd.get('password'))
          : await signIn(fd.get('email'), fd.get('password'));
        await switchToCloud(cred.user);
      } catch (err) {
        errEl.textContent = authError(err);
        errEl.hidden = false;
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
  const hasLocal = local.interventions.length || local.readings.length;
  localStorage.setItem('velero.mode', 'cloud');
  seededCloud = false;
  const r = await repo.useCloud(user);
  if (hasLocal) {
    const ok = confirm(`Este dispositivo tiene ${local.interventions.length} intervenciones y ${local.readings.length} lecturas guardadas sin cuenta. ¿Subirlas a tu cuenta?`);
    if (ok) {
      for (const c of COLLECTIONS) for (const obj of local[c]) await repo.put(c, obj);
      for (const p of local.photos) await repo.putPhoto(p);
      toast('Datos subidos a tu cuenta');
    }
  }
  if (r.fresh) { seededCloud = true; await ensureDefaults(); }
  updateSyncBadge();
  render(true);
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
  for (const i of repo.state.interventions) {
    for (const id of i.photoIds || []) {
      const p = await repo.getPhoto(id);
      if (p) photos.push(p);
    }
  }
  const data = {
    app: 'velero-mantenimiento',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    tasks: repo.state.tasks,
    interventions: repo.state.interventions,
    readings: repo.state.readings,
    meta: repo.state.meta,
    photos,
  };
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
  if (data.app !== 'velero-mantenimiento') { toast('Ese archivo no es una copia de esta app.'); return; }
  const n = (data.interventions || []).length;
  if (!confirm(`La copia tiene ${n} intervenciones. Se añadirán a tus datos (las que ya existan se sustituirán por las de la copia). ¿Continuar?`)) return;
  for (const c of COLLECTIONS) for (const obj of data[c] || []) await repo.put(c, obj);
  for (const p of data.photos || []) await repo.putPhoto(p);
  toast('Copia importada');
  go('#/');
}

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  const standaloneIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standaloneIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
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

// ───────────────────────── Eventos ─────────────────────────
function bindView(key) {
  if (key === '') {
    document.getElementById('hours-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = parseNum(e.target.hours.value);
      if (!(v >= 0)) { toast('Escribe las horas con números, por ejemplo 1180,5'); return; }
      const cur = currentHours(repo.state);
      if (cur && v < cur.hours && !confirm(`El valor (${fmtHours(v)}) es menor que la última lectura (${fmtHours(cur.hours)}). ¿Guardarlo igualmente?`)) return;
      await addReading(todayStr(), v);
    });
  } else if (key === 'registrar' || key === 'editar-intervencion') {
    bindRegister();
  } else if (key === 'editar-tarea' || key === 'nueva-tarea') {
    bindTaskForm();
  } else if (key === 'ajustes') {
    bindSettings();
  } else if (key === 'intervencion') {
    loadThumbs();
  } else if (key === 'horas') {
    document.getElementById('reading-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = parseNum(e.target.hours.value);
      if (!(v >= 0)) { toast('Escribe las horas con números, por ejemplo 1180,5'); return; }
      await addReading(e.target.date.value, v);
      render(true);
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
    draft.materials.push({ desc: '', cost: '' });
    document.getElementById('cost-block').innerHTML = costBlock();
    const inputs = document.querySelectorAll('[data-k="desc"]');
    inputs[inputs.length - 1]?.focus();
  } else if (a === 'del-mat') {
    draft.materials.splice(+el.dataset.idx, 1);
    if (!draft.materials.length) draft.materials.push({ desc: '', cost: '' });
    document.getElementById('cost-block').innerHTML = costBlock();
  } else if (a === 'del-photo') {
    const [p] = draft.photos.splice(+el.dataset.idx, 1);
    if (p?.existing) draft.removedPhotos.push(p.id);
    document.getElementById('draft-photos').innerHTML = draftPhotos();
  } else if (a === 'open-photo') {
    const p = await repo.getPhoto(el.dataset.id);
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
    go('#/tareas');
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
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.update(); toast(reg.waiting ? 'Hay una versión nueva' : 'Tienes la última versión'); }
  } else if (a === 'apply-update') {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.waiting?.postMessage('skipWaiting');
  } else if (a === 'close-viewer') {
    document.getElementById('viewer').remove();
  }
}

function openPhoto(p) {
  if (p.mime === 'application/pdf') {
    const bin = atob(p.data.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    window.open(url, '_blank');
    return;
  }
  const v = document.createElement('div');
  v.id = 'viewer';
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-label', 'Factura');
  v.innerHTML = `<button class="btn" data-action="close-viewer">Cerrar</button><img src="${p.data}" alt="Factura">`;
  document.body.appendChild(v);
  v.querySelector('button').focus();
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
