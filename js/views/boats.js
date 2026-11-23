// Varios barcos: lista, cambiar de barco, alta y borrado.

import { AREAS_VERSION } from '../tasks-default.js';
import { repo, esc, toast, go, render, boats, switchBoat, settings, saveSettings, now } from '../core.js';
import { BOATS, uid } from '../store.js';
import { check, bindPlainForm, finishForm } from '../forms.js';
import { backLink, formEnd } from '../ui.js';
import { ensureDefaults } from '../data.js';

const TEMPLATES = [
  { id: 'tipica', name: 'Lista típica de un velero', hint: 'Las ~70 tareas de motor, jarcia, casco, seguridad… Luego desactivas lo que no lleve.' },
  { id: 'copiar', name: 'Copiar las tareas de este barco', hint: 'Con tus intervalos y tareas propias, sin su historial.' },
  { id: 'vacia', name: 'Sin tareas', hint: 'Las creas tú desde Trabajos → Preventivos.' },
];

export function viewBoats() {
  const list = boats();
  return `
  ${backLink('#/', 'Estado')}
  <div class="titlebar"><h1>Barcos</h1><a class="btn small primary" href="#/barco/nuevo">Añadir barco</a></div>
  <p class="muted">Cada barco tiene sus propias tareas, horas de motor, bitácora y gastos. Elige con cuál trabajar.</p>
  <ul class="choices">${list.map((b) => {
    const cur = b.id === repo.boatId;
    return `<li class="boat${cur ? ' current' : ''}">
      <button type="button" data-action="select-boat" data-id="${esc(b.id)}" ${cur ? 'aria-current="true"' : ''}>
        <strong>${esc(b.name)}</strong>
        <span>${esc([b.model, b.engine].filter(Boolean).join('. '))}${cur ? `${b.model || b.engine ? ' ' : ''}(abierto)` : ''}</span>
      </button>
      ${!cur && list.length > 1 ? `<button type="button" class="btn small danger" data-action="delete-boat" data-id="${esc(b.id)}">Borrar</button>` : ''}
    </li>`;
  }).join('')}</ul>
  <p class="hint">Para cambiar el nombre, el modelo o el motor del barco abierto, ve a Ajustes.</p>`;
}

export function viewBoatForm() {
  return `
  ${backLink('#/barcos', 'Cancelar')}
  <h1>Añadir barco</h1>
  <form id="boat-form" class="form" novalidate>
    <label>Nombre<input type="text" name="name" maxlength="100" required placeholder="Nombre del barco"></label>
    <label>Modelo <span class="muted">(opcional)</span><input type="text" name="model" placeholder="Astillero, modelo y año"></label>
    <label>Motor <span class="muted">(opcional)</span><input type="text" name="engine" placeholder="Marca, modelo y transmisión"></label>
    <fieldset>
      <legend>Tareas de mantenimiento preventivo</legend>
      ${TEMPLATES.map((t, i) => `<label class="check"><input type="radio" name="template" value="${t.id}" ${i === 0 ? 'checked' : ''}><span><strong>${esc(t.name)}</strong><br><span class="muted">${esc(t.hint)}</span></span></label>`).join('')}
    </fieldset>
    ${formEnd('Añadir y abrir este barco')}
  </form>`;
}

async function saveBoat(form) {
  const name = form.name.value.trim();
  check(name, 'Escribe el nombre del barco.');
  check(!boats().some((b) => b.name.toLowerCase() === name.toLowerCase()), 'Ya tienes un barco con ese nombre.');
  const template = form.template.value;
  const model = form.model.value.trim();
  const engine = form.engine.value.trim();
  // Lo que se copia se toma antes de cambiar de barco: tareas, avisos y tareas del catálogo borradas
  const src = settings();
  const copy = template === 'copiar' ? repo.state.tasks.map((t) => ({ ...t })) : [];
  const extra = template === 'copiar' ? { deletedDefaults: src.deletedDefaults || [], noticeHours: src.noticeHours, noticeDays: src.noticeDays } : {};
  const id = uid();
  await repo.put(BOATS, { id, name, model, engine, deleted: false, createdAt: now() });
  await switchBoat(id);
  await saveSettings({ boatName: name, boatModel: model, engine, seedDefaults: template !== 'vacia', areasVersion: AREAS_VERSION, ...extra });
  for (const t of copy) await repo.put('tasks', t, { touch: false });
  // Un barco recién creado no tiene datos en ningún otro sitio: se siembra ya, también sin conexión
  if (template === 'tipica') await ensureDefaults();
  finishForm(`Barco «${name}» añadido`, '#/');
}

export const bindBoatForm = () => bindPlainForm('boat-form', saveBoat);

export const actions = {
  'select-boat': async (el) => {
    if (el.dataset.id === repo.boatId) { go('#/'); return; }
    await switchBoat(el.dataset.id);
    toast(`Abierto: ${boats().find((b) => b.id === el.dataset.id)?.name || ''}`);
    go('#/');
  },
  'delete-boat': async (el) => {
    const b = boats().find((x) => x.id === el.dataset.id);
    if (!b || b.id === repo.boatId) return;
    // En la nube hace falta conexión: sin ella solo se borraría lo que este dispositivo tiene guardado
    if (repo.sync.mode === 'cloud' && !navigator.onLine) { toast('Necesitas conexión para borrar un barco.'); return; }
    if (!confirm(`¿Borrar «${b.name}» con todas sus tareas, intervenciones, navegaciones, gastos y fotos? No se puede deshacer.`)) return;
    const typed = prompt(`Para confirmar, escribe el nombre del barco: ${b.name}`);
    if (typed === null) { toast('Cancelado.'); return; }
    if (typed.trim().toLowerCase() !== b.name.toLowerCase()) { toast('No se ha borrado: el nombre no coincide.'); return; }
    try {
      // Se deja una marca de borrado para que los demás dispositivos lo quiten también
      await repo.put(BOATS, { ...(repo.state[BOATS].find((x) => x.id === b.id) || { id: b.id, createdAt: now() }), name: b.name, deleted: true });
      await repo.clearBoat(b.id);
      toast(`«${b.name}» borrado`);
    } catch (e) {
      console.error(e);
      toast(`No se ha podido borrar del todo: ${e.message || e}. Vuelve a intentarlo con conexión.`);
    }
    render(true);
  },
};

