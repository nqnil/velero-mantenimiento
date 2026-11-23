// Mantenimiento preventivo: tareas, intervenciones y horas de motor.

import { AREAS } from '../tasks-default.js';
import {
  repo, esc, toast, go, route, idPath, settings, saveSettings, taskById, find, now, deletePhotos, byDateDesc,
  areaName, validArea, areaSelect, intervalText, relDays, dueText, STATUS_LABEL, LONG_DATE, fmtInput, doneByText,
} from '../core.js';
import {
  todayStr, taskStatus, interventionCost, isNum, fmtDate, fmtMoney, fmtHours,
} from '../logic.js';
import { uid } from '../store.js';
import {
  useDraft, currentDraft, markDirty, formSaved, finishForm, confirmDelete, check, dateRequired, readHours, hoursField, bindDraftForm, bindPlainForm, costDraft, doneBySeg, costError, costRecord, savePhotos, optNumber,
} from '../forms.js';
import {
  backLink, notFound, facts, row, logRow, metaText, metaMoney, metaPhotos, materialsTable, thumbs, notes,
  formEnd, deleteButton,
} from '../ui.js';

// ───────────────────────── Textos de intervenciones ─────────────────────────
const taskNames = (i) => (i.taskIds || []).map((id) => taskById(id)?.name).filter(Boolean);

export function interventionTitle(i) {
  const names = taskNames(i);
  if (i.title) return names.length ? `${i.title}: ${names.join(', ')}` : i.title;
  return names.join(', ') || 'Intervención';
}

// Áreas de las tareas de una intervención («otros» si no tiene ninguna)
export function interventionAreas(i) {
  const set = new Set((i.taskIds || []).map((id) => taskById(id)?.system).filter(Boolean));
  return set.size ? set : new Set(['otros']);
}

function interventionHeading(i) {
  if (i.title) return i.title;
  const names = taskNames(i);
  if (names.length <= 1) return names[0] || 'Intervención';
  const areas = interventionAreas(i);
  return areas.size > 1 ? `${names.length} tareas de mantenimiento` : `${names.length} tareas: ${areaName([...areas][0]).toLowerCase()}`;
}

export function interventionLogRow(i) {
  return logRow({
    href: idPath('intervencion', i.id),
    date: i.date,
    title: interventionTitle(i),
    meta: [isNum(i.engineHours) && metaText(fmtHours(i.engineHours)), metaText(doneByText(i, 'Yo')), metaMoney(interventionCost(i)), metaPhotos((i.photoIds || []).length)],
  });
}

// Fila de una tarea con su estado. En Estado: área y vencimiento; en Trabajos: intervalo y estado.
export function taskRow(s, { detail = false } = {}) {
  return row({
    href: idPath('tarea', s.task.id),
    cls: `st-${s.status}`,
    title: s.task.name,
    sub: detail ? `${intervalText(s.task)}. ${STATUS_LABEL[s.status]}.` : areaName(s.task.system),
    dueHTML: detail ? '' : `<span class="sr">${STATUS_LABEL[s.status]}: </span>${esc(dueText(s))}`,
  });
}

// ───────────────────────── Tarea ─────────────────────────
export function viewTask(id) {
  const t = taskById(id);
  if (!t) return notFound('Esta tarea ya no existe.');
  const st = settings();
  const s = taskStatus(t, repo.state, st);
  const hist = repo.state.interventions.filter((i) => (i.taskIds || []).includes(t.id)).sort(byDateDesc);
  const hoursLeft = s.hoursLeft !== null ? `, ${s.hoursLeft > 0 ? 'faltan ' + fmtHours(s.hoursLeft) : 'pasada ' + fmtHours(-s.hoursLeft)}` : '';
  return `
  ${backLink('#/', 'Estado')}
  <article class="detail">
    <p class="badge st-${s.status}">${STATUS_LABEL[s.status]}</p>
    <h1>${esc(t.name)}</h1>
    <p class="muted">${esc(areaName(t.system))}</p>
    ${facts([
      ['Intervalo', intervalText(t)],
      ['Aviso', `${t.noticeHours ?? st.noticeHours} h o ${t.noticeDays ?? st.noticeDays} días antes`],
      s.last && ['Última vez', `${fmtDate(s.last.date)}${isNum(s.last.engineHours) ? `, a las ${fmtHours(s.last.engineHours)}` : ''}`],
      s.dueDate && [t.type === 'caducidad' ? 'Caduca / próxima revisión' : 'Próxima por fecha', `${fmtDate(s.dueDate)} (${relDays(s.daysLeft)})`],
      s.dueHours !== null && ['Próxima por horas', `a las ${fmtHours(s.dueHours)}${hoursLeft}`],
      s.estDateFromHours && s.hoursLeft > 0 && ['Estimación por uso', `hacia el ${fmtDate(s.estDateFromHours)}`],
      s.engineChange && ['Motor', `Cambiado el ${fmtDate(s.engineChange.date)}: las horas de esta tarea cuentan desde el cambio.`],
      s.hoursEstimated && ['Horas', 'El último registro no tiene horas de motor: se han estimado con tus lecturas de esa época.'],
      s.noDate && ['Próxima', t.type === 'caducidad' ? 'Falta la fecha de caducidad: registra la tarea de nuevo anotándola, o pon un intervalo en meses.' : 'Faltan datos para calcularla.'],
      s.missingHours && ['Horas', 'El último registro no tiene horas de motor: no se puede calcular el aviso por horas.'],
    ])}
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ''}
    <div class="actions">
      <a class="btn primary" href="#/registrar?tarea=${encodeURIComponent(t.id)}">Registrar intervención</a>
      <a class="btn" href="${idPath('tarea', t.id, 'editar')}">Editar tarea</a>
    </div>
  </article>
  <section>
    <h2>Historial</h2>
    ${hist.length ? `<ul class="log">${hist.map(interventionLogRow).join('')}</ul>` : '<p class="muted">Todavía no hay intervenciones de esta tarea.</p>'}
  </section>`;
}

