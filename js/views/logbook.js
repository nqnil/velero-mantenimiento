// Bitácora de navegaciones y repostajes de combustible.

import { repo, esc, idPath, link, find, now, byDateDesc, fmtNum, fmtInput, LONG_DATE } from '../core.js';
import { todayStr, currentHours, daysBetween, tripEngineHours, tripDays, tripStats, isNum, num, parseNum, round1, round2, fmtDate, fmtMoney, fmtHours } from '../logic.js';
import { uid } from '../store.js';
import { useDraft, currentDraft, check, dateRequired, optNumber, readHours, hoursField, bindDraftForm, finishForm, confirmDelete } from '../forms.js';
import { backLink, notFound, facts, html, logRow, metaText, metaMoney, years, pickYear, yearChips, notes, formEnd, deleteButton } from '../ui.js';

// ───────────────────────── Textos ─────────────────────────
export function tripRoute(t) {
  const from = (t.from || '').trim();
  const to = (t.to || '').trim();
  if (from && to && from.toLowerCase() !== to.toLowerCase()) return `${from} – ${to}`;
  return from || to || 'Navegación';
}

function tripDateText(t) {
  if (t.endDate && t.endDate > t.date) return `Del ${fmtDate(t.date, LONG_DATE)} al ${fmtDate(t.endDate, LONG_DATE)}`;
  return fmtDate(t.date, LONG_DATE);
}

const fuelOf = (t) => (t.fuelId ? find('fuel', t.fuelId) : null);

function fuelSummary(f) {
  return [num(f.liters) && `${fmtNum(num(f.liters))} L`, num(f.total) && fmtMoney(num(f.total)), f.place].filter(Boolean).join(', ') || 'Repostaje';
}

const fuelTitle = (f) => `Combustible${num(f.liters) ? `: ${fmtNum(num(f.liters))} L` : ''}`;

export function fuelLogRow(f) {
  return logRow({
    href: idPath('repostaje', f.id),
    date: f.date,
    title: fuelTitle(f),
    meta: [metaText(f.method === 'garrafas' ? 'Garrafas' : 'Surtidor'), metaText(f.place), metaMoney(num(f.total))],
  });
}

// Precio medio del litro, solo con los repostajes que tienen litros e importe
export function pplText(list) {
  const both = list.filter((f) => num(f.liters) > 0 && num(f.total) > 0);
  const l = both.reduce((s, f) => s + num(f.liters), 0);
  return l ? `, a ${fmtMoney(both.reduce((s, f) => s + num(f.total), 0) / l)} el litro de media` : '';
}

// ───────────────────────── Bitácora ─────────────────────────
function tripRow(t) {
  const eh = tripEngineHours(t);
  const fuel = fuelOf(t);
  const days = tripDays(t);
  return logRow({
    href: idPath('navegacion', t.id),
    date: t.date,
    title: tripRoute(t),
    meta: [
      days > 1 && metaText(`${days} días`),
      num(t.miles) && metaText(`${fmtNum(num(t.miles))} mn`),
      eh !== null && metaText(`${fmtHours(eh)} de motor`),
      fuel && metaText(`${fmtNum(num(fuel.liters))} L repostados`),
    ],
  });
}

export function lastTrip() {
  return [...repo.state.trips].sort(byDateDesc)[0] || null;
}

export function viewLogbook(r) {
  const all = [...repo.state.trips].sort(byDateDesc);
  if (!all.length) {
    return `<h1>Bitácora</h1>
    <section class="notice"><p>Apunta cada salida aunque no hagas mantenimiento: de dónde a dónde, las horas del motor al salir y al volver, las millas y lo que quieras recordar. Así el contador de horas se mantiene al día solo.</p>
    <a class="btn primary" href="#/navegar">Registrar navegación</a></section>`;
  }
  const ys = years(all);
  const year = pickYear(ys, r.params.get('anio'));
  const list = year === 'todo' ? all : all.filter((t) => t.date.startsWith(year));
  const st = tripStats(list);
  return `
  <div class="titlebar"><h1>Bitácora</h1><a class="btn small" href="#/navegar">Nueva navegación</a></div>
  ${yearChips(ys, year, (y) => link('bitacora', { anio: y }))}
  <dl class="stats">
    <div><dt>Salidas</dt><dd>${st.count}</dd></div>
    <div><dt>Días de mar</dt><dd>${st.days}</dd></div>
    <div><dt>Millas</dt><dd>${fmtNum(st.miles)}</dd></div>
    <div><dt>Horas de motor</dt><dd>${fmtNum(st.engine)}</dd></div>
  </dl>
  <ul class="log">${list.map(tripRow).join('')}</ul>`;
}

