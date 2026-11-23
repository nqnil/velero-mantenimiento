// Formularios: borrador en curso, validación, coste (material o factura) y fotos.

import { repo, esc, toast, go, render, ICON, route, fmtInput, deletePhotos } from './core.js';
import { todayStr, hoursAnomaly, parseNum, num, round1, round2, fmtDate, fmtHours, fmtMoney, currentHours } from './logic.js';
import { uid } from './store.js';

// ───────────────────────── Borrador ─────────────────────────
// Solo hay un formulario visible a la vez: su borrador vive aquí, ligado a la ruta (#/...).
let draft = null;
let dirty = false;
let formRoutes = new Set();
const DRAFT_PREFIX = 'velero.draft:';

export function setFormRoutes(keys) {
  formRoutes = new Set(keys);
}
export const isDirty = () => dirty;
// Borrador del formulario visible, o null si no hay (p. ej. el registro no existe)
export const currentDraft = () => (draft && draft.key === location.hash ? draft : null);

// Devuelve el borrador de la ruta actual: el que hay en memoria, el guardado (tras una
// recarga de iOS) o uno nuevo hecho con make().
export function useDraft(make) {
  const key = location.hash;
  if (!draft || draft.key !== key) {
    draft = loadStoredDraft(key) || make();
    if (draft) draft.key = key;
  }
  return draft;
}

// Al cambiar de pantalla, el borrador de otra ruta se olvida
export function forgetOtherDrafts() {
  if (draft && draft.key !== location.hash) draft = null;
}

export function markDirty(d) {
  // Eventos tardíos (p. ej. al perder el foco) de un formulario que ya se ha abandonado
  if (d ? d.key !== location.hash : !formRoutes.has(routeFormKey(route()))) return;
  dirty = true;
  if (d) storeDraft(d);
}

export function formSaved(key = location.hash) {
  dirty = false;
  dropStoredDraft(key);
  if (draft && draft.key === key) draft = null;
}

// Fin de un guardado: olvida el borrador, avisa y va a la pantalla indicada
export function finishForm(msg, href) {
  formSaved();
  toast(msg);
  go(href);
}

// Confirma, ejecuta el borrado, avisa y repinta (o navega a `href`)
export async function confirmDelete(question, fn, done, href) {
  if (!confirm(question)) return;
  await fn();
  if (done) toast(done);
  if (href) go(href); else render(true);
}

export function discardDraft(key) {
  dirty = false;
  dropStoredDraft(key);
}

function storeDraft(d) {
  clearTimeout(storeDraft.t);
  storeDraft.t = setTimeout(() => {
    const o = { ...d, taskIds: d.taskIds ? [...d.taskIds] : undefined };
    try {
      sessionStorage.setItem(DRAFT_PREFIX + d.key, JSON.stringify(o));
    } catch {
      try { // sin espacio: guardar el texto sin las fotos nuevas
        const keep = (list) => (list || []).filter((p) => p.existing);
        sessionStorage.setItem(DRAFT_PREFIX + d.key, JSON.stringify({ ...o, photos: keep(o.photos), problemPhotos: keep(o.problemPhotos) }));
        if (!storeDraft.warned) {
          storeDraft.warned = true;
          toast('Hay muchas fotos: si la app se recarga antes de guardar, habrá que volver a añadirlas.');
        }
      } catch { /* nada */ }
    }
  }, 250);
}

function loadStoredDraft(key) {
  try {
    const o = JSON.parse(sessionStorage.getItem(DRAFT_PREFIX + key) || 'null');
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.taskIds)) o.taskIds = new Set(o.taskIds);
    dirty = true;
    return o;
  } catch {
    return null;
  }
}

function dropStoredDraft(key) {
  clearTimeout(storeDraft.t); // que un guardado pendiente no lo resucite
  try { sessionStorage.removeItem(DRAFT_PREFIX + key); } catch { /* nada */ }
}

// Clave de pantalla: «registrar», «editar-intervencion», «cerrar-correctivo»…
export function routeFormKey(r) {
  const [a, b, c] = r.parts;
  if (a === 'tarea' && b === 'nueva') return 'nueva-tarea';
  if (a === 'correctivo' && b === 'nuevo') return 'nuevo-correctivo';
  if (a === 'correctivo' && c === 'cerrar') return 'cerrar-correctivo';
  if (c === 'editar') return `editar-${a}`;
  return a || '';
}