export function viewTaskEdit(id) {
  const st = settings();
  const areaParam = route().params.get('area');
  const t = id ? taskById(id) : {
    id: 'u-' + uid().slice(0, 8), system: validArea(areaParam) ? areaParam : 'otros', name: '', type: 'intervalo', intervalHours: null,
    intervalMonths: 12, noticeHours: null, noticeDays: null, active: true, notes: '', builtin: false,
  };
  if (!t) return notFound('Esta tarea ya no existe.');
  const numField = (name, label, value, ph = '—') =>
    `<label>${label}<input type="number" name="${name}" min="0" step="1" inputmode="numeric" value="${esc(value ?? '')}" placeholder="${esc(ph)}"></label>`;
  return `
  ${backLink(id ? idPath('tarea', id) : '#/trabajos?tipo=preventivos', 'Cancelar')}
  <h1>${id ? 'Editar tarea' : 'Nueva tarea'}</h1>
  <form id="task-form" class="form" data-id="${esc(t.id)}">
    <label>Nombre<input type="text" name="name" value="${esc(t.name)}" required></label>
    <label>Área${areaSelect('system', validArea(t.system) ? t.system : 'otros')}</label>
    <fieldset class="seg">
      <legend>Cómo se calcula la próxima</legend>
      <label><input type="radio" name="type" value="intervalo" ${t.type !== 'caducidad' ? 'checked' : ''}><span>Por intervalo</span></label>
      <label><input type="radio" name="type" value="caducidad" ${t.type === 'caducidad' ? 'checked' : ''}><span>Por fecha de caducidad</span></label>
    </fieldset>
    <div class="grid2">${numField('intervalHours', 'Cada (horas de motor)', t.intervalHours)}${numField('intervalMonths', 'Cada (meses)', t.intervalMonths)}</div>
    <p class="hint">Si rellenas los dos, avisa con lo que llegue antes. En las tareas por caducidad, los meses solo se usan si no anotas la fecha.</p>
    <div class="grid2">${numField('noticeHours', 'Avisar con (horas)', t.noticeHours, `${st.noticeHours} (por defecto)`)}${numField('noticeDays', 'Avisar con (días)', t.noticeDays, `${st.noticeDays} (por defecto)`)}</div>
    <label>Notas<textarea name="notes" rows="3">${esc(t.notes || '')}</textarea></label>
    <label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}><span>Activa (genera avisos)</span></label>
    <p class="form-error" id="form-error" role="alert" hidden></p>
    <div class="actions">
      <button class="btn primary" type="submit">Guardar tarea</button>
      ${id ? deleteButton('delete-task', t.id, 'Borrar tarea') : ''}
    </div>
  </form>`;
}

async function saveTask(form) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  check(name, 'Falta el nombre.');
  const opt = (k) => optNumber(fd.get(k), 'Los intervalos y avisos deben ser números.');
  const id = form.dataset.id;
  const obj = {
    ...(taskById(id) || { id, builtin: false, createdAt: now() }),
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
  check(obj.type !== 'intervalo' || obj.intervalHours || obj.intervalMonths, 'Indica cada cuántas horas o cada cuántos meses toca.');
  await repo.put('tasks', obj);
  finishForm('Tarea guardada', idPath('tarea', id));
}