export function viewTrip(id) {
  const t = find('trips', id);
  if (!t) return notFound('Esta navegación ya no existe.');
  const eh = tripEngineHours(t);
  const fuel = fuelOf(t);
  const hours = [isNum(t.hoursStart) && `al salir ${fmtHours(t.hoursStart)}`, isNum(t.hoursEnd) && `al volver ${fmtHours(t.hoursEnd)}`].filter(Boolean).join(', ');
  return `
  ${backLink('#/bitacora', 'Bitácora')}
  <article class="detail">
    <p class="muted">${tripDateText(t)}</p>
    <h1>${esc(tripRoute(t))}</h1>
    ${facts([
      t.from && ['Salida', t.from],
      t.to && ['Llegada', t.to],
      num(t.miles) && ['Millas', `${fmtNum(num(t.miles))} mn`],
      hours && ['Horas de motor', hours + (eh !== null ? ` (${fmtHours(eh)} de uso)` : '')],
      t.crew && ['Tripulación', t.crew],
      t.conditions && ['Viento y mar', t.conditions],
    ])}
    ${notes(t.notes, 'Notas')}
    ${fuel ? `<h2>Repostaje</h2><p><a href="${idPath('repostaje', fuel.id)}">${esc(fuelSummary(fuel))}</a></p>` : ''}
    <div class="actions">
      <a class="btn primary" href="${idPath('navegacion', t.id, 'editar')}">Editar</a>
      ${deleteButton('delete-trip', t.id)}
    </div>
  </article>`;
}

