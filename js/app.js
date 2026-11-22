// Arranque, rutas, navegación y eventos globales.

import { repo, $view, esc, route, setRenderer } from './core.js';
import { cloudConfigured, currentUser } from './store.js';
import { ensureDefaults } from './data.js';
import {
  setFormRoutes, routeFormKey, forgetOtherDrafts, isDirty, discardDraft, closeViewer, loadThumbs, formActions, photoActions,
} from './forms.js';
import { viewHome, bindHome, viewNew } from './views/home.js';
import {
  viewTask, viewTaskEdit, bindTaskForm, viewRegister, bindRegister, viewIntervention, viewHours, bindHours,
  actions as maintenanceActions,
} from './views/maintenance.js';
import { bindAreaFilter } from './ui.js';
import { viewWork, viewIssue, viewIssueForm, bindIssueForm, viewIssueClose, bindIssueClose, actions as issueActions } from './views/issues.js';
import { viewLogbook, viewTrip, viewTripForm, bindTripForm, viewFuel, viewFuelForm, bindFuelForm, actions as logbookActions } from './views/logbook.js';
import { viewHistory } from './views/history.js';
import { viewSettings, bindSettings, setSyncListener, actions as settingsActions } from './views/settings.js';

// ───────────────────────── Rutas ─────────────────────────
// view(r) devuelve el HTML; bind() conecta eventos; form: no se repinta sola; nav: pestaña activa.
const id = (r) => r.parts[1];
let refocus = null; // selector a enfocar tras repintar (filtros que navegan)
const setRefocus = (sel) => (refocus = sel);

const ROUTES = {
  '': { view: viewHome, bind: bindHome, nav: 'home' },
  nuevo: { view: viewNew, nav: 'add' },
  horas: { view: viewHours, bind: bindHours, nav: 'home' },
  tarea: { view: (r) => viewTask(id(r)), nav: 'work' },
  'nueva-tarea': { view: () => viewTaskEdit(null), bind: bindTaskForm, form: true, nav: 'work' },
  'editar-tarea': { view: (r) => viewTaskEdit(id(r)), bind: bindTaskForm, form: true, nav: 'work' },
  registrar: { view: (r) => viewRegister(r), bind: bindRegister, form: true, nav: 'add' },
  intervencion: { view: (r) => viewIntervention(id(r)), bind: loadThumbs, nav: 'log' },
  'editar-intervencion': { view: (r) => viewRegister(r, id(r)), bind: bindRegister, form: true, nav: 'log' },
  trabajos: { view: (r) => viewWork(r), bind: bindWorkFilter, nav: 'work' },
  tareas: { view: (r) => viewWork(r, 'preventivos'), bind: bindWorkFilter, nav: 'work' },
  correctivo: { view: (r) => viewIssue(id(r)), bind: loadThumbs, nav: 'work' },
  'nuevo-correctivo': { view: (r) => viewIssueForm(r), bind: bindIssueForm, form: true, nav: 'add' },
  'editar-correctivo': { view: (r) => viewIssueForm(r, id(r)), bind: bindIssueForm, form: true, nav: 'work' },
  'cerrar-correctivo': { view: (r) => viewIssueClose(id(r)), bind: bindIssueClose, form: true, nav: 'work' },
  bitacora: { view: viewLogbook, nav: 'trips' },
  navegacion: { view: (r) => viewTrip(id(r)), nav: 'trips' },
  navegar: { view: (r) => viewTripForm(r), bind: bindTripForm, form: true, nav: 'add' },
  'editar-navegacion': { view: (r) => viewTripForm(r, id(r)), bind: bindTripForm, form: true, nav: 'trips' },
  repostaje: { view: (r) => viewFuel(id(r)), nav: 'log' },
  repostar: { view: (r) => viewFuelForm(r), bind: bindFuelForm, form: true, nav: 'add' },
  'editar-repostaje': { view: (r) => viewFuelForm(r, id(r)), bind: bindFuelForm, form: true, nav: 'log' },
  historial: { view: viewHistory, bind: bindHistoryFilter, nav: 'log' },
  ajustes: { view: viewSettings, bind: bindSettings, form: true, nav: 'gear' },
};
setFormRoutes(Object.keys(ROUTES).filter((k) => ROUTES[k].form));

