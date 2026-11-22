// Pantalla de inicio (Estado) y menú «Apuntar».

import { repo, esc, settings, idPath } from '../core.js';
import { currentHours, usageRate, allStatuses, sortStatuses, isNum, round1, fmtDate, fmtHours } from '../logic.js';
import { taskRow, bindReadingForm } from './maintenance.js';
import { issueRow, pendingIssues } from './issues.js';
import { lastTrip, tripRoute } from './logbook.js';

function meterDigits(hours) {
  let int = '-----';
  let dec = '-';
  if (isNum(hours)) {
    const [i, d = '0'] = round1(hours).toFixed(1).split('.');
    int = i.padStart(5, '0');
    dec = d;
  }
  return `<div class="meter" role="img" aria-label="${isNum(hours) ? fmtHours(hours) + ' de motor' : 'Sin lectura de horas'}">
    ${[...int].map((c) => `<span class="dg">${c}</span>`).join('')}<span class="dg tenth">${dec}</span><span class="unit">h</span></div>`;
}

function urgentBanner(open) {
  const urgent = open.filter((i) => i.priority === 'urgente');
  if (!urgent.length) return '';
  return `<a class="urgent" href="#/trabajos?tipo=correctivos">${urgent.length === 1
    ? `Correctivo urgente: ${esc(urgent[0].title)}. No salgas sin arreglarlo.`
    : `${urgent.length} correctivos urgentes. No salgas sin arreglarlos.`}</a>`;
}

function pendingBlock(open) {
  if (!open.length) return '';
  const top = open[0].priority;
  return `<section>
    <h2 class="grp ${top === 'urgente' ? 'overdue' : top === 'alta' ? 'soon' : ''}">Correctivos pendientes <span class="count">${open.length}</span></h2>
    <ul class="rows">${open.slice(0, 5).map((i) => issueRow(i)).join('')}</ul>
    ${open.length > 5 ? `<p class="more"><a href="#/trabajos">Ver los ${open.length} correctivos pendientes</a></p>` : ''}
  </section>`;
}

// Grupo de tareas: visible (section) o plegado (details)
function group(cls, title, list, { folded = false, hint = '' } = {}) {
  if (!list.length) return '';
  const head = `<h2 class="grp ${cls}">${title} <span class="count">${list.length}</span></h2>`;
  const body = `${hint ? `<p class="hint">${hint}</p>` : ''}<ul class="rows">${list.map((s) => taskRow(s)).join('')}</ul>`;
  return folded ? `<details class="fold"><summary>${head}</summary>${body}</details>` : `<section>${head}${body}</section>`;
}

export function viewHome() {
  const st = settings();
  const groups = { overdue: [], soon: [], nohistory: [], ok: [] };
  for (const s of sortStatuses(allStatuses(repo.state, st))) groups[s.status]?.push(s);
  const cur = currentHours(repo.state);
  const rate = usageRate(repo.state);
  const blank = !groups.overdue.length && !groups.soon.length && !groups.ok.length;
  const open = pendingIssues();
  const trip = lastTrip();

  return `
  ${urgentBanner(open)}
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

  <div class="quick">
    <a class="btn primary" href="#/navegar">Registrar navegación</a>
    <a class="btn" href="#/correctivo/nuevo">Correctivo</a>
    <a class="btn" href="#/registrar">Preventivo</a>
    <a class="btn" href="#/repostar">Repostaje</a>
  </div>
  ${trip ? `<p class="lasttrip">Última navegación: <a href="${idPath('navegacion', trip.id)}">${fmtDate(trip.date)}, ${esc(tripRoute(trip))}</a></p>` : ''}
  ${pendingBlock(open)}

  ${blank ? `
  <section class="notice">
    <h2>Para empezar</h2>
    <p>Registra cuándo se hizo por última vez cada tarea, aunque sea aproximado (por ejemplo, el último cambio de aceite o la revisión de la balsa). Con eso la app calcula cuándo te toca la siguiente.</p>
    <a class="btn primary" href="#/registrar">Registrar una intervención</a>
  </section>` : ''}

  ${group('overdue', 'Preventivo vencido', groups.overdue)}
  ${group('soon', 'Preventivo que toca pronto', groups.soon)}
  ${!groups.overdue.length && !groups.soon.length && !blank ? '<p class="allclear">Nada vencido ni próximo. Buen viento.</p>' : ''}
  ${group('nohistory', 'Sin historial', groups.nohistory, { folded: true, hint: 'Estas tareas no tienen ningún registro todavía. Abre una y registra la última vez que se hizo.' })}
  ${group('ok', 'Al día', groups.ok, { folded: true })}
  <p class="more"><a href="#/trabajos?tipo=preventivos">Ver y editar las tareas de mantenimiento preventivo</a></p>`;
}

export const bindHome = () => bindReadingForm('hours-form');

const CHOICES = [
  ['#/navegar', 'Navegación', 'Una salida al mar: puertos, horas de motor, millas y, si echaste, combustible.'],
  ['#/correctivo/nuevo', 'Correctivo', 'Algo que has visto y hay que arreglar, con su prioridad. Lo marcarás como hecho al arreglarlo.'],
  ['#/registrar', 'Mantenimiento preventivo', 'Una tarea periódica hecha por ti o por un taller (aceite, filtros, antifouling…), con material o factura.'],
  ['#/repostar', 'Repostaje', 'Combustible en surtidor o con garrafas, aunque no salgas a navegar.'],
  ['#/horas', 'Horas de motor', 'Solo la lectura del contador.'],
];

export function viewNew() {
  return `
  <h1>¿Qué quieres apuntar?</h1>
  <ul class="choices">${CHOICES.map(([href, title, text]) => `<li><a href="${href}"><strong>${title}</strong><span>${text}</span></a></li>`).join('')}</ul>`;
}