// ───────────────────────── Registrar / editar intervención ─────────────────────────
function newDraft(r, existing) {
  if (existing) {
    return {
      id: existing.id,
      isNew: false,
      date: existing.date,
      engineHours: fmtInput(existing.engineHours),
      taskIds: new Set(existing.taskIds || []),
      title: existing.title || '',
      ...costDraft(existing),
      expiries: { ...(existing.expiries || {}) },
      notes: existing.notes || '',
      createdAt: existing.createdAt,
      filter: '',
    };
  }
  const pre = r.params.get('tarea');
  return {
    id: uid(),
    isNew: true,
    date: todayStr(),
    engineHours: '',
    taskIds: new Set(pre && taskById(pre) ? [pre] : []),
    title: '',
    ...costDraft(null),
    expiries: {},
    notes: '',
    filter: '',
  };
}

export function viewRegister(r, editId) {
  const existing = editId ? find('interventions', editId) : null;
  if (editId && !existing) return notFound('Esta intervención ya no existe.');
  const d = useDraft(() => newDraft(r, existing));
  const pre = r.params.get('tarea');
  const back = editId ? idPath('intervencion', editId) : pre ? idPath('tarea', pre) : '#/';
  return `
  ${backLink(back, 'Cancelar')}
  <h1>${editId ? 'Editar intervención' : 'Registrar intervención'}</h1>
  <form id="reg-form" class="form" novalidate>
    <div class="grid2">
      <label>Fecha<input type="date" name="date" value="${esc(d.date)}" required max="${todayStr()}"></label>
      ${hoursField('engineHours', d.engineHours, 'Horas de motor', { optional: false })}
    </div>

    <fieldset class="picker">
      <legend>Tareas realizadas <span class="count" id="sel-count">${d.taskIds.size}</span></legend>
      <div id="sel-chips" class="selchips">${selChips(d)}</div>
      <input type="search" id="task-filter" aria-label="Buscar tarea" enterkeyhint="search" placeholder="Buscar tarea (aceite, balsa, winches…)" value="${esc(d.filter)}" autocomplete="off">
      <div class="picklist" id="picklist">${pickList(d)}</div>
    </fieldset>

    <div id="expiries">${expiryFields(d)}</div>

    <label>Descripción <span class="muted">(opcional; obligatoria si no marcas ninguna tarea)</span>
      <input type="text" name="title" value="${esc(d.title)}" placeholder="Por ejemplo: avería de la bomba de achique"></label>

    ${doneBySeg(d)}

    <label>Notas<textarea name="notes" rows="3" placeholder="Marca del aceite, piezas, observaciones…">${esc(d.notes)}</textarea></label>
    ${formEnd(editId ? 'Guardar cambios' : 'Guardar intervención')}
  </form>`;
}

