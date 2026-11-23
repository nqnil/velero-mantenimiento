// Trabajos: correctivos (cosas que arreglar) y lista de preventivos.

import { AREAS, PRIORITIES } from '../tasks-default.js';
import {
  repo, esc, toast, render, idPath, link, issueById, now, deletePhotos, settings,
  areaName, validArea, areaSelect, byDesc, priority, PRIO_CLASS, capitalize, ICON, fmtInput, doneByText,
} from '../core.js';
import { todayStr, issueCost, sortIssues, allStatuses, isNum, fmtDate, fmtMoney, fmtHours } from '../logic.js';
import { uid } from '../store.js';
import {
  useDraft, currentDraft, check, dateRequired, readHours, hoursField, bindDraftForm, finishForm, confirmDelete,
  costDraft, doneBySeg, costError, costRecord, savePhotos, draftPhotos,
} from '../forms.js';
import { backLink, notFound, facts, html, row, logRow, metaText, metaMoney, metaPhotos, materialsTable, thumbs, notes, formEnd, deleteButton } from '../ui.js';
import { taskRow } from './maintenance.js';

const isDone = (i) => i.status === 'hecho';
const workLink = (tipo, area) => link('trabajos', { tipo, area });

export function issueRow(i, { showArea = true } = {}) {
  const done = isDone(i);
  const sub = [showArea ? areaName(i.area) : '', done ? `hecho el ${fmtDate(i.doneDate)}` : `desde el ${fmtDate(i.detectedDate)}`].filter(Boolean).join(', ');
  return row({
    href: idPath('correctivo', i.id),
    cls: done ? 'st-ok' : PRIO_CLASS[i.priority] || 'p-media',
    title: i.title,
    sub: capitalize(sub),
    due: done ? (issueCost(i) ? '' : 'Hecho') : priority(i.priority).name,
    dueHTML: done && issueCost(i) ? `<span class="money">${fmtMoney(issueCost(i))}</span>` : '',
  });
}

export function issueLogRow(i) {
  return logRow({
    href: idPath('correctivo', i.id),
    date: i.doneDate,
    title: `Correctivo: ${i.title}`,
    meta: [metaText(areaName(i.area)), metaText(doneByText(i, 'Yo')), metaMoney(issueCost(i)), metaPhotos((i.photoIds || []).length)],
  });
}

export const pendingIssues = () => sortIssues(repo.state.issues.filter((i) => !isDone(i)));

// ───────────────────────── Pantalla Trabajos ─────────────────────────
export function viewWork(r, forced) {
  const tipo = (forced || r.params.get('tipo')) === 'preventivos' ? 'preventivos' : 'correctivos';
  const area = validArea(r.params.get('area')) ? r.params.get('area') : '';
  const inArea = (i) => !area || i.area === area;
  const open = pendingIssues().filter(inArea);
  const head = `
  <div class="titlebar"><h1>Trabajos</h1>
    ${tipo === 'correctivos'
      ? `<a class="btn small primary" href="${esc(link('correctivo/nuevo', { area }))}">Nuevo correctivo</a>`
      : `<a class="btn small" href="${esc(link('tarea/nueva', { area }))}">Nueva tarea</a>`}
  </div>
  <nav class="seglinks" aria-label="Tipo de trabajo">
    <a href="${esc(workLink('correctivos', area))}" ${tipo === 'correctivos' ? 'aria-current="true"' : ''}>Correctivos${open.length ? ` <span class="count">${open.length}</span>` : ''}</a>
    <a href="${esc(workLink('preventivos', area))}" ${tipo === 'preventivos' ? 'aria-current="true"' : ''}>Preventivos</a>
  </nav>
  <form class="areafilter" id="area-filter" data-tipo="${tipo}">
    <label>Área ${areaSelect('area', area, { all: true })}</label>
  </form>`;

  if (tipo === 'preventivos') return head + preventiveList(area);

  if (!repo.state.issues.length) {
    return head + `<section class="notice"><p>Aquí van las cosas que encuentras y hay que arreglar: una polea rota, una vía de agua, un winch que patina… Apúntalas con su prioridad y márcalas como hechas cuando las arregles, con el trabajo y el coste.</p>
    <a class="btn primary" href="${esc(link('correctivo/nuevo', { area }))}">Apuntar un correctivo</a></section>`;
  }
  const done = repo.state.issues.filter((i) => isDone(i) && inArea(i)).sort(byDesc('doneDate'));
  const rows = (list) => `<ul class="rows">${list.map((i) => issueRow(i, { showArea: !area })).join('')}</ul>`;
  return head + `
  <section>
    <h2 class="grp">Pendientes <span class="count">${open.length}</span></h2>
    ${open.length ? rows(open) : `<p class="allclear">Nada pendiente${area ? ' en esta área' : ''}.</p>`}
  </section>
  ${done.length ? `<details class="fold">
    <summary><h2 class="grp ok">Hechos <span class="count">${done.length}</span></h2></summary>
    ${rows(done)}
  </details>` : ''}`;
}

