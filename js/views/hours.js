// Horas de motor: lecturas del contador y cambios de motor (horas a cero).

import { repo, esc, toast, render, idPath, now, settings, saveSettings, ICON, find } from '../core.js';
import { todayStr, hourPoints, engineChanges, epochAt, currentHours, usageRate, fmtDate, fmtHours } from '../logic.js';
import { uid } from '../store.js';
import { check, dateRequired, optNumber, readHours, bindPlainForm, guarded, finishForm, confirmDelete } from '../forms.js';
import { backLink, formEnd } from '../ui.js';
import { interventionTitle } from './maintenance.js';
import { tripRoute } from './logbook.js';
import { syncBoatEntry } from '../data.js';

// Qué es cada punto de horas y adónde lleva
function describe(p) {
  const r = p.rec;
  switch (p.src) {
    case 'readings':
      return r.kind === 'motor'
        ? { title: `Cambio de motor${r.engine ? `: ${r.engine}` : ''}. Empieza en ${fmtHours(r.hours)}`, action: 'delete-engine-change', change: true }
        : { title: 'Lectura', action: 'delete-reading' };
    case 'interventions': return { title: interventionTitle(r), href: idPath('intervencion', r.id) };
    case 'trips': return { title: `${p.o ? 'Llegada' : 'Salida'}: ${tripRoute(r)}`, href: idPath('navegacion', r.id) };
    case 'issues': return { title: `Correctivo: ${r.title}`, href: idPath('correctivo', r.id) };
    default: return { title: 'Repostaje', href: idPath('repostaje', r.id) };
  }
}

export function viewHours() {
  // Los repostajes de una navegación repiten las horas de su llegada
  const pts = hourPoints(repo.state).filter((p) => !(p.src === 'fuel' && p.rec.tripId)).reverse();
  const rate = usageRate(repo.state);
  const changes = engineChanges(repo.state);
  return `
  ${backLink('#/', 'Estado')}
  <h1>Horas de motor</h1>
  <p class="muted">${rate ? `Uso medio: unas ${Math.round(rate * 30.44)} h al mes. Con este ritmo se estiman las fechas de las tareas por horas.` : 'Con al menos dos lecturas separadas unas semanas, la app estimará en qué fecha te tocará cada tarea por horas.'}</p>
  ${changes.length ? `<p class="hint">Motor actual desde el ${fmtDate(changes[changes.length - 1].date)}. Las lecturas anteriores son del motor anterior.</p>` : ''}
  <form class="form inline" id="reading-form">
    <label>Fecha<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label>
    <label>Horas<input type="text" name="hours" inputmode="decimal" required></label>
    <button class="btn primary" type="submit">Anotar</button>
  </form>
  <p><a class="btn" href="#/motor/nuevo">Cambio de motor: poner las horas a cero</a></p>
  ${pts.length ? `<ul class="log">${pts.map((p) => {
    const d = describe(p);
    return `<li class="logrow static${d.change ? ' change' : ''}">
      <time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>
      <span class="log-title">${fmtHours(p.hours)}</span>
      <span class="log-meta">${d.action
        ? `<span>${esc(d.title)}</span><button class="icon" data-action="${d.action}" data-id="${esc(p.rec.id)}" aria-label="Borrar">${ICON.trash}</button>`
        : `<a href="${esc(d.href)}">${esc(d.title)}</a>`}</span>
    </li>`;
  }).join('')}</ul>` : '<p class="muted">Aún no hay lecturas.</p>'}`;
}

// Formulario de lectura (Estado y Horas). Sin campo de fecha, es de hoy.
export function bindReadingForm(id, after) {
  const form = document.getElementById(id);
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(form, async () => {
      const date = form.date ? dateRequired(form.date.value) : todayStr();
      const v = optNumber(form.hours.value, 'Escribe las horas con números, por ejemplo 1180,5');
      check(v !== null, 'Escribe las horas con números, por ejemplo 1180,5');
      const h = readHours(v, date);
      if (h === undefined) return;
      await repo.put('readings', { id: uid(), date, hours: h, createdAt: now() });
      toast(`Anotadas ${fmtHours(h)}`);
      after?.();
    });
  });
}