function selChips(d) {
  return [...d.taskIds].map(taskById).filter(Boolean).map((t) =>
    `<button type="button" class="chip" data-action="unpick" data-id="${esc(t.id)}" aria-label="Quitar ${esc(t.name)}">${esc(t.name)} <span aria-hidden="true">×</span></button>`).join('');
}

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function pickList(d) {
  const nf = fold(d.filter.trim());
  let out = '';
  for (const area of AREAS) {
    const tasks = repo.state.tasks
      .filter((t) => t.system === area.id && (t.active || d.taskIds.has(t.id)))
      .filter((t) => !nf || fold(t.name).includes(nf) || fold(area.name).includes(nf))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (!tasks.length) continue;
    out += `<p class="pick-sys">${esc(area.name)}</p>`;
    out += tasks.map((t) => `<label class="pick"><input type="checkbox" data-pick="${esc(t.id)}" ${d.taskIds.has(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('');
  }
  return out || '<p class="muted">Ninguna tarea coincide. Puedes escribir una descripción abajo.</p>';
}

function expiryFields(d) {
  const exps = [...d.taskIds].map(taskById).filter((t) => t && t.type === 'caducidad');
  if (!exps.length) return '';
  return `<fieldset><legend>Próxima caducidad o revisión</legend>
    <p class="hint">Anota la fecha que figura en la etiqueta o el certificado. Si la dejas vacía, se calculará con el intervalo de la tarea.</p>
    ${exps.map((t) => `<label>${esc(t.name)}<input type="date" data-expiry="${esc(t.id)}" value="${esc(d.expiries[t.id] || '')}"></label>`).join('')}
  </fieldset>`;
}

function refreshPicked(d) {
  document.getElementById('sel-count').textContent = d.taskIds.size;
  document.getElementById('sel-chips').innerHTML = selChips(d);
  document.getElementById('expiries').innerHTML = expiryFields(d);
  document.querySelectorAll('#picklist [data-pick]').forEach((c) => (c.checked = d.taskIds.has(c.dataset.pick)));
}

export function bindRegister() {
  const d = currentDraft();
  const form = bindDraftForm('reg-form', d, saveIntervention, {
    fields: ['date', 'engineHours', 'title', 'notes'],
    quiet: (el) => el.id === 'task-filter',
    onInput: (el) => {
      if (el.id === 'task-filter') { d.filter = el.value; document.getElementById('picklist').innerHTML = pickList(d); return true; }
      if (el.dataset.expiry) { d.expiries[el.dataset.expiry] = el.value; return true; }
      return false;
    },
    onChange: (el) => {
      if (!el.dataset.pick) return false;
      if (el.checked) d.taskIds.add(el.dataset.pick); else d.taskIds.delete(el.dataset.pick);
      refreshPicked(d);
      return true;
    },
  });
  // En iPhone, la tecla «Buscar» del teclado no debe guardar el formulario
  form?.querySelector('#task-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
}

async function saveIntervention(d) {
  dateRequired(d.date);
  for (const id of [...d.taskIds]) if (!taskById(id)) d.taskIds.delete(id);
  check(d.taskIds.size || d.title.trim(), 'Marca al menos una tarea o escribe una descripción.');
  costError(d);
  for (const id of d.taskIds) {
    const t = taskById(id);
    check(t.type !== 'caducidad' || isNum(t.intervalMonths) || d.expiries[id], `Anota la fecha de caducidad o próxima revisión de «${t.name}».`);
  }
  const hours = readHours(d.engineHours, d.date);
  if (hours === undefined) return;

  await savePhotos(d, d.id);
  const expiries = {};
  for (const id of d.taskIds) if (d.expiries[id]) expiries[id] = d.expiries[id];
  await repo.put('interventions', {
    id: d.id,
    date: d.date,
    engineHours: hours,
    taskIds: [...d.taskIds],
    title: d.title.trim(),
    ...costRecord(d),
    expiries,
    notes: d.notes.trim(),
    createdAt: d.createdAt || now(),
  });
  finishForm(d.isNew ? 'Intervención guardada' : 'Cambios guardados', d.isNew ? '#/' : idPath('intervencion', d.id));
}

// ───────────────────────── Ver intervención ─────────────────────────
export function viewIntervention(id) {
  const i = find('interventions', id);
  if (!i) return notFound('Esta intervención ya no existe.');
  const tasks = (i.taskIds || []).map(taskById).filter(Boolean);
  return `
  ${backLink('#/historial', 'Historial')}
  <article class="detail">
    <p class="muted">${fmtDate(i.date, LONG_DATE)}</p>
    <h1>${esc(interventionHeading(i))}</h1>
    ${facts([
      ['Horas de motor', isNum(i.engineHours) ? fmtHours(i.engineHours) : 'No anotadas'],
      ['Hecho por', doneByText(i)],
      ['Coste', fmtMoney(interventionCost(i))],
    ])}
    ${tasks.length ? `<h2>Tareas</h2><ul class="plain">${tasks.map((t) => `<li><a href="${idPath('tarea', t.id)}">${esc(t.name)}</a>${i.expiries?.[t.id] ? `, próxima: ${fmtDate(i.expiries[t.id])}` : ''}</li>`).join('')}</ul>` : ''}
    ${i.doneBy !== 'taller' && (i.materials || []).length ? `<h2>Material</h2>${materialsTable(i.materials)}` : ''}
    ${notes(i.notes, 'Notas')}
    ${(i.photoIds || []).length ? `<h2>Factura</h2>${thumbs(i.photoIds, 'Abrir factura')}` : ''}
    <div class="actions">
      <a class="btn primary" href="${idPath('intervencion', i.id, 'editar')}">Editar</a>
      ${deleteButton('delete-intervention', i.id)}
    </div>
  </article>`;
}

// ───────────────────────── Acciones ─────────────────────────
export const actions = {
  unpick: (el) => {
    const d = currentDraft();
    if (!d) return;
    d.taskIds.delete(el.dataset.id);
    markDirty(d);
    refreshPicked(d);
  },
  'delete-intervention': (el) => confirmDelete('¿Borrar esta intervención? No se puede deshacer.', async () => {
    await deletePhotos(find('interventions', el.dataset.id)?.photoIds);
    await repo.del('interventions', el.dataset.id);
  }, 'Intervención borrada', '#/historial'),
  'delete-task': async (el) => {
    const id = el.dataset.id;
    const used = repo.state.interventions.some((i) => (i.taskIds || []).includes(id));
    if (!confirm(used
      ? 'Esta tarea aparece en intervenciones registradas. Si la borras, esas intervenciones se quedan pero sin esta tarea. Si solo quieres dejar de recibir avisos, desactívala. ¿Borrarla?'
      : '¿Borrar esta tarea?')) return;
    if (taskById(id)?.builtin) await saveSettings({ deletedDefaults: [...new Set([...(settings().deletedDefaults || []), id])] });
    await repo.del('tasks', id);
    formSaved();
    toast('Tarea borrada');
    go('#/trabajos?tipo=preventivos');
  },
};

export const bindTaskForm = () => bindPlainForm('task-form', saveTask);