function preventiveList(area) {
  const statuses = allStatuses(repo.state, settings()).filter((s) => !area || s.task.system === area);
  if (!statuses.length) return '<p class="muted">No hay tareas de mantenimiento en esta área.</p>';
  const byArea = {};
  for (const s of statuses) (byArea[validArea(s.task.system) ? s.task.system : 'otros'] ||= []).push(s);
  return `<p class="muted">Mantenimiento periódico, por horas de motor o por fecha. Toca una tarea para ver su historial o cambiar el intervalo.</p>
  ${AREAS.filter((a) => byArea[a.id]).map((a) => `
    <section>
      <h2>${esc(a.name)}</h2>
      <ul class="rows">${byArea[a.id].sort((x, y) => x.task.name.localeCompare(y.task.name, 'es')).map((s) => taskRow(s, { detail: true })).join('')}</ul>
    </section>`).join('')}`;
}

// ───────────────────────── Ver correctivo ─────────────────────────
export function viewIssue(id) {
  const i = issueById(id);
  if (!i) return notFound('Este correctivo ya no existe.');
  const done = isDone(i);
  const p = priority(i.priority);
  return `
  ${backLink('#/trabajos', 'Trabajos')}
  <article class="detail">
    <p class="badge ${done ? 'st-ok' : PRIO_CLASS[i.priority]}">${done ? 'Hecho' : `Prioridad ${esc(p.name.toLowerCase())}`}</p>
    <h1>${esc(i.title)}</h1>
    ${facts([
      ['Área', html(`<a href="${esc(workLink('correctivos', i.area))}">${esc(areaName(i.area))}</a>`)],
      ['Detectado', fmtDate(i.detectedDate)],
      !done && ['Prioridad', `${p.name}: ${p.hint}`],
    ])}
    ${notes(i.description)}
    ${thumbs(i.problemPhotoIds)}
    ${done ? `
    <section class="donebox">
      <h2>Trabajo hecho</h2>
      ${facts([
        ['Fecha', fmtDate(i.doneDate)],
        ['Hecho por', doneByText(i)],
        ['Coste', fmtMoney(issueCost(i))],
        isNum(i.engineHours) && ['Horas de motor', fmtHours(i.engineHours)],
      ])}
      ${notes(i.work)}
      ${i.doneBy !== 'taller' ? materialsTable(i.materials) : ''}
      ${(i.photoIds || []).length ? `<h3>Factura</h3>${thumbs(i.photoIds, 'Abrir factura')}` : ''}
    </section>` : ''}
    <div class="actions">
      ${done
        ? `<a class="btn" href="${idPath('correctivo', i.id, 'cerrar')}">Editar trabajo hecho</a>
           <button class="btn" data-action="reopen-issue" data-id="${esc(i.id)}">Volver a pendiente</button>`
        : `<a class="btn primary" href="${idPath('correctivo', i.id, 'cerrar')}">Marcar como hecho</a>`}
      <a class="btn" href="${idPath('correctivo', i.id, 'editar')}">Editar</a>
      ${deleteButton('delete-issue', i.id)}
    </div>
  </article>`;
}