export const bindHours = () => bindReadingForm('reading-form', () => render(true));

// ───────────────────────── Cambio de motor ─────────────────────────
export function viewEngineChange() {
  const cur = currentHours(repo.state);
  return `
  ${backLink('#/horas', 'Cancelar')}
  <h1>Cambio de motor</h1>
  <p>Pon el contador de horas a cero (o a las horas que traiga) cuando cambies el motor. Las lecturas anteriores se quedan en el historial como del motor anterior, y las tareas que van por horas empiezan a contar desde el cambio.</p>
  <form id="engine-form" class="form" novalidate>
    <label>Fecha del cambio<input type="date" name="date" value="${todayStr()}" max="${todayStr()}" required></label>
    <label>Horas finales del motor anterior <span class="muted">(opcional)</span><input type="text" name="oldHours" inputmode="decimal" placeholder="${cur ? esc(`Última: ${cur.hours.toLocaleString('es-ES')}`) : ''}"></label>
    <label>Motor nuevo<input type="text" name="engine" value="" placeholder="${esc(settings().engine || 'Marca y modelo')}"></label>
    <label>Horas con las que empieza<input type="text" name="startHours" inputmode="decimal" value="0"></label>
    <p class="hint">Si el motor nuevo es usado o el contador no está a cero, pon lo que marque.</p>
    ${formEnd('Guardar cambio de motor')}
  </form>`;
}

async function saveEngineChange(form) {
  const date = dateRequired(form.date.value, 'la fecha del cambio');
  const changes = engineChanges(repo.state);
  const prev = changes[changes.length - 1];
  check(!prev || date >= prev.date, `Ya hay un cambio de motor posterior (${fmtDate(prev?.date)}).`);
  const oldHours = optNumber(form.oldHours.value, 'Las horas del motor anterior no son válidas.');
  const start = optNumber(form.startHours.value, 'Las horas con las que empieza no son válidas.') ?? 0;
  const engine = form.engine.value.trim();
  // Lo apuntado después de esa fecha pasará a contar como del motor nuevo
  const epoch = epochAt(changes, date);
  const later = hourPoints(repo.state).filter((p) => p.epoch === epoch && p.date > date).length;
  if (later && !confirm(`Hay ${later} ${later === 1 ? 'apunte' : 'apuntes'} con horas posteriores a esa fecha: pasarán a contar como del motor nuevo. ¿Seguir?`)) return;
  if (!confirm(`¿Poner el contador a ${fmtHours(start)} desde el ${fmtDate(date)}?`)) return;
  if (oldHours !== null) {
    const h = readHours(oldHours, date);
    if (h === undefined) return;
    await repo.put('readings', { id: uid(), date, hours: h, createdAt: now() });
  }
  // Un instante después, para que la lectura final quede en el motor anterior
  await repo.put('readings', { id: uid(), kind: 'motor', date, hours: start, engine, createdAt: new Date(Date.now() + 5).toISOString() });
  if (engine) {
    await saveSettings({ engine });
    await syncBoatEntry();
  }
  finishForm('Cambio de motor guardado', '#/horas');
}

export const bindEngineChange = () => bindPlainForm('engine-form', saveEngineChange);

// ───────────────────────── Acciones ─────────────────────────
export const actions = {
  'delete-reading': (el) => confirmDelete('¿Borrar esta lectura?', () => repo.del('readings', el.dataset.id)),
  'delete-engine-change': (el) => {
    const r = find('readings', el.dataset.id);
    return r && confirmDelete(`¿Borrar el cambio de motor del ${fmtDate(r.date)}? Las horas posteriores volverán a contarse como del motor anterior.`,
      () => repo.del('readings', r.id), 'Cambio de motor borrado');
  },
};