// ───────────────────────── Validación y guardado ─────────────────────────
// Un error de formulario: se muestra junto al botón de guardar.
class FormError extends Error {}
export function check(cond, msg) {
  if (!cond) throw new FormError(msg);
}

export function dateRequired(v, label = 'la fecha') {
  check(v, `Falta ${label}.`);
  check(v <= todayStr(), `${label.charAt(0).toUpperCase() + label.slice(1)} no puede ser futura.`);
  return v;
}

// '' → null; número ≥ 0 → número; otra cosa → error con el mensaje dado
export function optNumber(v, msg) {
  if (typeof v === 'number') { check(v >= 0, msg); return v; } // ya leído
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = parseNum(s);
  check(n >= 0, msg);
  return n;
}

// Evita guardar dos veces con un doble toque y muestra los FormError.
export async function guarded(form, fn) {
  if (form.dataset.busy) return;
  form.dataset.busy = '1';
  const btns = form.querySelectorAll('button[type=submit]');
  btns.forEach((b) => (b.disabled = true));
  const err = form.querySelector('.form-error');
  if (err) err.hidden = true;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof FormError)) {
      console.error(e);
      toast(`No se ha podido guardar: ${e.message || e}`);
      return;
    }
    if (err) {
      err.textContent = e.message;
      err.hidden = false;
      err.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else toast(e.message);
  } finally {
    delete form.dataset.busy;
    btns.forEach((b) => (b.disabled = false));
  }
}

// Conecta un formulario con su borrador.
//  fields: nombres de campo que se copian tal cual al borrador
//  onInput/onChange(el): tratan campos especiales; devuelven true si ya lo han hecho
//  quiet(el): eventos que no cuentan como cambio (p. ej. el buscador de tareas)
export function bindDraftForm(id, d, save, { fields = [], onInput, onChange, quiet } = {}) {
  const form = document.getElementById(id);
  if (!form || !d) return null;
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (!quiet?.(el)) markDirty(d);
    if (onInput?.(el)) return;
    if (fields.includes(el.name)) d[el.name] = el.value;
    else handleCostInput(el, d);
  });
  form.addEventListener('change', async (e) => {
    const el = e.target;
    if (quiet?.(el)) return;
    markDirty(d);
    if (await onChange?.(el)) return;
    await handleCostChange(el, d);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, () => save(d));
  });
  loadDraftPhotos(d);
  return form;
}

// Formulario sin borrador (tarea, ajustes): solo marca cambios y protege el envío
export function bindPlainForm(id, save) {
  const form = document.getElementById(id);
  if (!form) return null;
  form.addEventListener('input', () => markDirty());
  form.addEventListener('change', () => markDirty());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, () => save(form));
  });
  return form;
}

// ───────────────────────── Horas de motor ─────────────────────────
// Aviso (texto) si unas horas no encajan con las lecturas de su tramo de motor, o null.
function hoursWarning(hours, date) {
  const a = hoursAnomaly(repo.state, hours, date);
  if (!a) return null;
  const when = `la lectura del ${fmtDate(a.point.date)}`;
  if (a.kind === 'menos') return `Es menos que ${when} (${fmtHours(a.point.hours)}). Si has cambiado de motor, apúntalo en Horas de motor.`;
  if (a.kind === 'salto') return `Son ${fmtHours(a.diff)} más que ${when}: más de las que caben en ese tiempo.`;
  return `Es más que ${when.replace('la lectura', 'la lectura posterior')} (${fmtHours(a.point.hours)}).`;
}

function confirmHours(hours, date) {
  if (hours === null) return true;
  const w = hoursWarning(hours, date);
  return !w || confirm(`${w} ¿Guardar ${fmtHours(hours)} igualmente?`);
}

// Lee unas horas opcionales del borrador, las valida y pide confirmación si son raras.
// Devuelve null (vacío), el número redondeado o undefined si el usuario cancela.
export function readHours(v, date, msg = 'Las horas de motor no son válidas. Escribe solo el número, por ejemplo 1180,5.') {
  const h = optNumber(v, msg);
  const r = h === null ? null : round1(h);
  return confirmHours(r, date) ? r : undefined;
}

export function hoursField(name, value, label = 'Horas de motor', { optional = true, placeholder } = {}) {
  const cur = currentHours(repo.state);
  const ph = placeholder ?? (cur ? `Última: ${cur.hours.toLocaleString('es-ES')}` : 'Si las sabes');
  return `<label>${esc(label)}${optional ? ' <span class="muted">(opcional)</span>' : ''}<input type="text" name="${esc(name)}" inputmode="decimal" value="${esc(value)}" placeholder="${esc(ph)}"></label>`;
}