// ───────────────────────── Campos de combustible (navegación y repostaje) ─────────────────────────
function placesDatalist() {
  const set = new Set();
  for (const t of repo.state.trips) { if (t.from) set.add(t.from.trim()); if (t.to) set.add(t.to.trim()); }
  for (const f of repo.state.fuel) if (f.place) set.add(f.place.trim());
  const places = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
  return `<datalist id="places">${places.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

function fuelFields(f, method = 'surtidor') {
  return {
    liters: fmtInput(num(f?.liters) || null),
    total: fmtInput(num(f?.total) || null),
    place: f?.place || '',
    method: f?.method || method,
    fullTank: f ? !!f.fullTank : true,
  };
}

const pplHint = (f) => {
  const l = parseNum(f.liters), t = parseNum(f.total);
  return l > 0 && t > 0 ? `${fmtMoney(t / l)} el litro` : '';
};

function fuelFieldset(f, radioName) {
  return `<fieldset>
    <legend>Combustible</legend>
    <div class="grid2">
      <label>Litros<input type="text" data-fuel="liters" inputmode="decimal" value="${esc(f.liters)}"></label>
      <label>Importe total (€)<input type="text" data-fuel="total" inputmode="decimal" value="${esc(f.total)}"></label>
    </div>
    <p class="hint" data-ppl>${pplHint(f)}</p>
    <label>Lugar<input type="text" data-fuel="place" list="places" value="${esc(f.place)}" placeholder="Gasolinera del puerto, estación de servicio…" autocomplete="off"></label>
    <fieldset class="seg" role="radiogroup">
      <legend>Cómo</legend>
      <label><input type="radio" name="${radioName}" data-fuel="method" value="surtidor" ${f.method !== 'garrafas' ? 'checked' : ''}><span>Surtidor del puerto</span></label>
      <label><input type="radio" name="${radioName}" data-fuel="method" value="garrafas" ${f.method === 'garrafas' ? 'checked' : ''}><span>Garrafas</span></label>
    </fieldset>
    <label class="check"><input type="checkbox" data-fuel="fullTank" ${f.fullTank ? 'checked' : ''}><span>Depósito lleno <span class="muted">(sirve para calcular el consumo)</span></span></label>
  </fieldset>`;
}

// Trata un evento de los campos de combustible. Devuelve true si era suyo.
function handleFuelField(el, f) {
  const k = el.dataset.fuel;
  if (!k) return false;
  if (k === 'fullTank') f.fullTank = el.checked;
  else f[k] = el.value;
  if (k === 'liters' || k === 'total') el.closest('fieldset').querySelector('[data-ppl]').textContent = pplHint(f);
  return true;
}

function checkFuel(f) {
  const l = optNumber(f.liters, 'Los litros no son un número válido.');
  const t = optNumber(f.total, 'El importe del combustible no es válido.');
  check(l > 0 || t > 0, 'Indica al menos los litros o el importe del combustible.');
  check(!(l > 2000), 'Los litros parecen demasiados: revísalos.');
}

function fuelRecord(f) {
  return {
    liters: round2(num(f.liters)),
    total: round2(num(f.total)),
    place: f.place.trim(),
    method: f.method === 'garrafas' ? 'garrafas' : 'surtidor',
    fullTank: !!f.fullTank,
  };
}

// ───────────────────────── Registrar navegación ─────────────────────────
function newTripDraft(existing) {
  if (existing) {
    const fuel = fuelOf(existing);
    return {
      id: existing.id, isNew: false, createdAt: existing.createdAt,
      date: existing.date, endDate: existing.endDate || '',
      from: existing.from || '', to: existing.to || '',
      hoursStart: fmtInput(existing.hoursStart), hoursEnd: fmtInput(existing.hoursEnd), miles: fmtInput(existing.miles),
      crew: existing.crew || '', conditions: existing.conditions || '', notes: existing.notes || '',
      refuel: !!fuel, fuelId: fuel?.id || uid(), fuel: fuelFields(fuel),
    };
  }
  const cur = currentHours(repo.state);
  const last = lastTrip();
  return {
    id: uid(), isNew: true, date: todayStr(), endDate: '',
    from: last ? last.to || last.from || '' : '', to: '',
    hoursStart: cur ? fmtInput(cur.hours) : '', hoursEnd: '', miles: '',
    crew: '', conditions: '', notes: '',
    refuel: false, fuelId: uid(), fuel: fuelFields(null),
  };
}

export function viewTripForm(r, editId) {
  const existing = editId ? find('trips', editId) : null;
  if (editId && !existing) return notFound('Esta navegación ya no existe.');
  const d = useDraft(() => newTripDraft(existing));
  return `
  ${backLink(editId ? idPath('navegacion', editId) : '#/bitacora', 'Cancelar')}
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
      ${hoursField('hoursStart', d.hoursStart, 'Horas de motor al salir', { optional: false })}
      ${hoursField('hoursEnd', d.hoursEnd, 'Horas de motor al volver', { optional: false, placeholder: 'Contador' })}
    </div>
    <p class="hint" id="trip-engine">${tripEngineHint(d)}</p>
    <label>Millas <span class="muted">(opcional)</span><input type="text" name="miles" inputmode="decimal" value="${esc(d.miles)}"></label>
    <label>Tripulación<input type="text" name="crew" value="${esc(d.crew)}" placeholder="Quién vino"></label>
    <label>Viento y mar<input type="text" name="conditions" value="${esc(d.conditions)}" placeholder="Por ejemplo: SE 12–15 nudos, marejadilla"></label>
    <label>Notas<textarea name="notes" rows="4" placeholder="Rumbo, fondeos, incidencias, cosas a revisar…">${esc(d.notes)}</textarea></label>
    <label class="check"><input type="checkbox" name="refuel" ${d.refuel ? 'checked' : ''}><span>Repostaje en esta salida</span></label>
    <div id="trip-fuel" ${d.refuel ? '' : 'hidden'}>${fuelFieldset(d.fuel, 'trip-method')}</div>
    ${formEnd(editId ? 'Guardar cambios' : 'Guardar navegación')}
  </form>`;
}

function tripEngineHint(d) {
  const a = d.hoursStart.trim() ? parseNum(d.hoursStart) : NaN;
  const b = d.hoursEnd.trim() ? parseNum(d.hoursEnd) : NaN;
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return b < a ? 'Las horas al volver son menores que al salir: revísalas.' : `Motor en esta salida: ${fmtHours(round1(b - a))}.`;
  }
  return 'Apunta lo que marque el contador; con eso se actualizan las horas del motor.';
}

export function bindTripForm() {
  const d = currentDraft();
  bindDraftForm('trip-form', d, saveTrip, {
    fields: ['date', 'endDate', 'from', 'to', 'hoursStart', 'hoursEnd', 'miles', 'crew', 'conditions', 'notes'],
    onInput: (el) => {
      if (handleFuelField(el, d.fuel)) return true;
      if (el.name === 'hoursStart' || el.name === 'hoursEnd') {
        d[el.name] = el.value;
        document.getElementById('trip-engine').textContent = tripEngineHint(d);
        return true;
      }
      return false;
    },
    onChange: (el) => {
      if (handleFuelField(el, d.fuel)) return true;
      if (el.name !== 'refuel') return false;
      d.refuel = el.checked;
      document.getElementById('trip-fuel').hidden = !d.refuel;
      return true;
    },
  });
}

async function saveTrip(d) {
  dateRequired(d.date, 'la fecha de salida');
  if (d.endDate) {
    check(d.endDate >= d.date, 'La llegada no puede ser anterior a la salida.');
    dateRequired(d.endDate, 'la fecha de llegada');
  }
  const hs = optNumber(d.hoursStart, 'Las horas al salir no son un número válido.');
  const he = optNumber(d.hoursEnd, 'Las horas al volver no son un número válido.');
  if (hs !== null && he !== null) {
    check(he >= hs, 'Las horas al volver no pueden ser menores que al salir.');
    const days = d.endDate ? daysBetween(d.date, d.endDate) + 1 : 1;
    check(he - hs <= 24 * days, 'Hay más horas de motor que horas tiene la travesía: revisa el contador.');
  }
  const miles = optNumber(d.miles, 'Las millas no son un número válido.');
  if (d.refuel) checkFuel(d.fuel);
  const start = readHours(hs, d.date);
  if (start === undefined) return;
  const end = readHours(he, d.endDate || d.date);
  if (end === undefined) return;

  const trip = {
    id: d.id,
    date: d.date,
    endDate: d.endDate && d.endDate > d.date ? d.endDate : '',
    from: d.from.trim(),
    to: d.to.trim(),
    hoursStart: start,
    hoursEnd: end,
    miles: miles !== null ? round1(miles) : null,
    crew: d.crew.trim(),
    conditions: d.conditions.trim(),
    notes: d.notes.trim(),
    fuelId: null,
    createdAt: d.createdAt || now(),
  };
  const old = find('fuel', d.fuelId);
  if (d.refuel) {
    const last = trip.endDate || trip.date;
    await repo.put('fuel', {
      ...(old || { notes: '', createdAt: now() }),
      id: d.fuelId,
      date: old?.date && old.date >= trip.date && old.date <= last ? old.date : last,
      ...fuelRecord(d.fuel),
      engineHours: trip.hoursEnd ?? trip.hoursStart,
      tripId: trip.id,
    });
    trip.fuelId = d.fuelId;
  } else if (old) {
    await repo.del('fuel', old.id);
  }
  await repo.put('trips', trip);
  finishForm(d.isNew ? 'Navegación guardada' : 'Cambios guardados', d.isNew ? '#/bitacora' : idPath('navegacion', trip.id));
}

// ───────────────────────── Repostajes ─────────────────────────
export function viewFuel(id) {
  const f = find('fuel', id);
  if (!f) return notFound('Este repostaje ya no existe.');
  const trip = f.tripId ? find('trips', f.tripId) : null;
  const l = num(f.liters), t = num(f.total);
  return `
  ${backLink('#/historial?tipo=combustible', 'Historial')}
  <article class="detail">
    <p class="muted">${fmtDate(f.date, LONG_DATE)}</p>
    <h1>${esc(fuelTitle(f))}</h1>
    ${facts([
      ['Importe', t ? fmtMoney(t) : 'No anotado'],
      l && t && ['Precio', `${fmtMoney(t / l)} el litro`],
      ['Cómo', `${f.method === 'garrafas' ? 'Con garrafas' : 'Surtidor del puerto'}${f.fullTank ? ', depósito lleno' : ''}`],
      f.place && ['Lugar', f.place],
      isNum(f.engineHours) && ['Horas de motor', fmtHours(f.engineHours)],
      trip && ['Navegación', html(`<a href="${idPath('navegacion', trip.id)}">${fmtDate(trip.date)}, ${esc(tripRoute(trip))}</a>`)],
    ])}
    ${notes(f.notes, 'Notas')}
    <div class="actions">
      <a class="btn primary" href="${idPath('repostaje', f.id, 'editar')}">Editar</a>
      ${deleteButton('delete-fuel', f.id)}
    </div>
  </article>`;
}

export function viewFuelForm(r, editId) {
  const existing = editId ? find('fuel', editId) : null;
  if (editId && !existing) return notFound('Este repostaje ya no existe.');
  const d = useDraft(() => ({
    id: existing?.id || uid(),
    isNew: !existing,
    createdAt: existing?.createdAt,
    tripId: existing?.tripId || null,
    date: existing?.date || todayStr(),
    engineHours: fmtInput(existing?.engineHours),
    notes: existing?.notes || '',
    fuel: fuelFields(existing, 'garrafas'),
  }));
  const trip = d.tripId ? find('trips', d.tripId) : null;
  return `
  ${backLink(editId ? idPath('repostaje', editId) : '#/historial?tipo=combustible', 'Cancelar')}
  <h1>${editId ? 'Editar repostaje' : 'Registrar repostaje'}</h1>
  ${trip ? `<p class="hint">Apuntado en la navegación del ${fmtDate(trip.date)} (${esc(tripRoute(trip))}).</p>` : ''}
  <form id="fuel-form" class="form" novalidate>
    ${placesDatalist()}
    <div class="grid2">
      <label>Fecha<input type="date" name="date" value="${esc(d.date)}" max="${todayStr()}" required></label>
      ${hoursField('engineHours', d.engineHours)}
    </div>
    <div id="fuel-fields">${fuelFieldset(d.fuel, 'method')}</div>
    <label>Notas<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
    ${formEnd(editId ? 'Guardar cambios' : 'Guardar repostaje')}
  </form>`;
}

export function bindFuelForm() {
  const d = currentDraft();
  bindDraftForm('fuel-form', d, saveFuel, {
    fields: ['date', 'engineHours', 'notes'],
    onInput: (el) => handleFuelField(el, d.fuel),
    onChange: (el) => handleFuelField(el, d.fuel),
  });
}

async function saveFuel(d) {
  dateRequired(d.date);
  checkFuel(d.fuel);
  const h = readHours(d.engineHours, d.date, 'Las horas de motor no son un número válido.');
  if (h === undefined) return;
  await repo.put('fuel', {
    ...(find('fuel', d.id) || {}),
    id: d.id,
    date: d.date,
    ...fuelRecord(d.fuel),
    engineHours: h,
    tripId: d.tripId,
    notes: d.notes.trim(),
    createdAt: d.createdAt || now(),
  });
  finishForm(d.isNew ? 'Repostaje guardado' : 'Cambios guardados', d.isNew ? '#/historial?tipo=combustible' : idPath('repostaje', d.id));
}

// ───────────────────────── Acciones ─────────────────────────
export const actions = {
  'delete-trip': (el) => {
    const t = find('trips', el.dataset.id);
    return confirmDelete(t?.fuelId ? '¿Borrar esta navegación y el repostaje apuntado en ella? No se puede deshacer.' : '¿Borrar esta navegación? No se puede deshacer.', async () => {
      if (t?.fuelId) await repo.del('fuel', t.fuelId);
      await repo.del('trips', el.dataset.id);
    }, 'Navegación borrada', '#/bitacora');
  },
  'delete-fuel': (el) => confirmDelete('¿Borrar este repostaje? No se puede deshacer.', async () => {
    const f = find('fuel', el.dataset.id);
    const t = f?.tripId ? find('trips', f.tripId) : null;
    if (t) await repo.put('trips', { ...t, fuelId: null });
    await repo.del('fuel', el.dataset.id);
  }, 'Repostaje borrado', '#/historial?tipo=combustible'),
};