// ───────────────────────── Alta y edición ─────────────────────────
function newIssueDraft(r, existing) {
  const a = r.params.get('area');
  return {
    id: existing?.id || uid(),
    isNew: !existing,
    title: existing?.title || '',
    area: existing?.area || (validArea(a) ? a : ''),
    priority: existing?.priority || 'media',
    detectedDate: existing?.detectedDate || todayStr(),
    description: existing?.description || '',
    problemPhotos: (existing?.problemPhotoIds || []).map((id) => ({ id, existing: true })),
    photos: [],
    materials: [],
    removedPhotos: [],
  };
}

export function viewIssueForm(r, editId) {
  const existing = editId ? issueById(editId) : null;
  if (editId && !existing) return notFound('Este correctivo ya no existe.');
  const d = useDraft(() => newIssueDraft(r, existing));
  return `
  ${backLink(editId ? idPath('correctivo', editId) : '#/trabajos', 'Cancelar')}
  <h1>${editId ? 'Editar correctivo' : 'Nuevo correctivo'}</h1>
  <p class="hint">Algo que has visto y hay que arreglar. Cuando lo hagas, márcalo como hecho y apunta el trabajo y el coste.</p>
  <form id="issue-form" class="form" novalidate>
    <label>Qué hay que arreglar<input type="text" name="title" value="${esc(d.title)}" placeholder="Por ejemplo: cambiar la polea del pie de palo" maxlength="200" required></label>
    <label>Área${areaSelect('area', d.area, { placeholder: 'Elige un área' })}</label>
    <fieldset class="seg prio" role="radiogroup">
      <legend>Prioridad</legend>
      ${PRIORITIES.map((p) => `<label><input type="radio" name="priority" value="${p.id}" ${d.priority === p.id ? 'checked' : ''}><span class="${PRIO_CLASS[p.id]}">${esc(p.name)}</span></label>`).join('')}
    </fieldset>
    <p class="hint" id="prio-hint">${esc(priority(d.priority).hint)}</p>
    <label>Detectado el<input type="date" name="detectedDate" value="${esc(d.detectedDate)}" max="${todayStr()}" required></label>
    <label>Descripción <span class="muted">(opcional)</span><textarea name="description" rows="3" placeholder="Qué le pasa, medidas, referencia de la pieza…">${esc(d.description)}</textarea></label>
    <fieldset>
      <legend>Fotos <span class="muted">(opcional)</span></legend>
      <div class="thumbs" id="problem-photos">${draftPhotos(d, 'problemPhotos')}</div>
      <label class="btn file">${ICON.cam}<span>Añadir foto</span>
        <input type="file" id="problem-input" class="sr" accept="image/*" multiple></label>
    </fieldset>
    ${formEnd(editId ? 'Guardar cambios' : 'Guardar correctivo')}
  </form>`;
}

export function bindIssueForm() {
  const d = currentDraft();
  bindDraftForm('issue-form', d, saveIssue, {
    fields: ['title', 'detectedDate', 'description', 'area'],
    onChange: (el) => {
      if (el.name === 'area') { d.area = el.value; return true; }
      if (el.name !== 'priority') return false;
      d.priority = el.value;
      document.getElementById('prio-hint').textContent = priority(d.priority).hint;
      return true;
    },
  });
}

