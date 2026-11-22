// Piezas de HTML que se repiten en varias pantallas.

import { esc, ICON, fmtNum } from './core.js';
import { num, fmtDate, fmtMoney } from './logic.js';

export function backLink(href, label) {
  return `<a class="back" href="${esc(href)}">${ICON.back}<span>${esc(label)}</span></a>`;
}

export function notFound(msg) {
  return `${backLink('#/', 'Estado')}<p class="notice">${esc(msg)}</p>`;
}

// Lista de datos: pares [etiqueta, valor]. El valor es texto, salvo que se marque como HTML ya escapado.
export const html = (s) => ({ html: s });
export function facts(pairs) {
  const items = pairs.filter(Boolean);
  if (!items.length) return '';
  return `<dl class="facts">${items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v && v.html !== undefined ? v.html : esc(v)}</dd>`).join('')}</dl>`;
}

// Fila de lista con banderín de estado (tareas, correctivos)
export function row({ href, cls, title, sub, due = '', dueHTML = '' }) {
  return `<li><a class="row ${esc(cls)}" href="${esc(href)}">
    <span class="flag" aria-hidden="true"></span>
    <span class="row-main">
      <span class="row-title">${esc(title)}</span>
      ${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}
    </span>
    ${due || dueHTML ? `<span class="row-due">${dueHTML || esc(due)}</span>` : ''}
  </a></li>`;
}

// Fila de historial: fecha, título y datos sueltos (ya en HTML)
export function logRow({ href, date, title, meta = [] }) {
  return `<li><a class="logrow" href="${esc(href)}">
    <time datetime="${esc(date)}">${fmtDate(date)}</time>
    <span class="log-title">${esc(title)}</span>
    <span class="log-meta">${meta.filter(Boolean).join('')}</span>
  </a></li>`;
}

export const metaText = (s) => (s ? `<span>${esc(s)}</span>` : '');
export const metaMoney = (n) => (n ? `<span class="money">${fmtMoney(n)}</span>` : '');
export const metaPhotos = (n) => (n ? `<span class="pic">${ICON.cam}${n}</span>` : '');

// Chips de filtro: items [{id, name}], href(id) devuelve el enlace
export function chips(label, items, current, href) {
  return `<nav class="chips" aria-label="${esc(label)}">
    ${items.map((it) => `<a href="${esc(href(it.id))}" ${it.id === current ? 'aria-current="true"' : ''}>${esc(it.name)}</a>`).join('')}
  </nav>`;
}

// Años presentes en una lista (más reciente primero) y el año elegido válido
export function years(list, dateOf = (x) => x.date) {
  return [...new Set(list.map((x) => (dateOf(x) || '').slice(0, 4)).filter(Boolean))].sort().reverse();
}
export function pickYear(ys, param) {
  return param === 'todo' || ys.includes(param) ? param : ys[0] || '';
}
export function yearChips(ys, current, href) {
  return chips('Año', [...ys.map((y) => ({ id: y, name: y })), { id: 'todo', name: 'Todos los años' }], current, href);
}
export const inYear = (date, year) => year === 'todo' || (date || '').startsWith(year);

export function materialsTable(list) {
  if (!(list || []).length) return '';
  return `<table class="mat"><tbody>${list.map((m) => `<tr><td>${esc(m.desc)}</td><td class="money">${fmtMoney(num(m.cost))}</td></tr>`).join('')}</tbody></table>`;
}

// Miniaturas que se cargan después de pintar (ver loadThumbs)
export function thumbs(ids, label = 'Abrir foto') {
  if (!(ids || []).length) return '';
  return `<div class="thumbs" data-photos>${ids.map((p) => `<button class="thumb" data-action="open-photo" data-id="${esc(p)}" aria-label="${esc(label)}"><span class="ph-loading">Cargando…</span></button>`).join('')}</div>`;
}

export function notes(text, title = '') {
  return text ? `${title ? `<h2>${esc(title)}</h2>` : ''}<p class="note pre">${esc(text)}</p>` : '';
}

export function formEnd(label) {
  return `<p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions sticky"><button class="btn primary" type="submit">${esc(label)}</button></div>`;
}

export function deleteButton(action, id, label = 'Borrar') {
  return `<button class="btn danger" data-action="${esc(action)}" data-id="${esc(id)}">${esc(label)}</button>`;
}

export function bars(rows, label, fuelKey = 'combustible') {
  if (rows.length < 2) return '';
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return `<ul class="bars">${rows.map(([k, v]) => `
    <li><span class="bar-label">${esc(label(k))}</span>
    <span class="bar"><span class="${k === fuelKey ? 'fuelbar' : ''}" style="width:${Math.max(2, (v / max) * 100)}%"></span></span>
    <span class="money">${fmtMoney(v)}</span></li>`).join('')}</ul>`;
}

export const plural = (n, one, many) => `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