// ───────────────────────── Coste: material o factura ─────────────────────────
// Campos del borrador a partir de un registro con coste (intervención o correctivo hecho)
export function costDraft(rec) {
  const shop = rec?.doneBy === 'taller';
  const mats = !shop && (rec?.materials || []).length
    ? rec.materials.map((m) => ({ desc: m.desc, cost: fmtInput(num(m.cost)) }))
    : [{ desc: '', cost: '' }];
  return {
    doneBy: shop ? 'taller' : 'yo',
    materials: mats,
    workshop: shop ? rec.workshop || '' : '',
    invoiceTotal: shop ? fmtInput(rec.invoiceTotal) : '',
    // Se cargan siempre: si no es de taller y tuviera fotos, savePhotos las borra
    photos: (rec?.photoIds || []).map((id) => ({ id, existing: true })),
    removedPhotos: [],
  };
}

export function doneBySeg(d) {
  return `<fieldset class="seg" role="radiogroup">
    <legend>¿Quién lo hizo?</legend>
    <label><input type="radio" name="doneBy" value="yo" ${d.doneBy !== 'taller' ? 'checked' : ''}><span>Yo</span></label>
    <label><input type="radio" name="doneBy" value="taller" ${d.doneBy === 'taller' ? 'checked' : ''}><span>Taller o profesional</span></label>
  </fieldset>
  <div id="cost-block">${costBlock(d)}</div>`;
}

function costBlock(d) {
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
  return `<fieldset><legend>Material</legend>
    <div id="materials">${d.materials.map((m, idx) => `
      <div class="matrow">
        <input type="text" data-mat="${idx}" data-k="desc" value="${esc(m.desc)}" placeholder="Material o pieza" aria-label="Material ${idx + 1}">
        <input type="text" data-mat="${idx}" data-k="cost" inputmode="decimal" value="${esc(m.cost)}" placeholder="€" aria-label="Coste ${idx + 1}">
        <button type="button" class="icon" data-action="del-mat" data-idx="${idx}" aria-label="Quitar línea">${ICON.trash}</button>
      </div>`).join('')}</div>
    <div class="matfoot"><button type="button" class="btn small" data-action="add-mat">Añadir línea</button>
    <span>Total: <strong class="money" id="mat-total">${fmtMoney(materialsTotal(d))}</strong></span></div>
  </fieldset>`;
}

const materialsTotal = (d) => d.materials.reduce((s, m) => s + num(m.cost), 0);

export function costError(d) {
  if (d.doneBy === 'taller') {
    check(!d.invoiceTotal.trim() || parseNum(d.invoiceTotal) >= 0, 'El total de la factura no es un importe válido.');
  } else {
    check(!d.materials.some((m) => String(m.cost).trim() && !(parseNum(m.cost) >= 0)), 'Algún coste de material no es un importe válido.');
  }
}

// Campos de coste para guardar en el registro
export function costRecord(d) {
  const shop = d.doneBy === 'taller';
  return {
    doneBy: shop ? 'taller' : 'yo',
    materials: shop ? [] : d.materials.filter((m) => m.desc.trim() || num(m.cost)).map((m) => ({ desc: m.desc.trim(), cost: round2(num(m.cost)) })),
    workshop: shop ? d.workshop.trim() : '',
    invoiceTotal: shop ? round2(num(d.invoiceTotal)) : null,
    photoIds: shop ? d.photos.map((p) => p.id) : [],
  };
}

// Guarda las fotos nuevas del borrador y borra las quitadas. Las de factura
// solo cuentan si lo hizo un taller; si no, se borran.
export async function savePhotos(d, ownerId) {
  const put = (p) => repo.putPhoto({ id: p.id, data: p.data, mime: p.mime, name: p.name || '', interventionId: ownerId });
  for (const p of d.problemPhotos || []) if (!p.existing) await put(p);
  for (const p of d.photos || []) {
    if (d.doneBy === 'taller') { if (!p.existing) await put(p); }
    else if (p.existing) await repo.delPhoto(p.id);
  }
  await deletePhotos(d.removedPhotos);
}

// ───────────────────────── Fotos del borrador ─────────────────────────
// list: 'photos' (factura) o 'problemPhotos' (fotos de la avería)
const PHOTO_BOX = { photos: 'draft-photos', problemPhotos: 'problem-photos' };