async function saveIssue(d) {
  check(d.title.trim(), 'Escribe qué hay que arreglar.');
  check(validArea(d.area), 'Elige el área del barco.');
  dateRequired(d.detectedDate);
  const old = issueById(d.id);
  check(!(isDone(old || {}) && old.doneDate && d.detectedDate > old.doneDate), 'No puede detectarse después de haberse arreglado.');
  await savePhotos(d, d.id);
  await repo.put('issues', {
    ...(old || { status: 'pendiente', createdAt: now() }),
    id: d.id,
    title: d.title.trim().slice(0, 200),
    area: d.area,
    priority: d.priority,
    detectedDate: d.detectedDate,
    description: d.description.trim(),
    problemPhotoIds: d.problemPhotos.map((p) => p.id),
  });
  finishForm(d.isNew ? 'Correctivo apuntado' : 'Cambios guardados', d.isNew ? workLink('correctivos', d.area) : idPath('correctivo', d.id));
}

// ───────────────────────── Marcar como hecho ─────────────────────────
export function viewIssueClose(id) {
  const i = issueById(id);
  if (!i) return notFound('Este correctivo ya no existe.');
  const d = useDraft(() => {
    const done = isDone(i);
    return {
      id: i.id,
      wasDone: done,
      doneDate: done ? i.doneDate : todayStr(),
      work: done ? i.work || '' : '',
      engineHours: done ? fmtInput(i.engineHours) : '',
      ...costDraft(done ? i : null),
      problemPhotos: [],
    };
  });
  return `
  ${backLink(idPath('correctivo', i.id), 'Cancelar')}
  <h1>${d.wasDone ? 'Editar trabajo hecho' : 'Marcar como hecho'}</h1>
  <p class="muted">${esc(i.title)}</p>
  <form id="close-form" class="form" novalidate>
    <div class="grid2">
      <label>Fecha<input type="date" name="doneDate" value="${esc(d.doneDate)}" min="${esc(i.detectedDate)}" max="${todayStr()}" required></label>
      ${hoursField('engineHours', d.engineHours)}
    </div>
    <label>Trabajo hecho<textarea name="work" rows="3" placeholder="Qué se hizo, piezas cambiadas…">${esc(d.work)}</textarea></label>
    ${doneBySeg(d)}
    ${formEnd(d.wasDone ? 'Guardar cambios' : 'Guardar como hecho')}
  </form>`;
}

export function bindIssueClose() {
  bindDraftForm('close-form', currentDraft(), saveIssueClose, { fields: ['doneDate', 'work', 'engineHours'] });
}

async function saveIssueClose(d) {
  const i = issueById(d.id);
  check(i, 'Este correctivo ya no existe.');
  dateRequired(d.doneDate);
  check(d.doneDate >= i.detectedDate, `La fecha no puede ser anterior a cuando se detectó (${fmtDate(i.detectedDate)}).`);
  costError(d);
  const hours = readHours(d.engineHours, d.doneDate, 'Las horas de motor no son válidas.');
  if (hours === undefined) return;
  await savePhotos(d, i.id);
  await repo.put('issues', { ...i, status: 'hecho', doneDate: d.doneDate, doneAt: (i.status === 'hecho' && i.doneAt) || now(), work: d.work.trim(), engineHours: hours, ...costRecord(d) });
  finishForm(d.wasDone ? 'Cambios guardados' : 'Correctivo hecho', idPath('correctivo', i.id));
}

// ───────────────────────── Acciones ─────────────────────────
export const actions = {
  'delete-issue': (el) => confirmDelete('¿Borrar este correctivo y sus fotos? No se puede deshacer.', async () => {
    const i = issueById(el.dataset.id);
    await deletePhotos([...(i?.problemPhotoIds || []), ...(i?.photoIds || [])]);
    await repo.del('issues', el.dataset.id);
  }, 'Correctivo borrado', '#/trabajos'),
  'reopen-issue': async (el) => {
    const i = issueById(el.dataset.id);
    if (!i || !confirm('¿Volver a ponerlo como pendiente? Se borrará el trabajo apuntado, su coste y la factura.')) return;
    await deletePhotos(i.photoIds);
    await repo.put('issues', { ...i, status: 'pendiente', doneDate: '', doneAt: '', work: '', engineHours: null, ...costRecord(costDraft(null)) });
    toast('Vuelve a estar pendiente');
    render(true);
  },
};
