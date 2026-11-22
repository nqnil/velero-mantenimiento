// Núcleo compartido: datos, ajustes, navegación, textos y pequeñas utilidades de formato.

import { DEFAULT_SETTINGS, AREAS, PRIORITIES } from './tasks-default.js';
import { isNum, fmtDate, fmtHours } from './logic.js';
import { Repo } from './store.js';

export const APP_VERSION = '1.4.0';
export const repo = new Repo();
export const $view = document.getElementById('view');

// Fecha «muy antigua» para lo que crea la app sola (tareas por defecto, ajustes iniciales):
// así cualquier dato tuyo, de una copia o de otro dispositivo, gana al fusionar.
export const EPOCH = '1970-01-01T00:00:00.000Z';

// ── Datos ──────────────────────────────────────────────────────────────
export const find = (col, id) => repo.state[col].find((x) => x.id === id);
export const taskById = (id) => find('tasks', id);
export const issueById = (id) => find('issues', id);
export const now = () => new Date().toISOString();

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(find('meta', 'settings') || {}) };
}

export function saveSettings(patch, opts) {
  const cur = find('meta', 'settings') || { id: 'settings' };
  return repo.put('meta', { ...cur, ...patch, id: 'settings' }, opts);
}

export async function deletePhotos(ids) {
  for (const id of ids || []) await repo.delPhoto(id);
}

// ── Navegación ─────────────────────────────────────────────────────────
let renderer = () => {};
export function setRenderer(fn) {
  renderer = fn;
}
export function render(force = true) {
  renderer(force);
}

export function go(hash) {
  if (location.hash === hash) render(true);
  else location.hash = hash;
}

export function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(query || ''), key: parts[0] || '' };
}

// Construye «#/ruta?a=1&b=2» omitiendo parámetros vacíos
export function link(path, params = {}) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `#/${path}${q ? `?${q}` : ''}`;
}

export const idPath = (base, id, suffix = '') => `#/${base}/${encodeURIComponent(id)}${suffix ? `/${suffix}` : ''}`;

// ── Interfaz mínima ────────────────────────────────────────────────────
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), Math.min(9000, 2200 + msg.length * 45));
}

export const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

// ── Áreas y prioridades ────────────────────────────────────────────────
export function areaName(id) {
  if (id === 'combustible') return 'Combustible';
  if (id === 'varios') return 'Varias áreas';
  return (AREAS.find((a) => a.id === id) || { name: 'Otros' }).name;
}
export const validArea = (id) => AREAS.some((a) => a.id === id);
export const priority = (id) => PRIORITIES.find((p) => p.id === id) || PRIORITIES[2];
export const PRIO_CLASS = { urgente: 'p-urgente', alta: 'p-alta', media: 'p-media', baja: 'p-baja' };

export function areaSelect(name, value, { all = false, extra = [], placeholder = '' } = {}) {
  const opts = [...(all ? [{ id: '', name: 'Todas las áreas' }] : []), ...AREAS, ...extra];
  return `<select name="${esc(name)}"${placeholder ? ' required' : ''}>
    ${placeholder ? `<option value="" ${value ? '' : 'selected'} disabled>${esc(placeholder)}</option>` : ''}
    ${opts.map((a) => `<option value="${esc(a.id)}" ${a.id === value ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
  </select>`;
}

// ── Textos de tareas ───────────────────────────────────────────────────
export const STATUS_LABEL = {
  overdue: 'Vencida',
  soon: 'Pronto',
  ok: 'Al día',
  nohistory: 'Sin historial',
  inactive: 'Desactivada',
};

function monthsText(m) {
  if (m % 12 === 0) return m === 12 ? '1 año' : `${m / 12} años`;
  return m === 1 ? '1 mes' : `${m} meses`;
}

export function intervalText(t) {
  const p = [];
  if (isNum(t.intervalHours)) p.push(`${t.intervalHours} h`);
  if (isNum(t.intervalMonths)) p.push(monthsText(t.intervalMonths));
  if (t.type === 'caducidad') {
    return p.length ? `Por fecha de caducidad (si no la anotas: ${p.join(' o ')})` : 'Por fecha de caducidad';
  }
  return p.length ? `Cada ${p.join(' o ')}` : 'Sin intervalo';
}

export function relDays(d) {
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  return d > 0 ? `en ${d} días` : `hace ${-d} días`;
}

export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SHORT_DATE = { day: 'numeric', month: 'short' };
export const LONG_DATE = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

export function dueText(s) {
  if (s.status === 'nohistory') return 'Sin registro';
  if (s.status === 'inactive') return 'Desactivada';
  if (s.noDate) return s.task.type === 'caducidad' ? 'Falta la fecha de caducidad' : 'Faltan datos para calcularla';
  const parts = [];
  if (s.hoursLeft !== null) {
    if (s.hoursLeft <= 0) parts.push(`pasada ${fmtHours(-s.hoursLeft)}`);
    else parts.push(`faltan ${fmtHours(s.hoursLeft)}${s.estDateFromHours ? ` (≈ ${fmtDate(s.estDateFromHours, SHORT_DATE)})` : ''}`);
  }
  if (s.dueDate) {
    if (s.daysLeft < 0) parts.push(`venció el ${fmtDate(s.dueDate)}`);
    else if (s.daysLeft <= 60) parts.push(`${relDays(s.daysLeft)}, ${fmtDate(s.dueDate, SHORT_DATE)}`);
    else parts.push(fmtDate(s.dueDate));
  }
  if (!parts.length && s.missingHours) return 'Faltan las horas del último registro';
  return capitalize(parts.join(' o '));
}

// ── Formato ────────────────────────────────────────────────────────────
export function fmtNum(n, dec = 1) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec }).format(n || 0);
}

// Número para un campo de texto: «1180,5»
export function fmtInput(n) {
  return isNum(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : '';
}

// Orden de más reciente a más antiguo por un campo de fecha (y, a igual fecha, por alta)
export const byDesc = (k = 'date') => (a, b) =>
  (a[k] || '') < (b[k] || '') ? 1 : (a[k] || '') > (b[k] || '') ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '');
export const byDateDesc = byDesc('date');

export const doneByText = (r, me = 'Yo mismo') => (r.doneBy === 'taller' ? r.workshop || 'Taller' : me);