export function draftPhotos(d, list = 'photos') {
  const alt = list === 'photos' ? 'Factura' : 'Foto';
  return (d[list] || []).map((p, idx) => `
    <div class="thumb" data-ph="${idx}">
      ${p.data ? (p.mime === 'application/pdf' ? `<span class="pdf">PDF<br>${esc(p.name || '')}</span>` : `<img src="${esc(p.data)}" alt="${alt} ${idx + 1}">`) : '<span class="ph-loading">Cargando…</span>'}
      <button type="button" class="icon del" data-action="del-photo" data-list="${list}" data-idx="${idx}" aria-label="Quitar foto">${ICON.trash}</button>
    </div>`).join('');
}

function refreshPhotos(d, list) {
  const el = document.getElementById(PHOTO_BOX[list]);
  if (el) el.innerHTML = draftPhotos(d, list);
}

async function loadDraftPhotos(d) {
  for (const list of Object.keys(PHOTO_BOX)) {
    let changed = false;
    for (const p of d[list] || []) {
      if (p.existing && !p.data) {
        const ph = await repo.getPhoto(p.id);
        if (ph) { Object.assign(p, { data: ph.data, mime: ph.mime, name: ph.name }); changed = true; }
      }
    }
    if (changed) refreshPhotos(d, list);
  }
}

// Campos comunes de coste. Devuelven true si han tratado el evento.
function handleCostInput(el, d) {
  if (el.dataset.f) { d[el.dataset.f] = el.value; return true; }
  if (el.dataset.mat !== undefined) {
    d.materials[+el.dataset.mat][el.dataset.k] = el.value;
    const tot = document.getElementById('mat-total');
    if (tot) tot.textContent = fmtMoney(materialsTotal(d));
    return true;
  }
  return false;
}

function refreshCost(d) {
  document.getElementById('cost-block').innerHTML = costBlock(d);
}

async function handleCostChange(el, d) {
  if (el.name === 'doneBy') {
    d.doneBy = el.value;
    if (d.doneBy !== 'taller' && !d.materials.length) d.materials.push({ desc: '', cost: '' });
    refreshCost(d);
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
  refreshPhotos(d, list);
  markDirty(d); // vuelve a guardar el borrador, ya con las fotos
  return true;
}

// Acciones de los botones del bloque de coste y fotos
export const formActions = {
  'add-mat': () => {
    if (!currentDraft()) return;
    draft.materials.push({ desc: '', cost: '' });
    markDirty(draft);
    refreshCost(draft);
    const inputs = document.querySelectorAll('[data-k="desc"]');
    inputs[inputs.length - 1]?.focus();
  },
  'del-mat': (el) => {
    if (!currentDraft()) return;
    draft.materials.splice(+el.dataset.idx, 1);
    if (!draft.materials.length) draft.materials.push({ desc: '', cost: '' });
    markDirty(draft);
    refreshCost(draft);
  },
  'del-photo': (el) => {
    if (!currentDraft()) return;
    const list = el.dataset.list === 'problemPhotos' ? 'problemPhotos' : 'photos';
    const [p] = draft[list].splice(+el.dataset.idx, 1);
    if (p?.existing) draft.removedPhotos.push(p.id);
    markDirty(draft);
    refreshPhotos(draft, list);
  },
};

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
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
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

// ───────────────────────── Ver fotos guardadas ─────────────────────────
const photoCache = new Map();

export async function loadThumbs() {
  for (const b of document.querySelectorAll('[data-photos] .thumb')) {
    const p = await repo.getPhoto(b.dataset.id);
    if (!b.isConnected) return;
    if (!p) { b.innerHTML = `<span class="ph-loading">${navigator.onLine ? 'No disponible' : 'No disponible sin conexión'}</span>`; continue; }
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
      b.innerHTML = `<img src="${esc(p.data)}" alt="${esc(b.getAttribute('aria-label') || 'Foto')}">`;
    }
  }
}

function pdfUrl(data) {
  const bin = atob(data.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export function closeViewer() {
  document.getElementById('viewer')?.remove();
}

export const photoActions = {
  'open-photo': async (el) => {
    const p = photoCache.get(el.dataset.id) || (await repo.getPhoto(el.dataset.id));
    if (!p) return;
    closeViewer();
    const v = document.createElement('div');
    v.id = 'viewer';
    v.className = 'viewer';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', 'Foto');
    v.innerHTML = `<button class="btn" data-action="close-viewer">Cerrar</button><img src="${esc(p.data)}" alt="Foto">`;
    document.body.appendChild(v);
    v.querySelector('button').focus();
  },
  'close-viewer': closeViewer,
};