function bindWorkFilter(r) {
  bindAreaFilter('area-filter', (f, area) => `#/trabajos?tipo=${r.key === 'tareas' ? 'preventivos' : f.dataset.tipo}${area ? `&area=${encodeURIComponent(area)}` : ''}`, setRefocus);
}

function bindHistoryFilter() {
  bindAreaFilter('hist-area', (f, area) => `#/historial?tipo=${encodeURIComponent(f.dataset.tipo)}&anio=${encodeURIComponent(f.dataset.anio)}${area ? `&area=${encodeURIComponent(area)}` : ''}`, setRefocus);
}

// ───────────────────────── Pintar ─────────────────────────
let lastRoute = '';

function render(force) {
  const r = route();
  const key = routeFormKey(r);
  const def = (Object.hasOwn(ROUTES, key) && ROUTES[key]) || ROUTES[''];
  // Las pantallas con formulario no se repintan solas, para no perder lo que escribes.
  if (!force && def.form) return;
  forgetOtherDrafts();
  const scroll = location.hash === lastRoute ? window.scrollY : 0;
  lastRoute = location.hash;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === def.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $view.innerHTML = def.view(r);
  def.bind?.(r);
  window.scrollTo(0, scroll);
}
setRenderer(render);

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render(false);
  });
}

let currentHash = '';
function onHashChange() {
  if (isDirty() && location.hash !== currentHash) {
    document.activeElement?.blur?.();
    if (!confirm('Tienes cambios sin guardar. ¿Salir y descartarlos?')) {
      history.replaceState(null, '', currentHash || '#/');
      return;
    }
    discardDraft(currentHash);
  }
  currentHash = location.hash;
  closeViewer();
  render(true);
  const f = refocus && document.querySelector(refocus);
  refocus = null;
  (f || $view).focus({ preventScroll: true });
}

// ───────────────────────── Sincronización ─────────────────────────
const $sync = document.getElementById('sync');
let seededCloud = false;

function updateSyncBadge() {
  const s = repo.sync;
  let txt, cls;
  if (s.mode !== 'cloud') {
    txt = cloudConfigured() ? 'Solo en este dispositivo: entra en Ajustes para sincronizar' : 'Solo en este dispositivo';
    cls = 'local';
  } else if (!navigator.onLine) [txt, cls] = ['Sin conexión: se sincronizará al volver la cobertura', 'off'];
  else if (s.pending) [txt, cls] = ['Sincronizando…', 'busy'];
  else [txt, cls] = ['Sincronizado', 'ok'];
  $sync.textContent = txt;
  $sync.className = 'sync ' + cls;
}

// En la nube, las tareas por defecto solo se crean cuando el servidor ha confirmado
// lo que ya hay (si no, otro dispositivo sin sincronizar podría pisar datos).
function checkCloudSeed() {
  if (repo.sync.mode === 'cloud' && repo.sync.serverConfirmed && !seededCloud) {
    seededCloud = true;
    ensureDefaults();
  }
}

setSyncListener((mode) => {
  if (mode === 'before-cloud') { seededCloud = false; return; }
  updateSyncBadge();
  checkCloudSeed();
});

// ───────────────────────── Acciones (botones con data-action) ─────────────────────────
const ACTIONS = {
  ...formActions,
  ...photoActions,
  ...maintenanceActions,
  ...issueActions,
  ...logbookActions,
  ...settingsActions,
  skip: () => $view.focus(),
};

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  const fn = el && ACTIONS[el.dataset.action];
  if (fn) await fn(el);
}

// ───────────────────────── Service worker ─────────────────────────
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const show = () => (document.getElementById('update').hidden = false);
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

// ───────────────────────── Arranque ─────────────────────────
async function boot() {
  registerSW();
  window.addEventListener('online', updateSyncBadge);
  window.addEventListener('offline', updateSyncBadge);
  // Pide al navegador que no borre los datos de la app para liberar espacio
  navigator.storage?.persist?.().catch(() => {});

  let cloud = false;
  if (localStorage.getItem('velero.mode') === 'cloud' && cloudConfigured()) {
    try {
      const user = await currentUser();
      if (user) {
        await repo.useCloud(user);
        cloud = true;
      }
    } catch (e) {
      console.error(e);
    }
  }
  if (!cloud) {
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

boot().catch((e) => {
  console.error(e);
  $view.innerHTML = `<p class="notice">No se ha podido abrir la app: ${esc(e.message)}</p>`;
});
