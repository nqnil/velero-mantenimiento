// Historial de gastos: preventivo, correctivo y combustible, por año y por área.

import { repo, esc, link, validArea, areaName, areaSelect, fmtNum } from '../core.js';
import { interventionCost, issueCost, fuelCost, fuelConsumption, num, fmtMoney } from '../logic.js';
import { chips, years, pickYear, yearChips, inYear, bars } from '../ui.js';
import { interventionAreas, interventionLogRow } from './maintenance.js';
import { issueLogRow } from './issues.js';
import { fuelLogRow, pplText } from './logbook.js';

const TYPES = [
  { id: 'todo', name: 'Todo' },
  { id: 'preventivo', name: 'Preventivo' },
  { id: 'correctivo', name: 'Correctivo' },
  { id: 'combustible', name: 'Combustible' },
];

function entries() {
  return [
    ...repo.state.interventions.map((i) => ({ kind: 'preventivo', date: i.date, obj: i, cost: interventionCost(i), areas: interventionAreas(i), row: interventionLogRow })),
    ...repo.state.issues.filter((i) => i.status === 'hecho').map((i) => ({ kind: 'correctivo', date: i.doneDate, obj: i, cost: issueCost(i), areas: new Set([i.area]), row: issueLogRow })),
    ...repo.state.fuel.map((f) => ({ kind: 'combustible', date: f.date, obj: f, cost: fuelCost(f), areas: new Set(['combustible']), row: fuelLogRow })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function viewHistory(r) {
  let kind = r.params.get('tipo');
  if (kind === 'mantenimiento') kind = 'preventivo'; // enlaces antiguos
  if (!TYPES.some((t) => t.id === kind)) kind = 'todo';
  const areaParam = r.params.get('area') || '';
  const area = validArea(areaParam) || areaParam === 'combustible' ? areaParam : '';
  const all = entries();
  if (!all.length) {
    return `<h1>Historial</h1>
    <section class="notice"><p>Aún no hay nada registrado. Aquí verás el mantenimiento preventivo, los correctivos hechos y el combustible, con lo que ha costado cada cosa.</p>
    <div class="actions"><a class="btn primary" href="#/registrar">Registrar preventivo</a><a class="btn" href="#/repostar">Registrar repostaje</a></div></section>`;
  }
  const ys = years(all);
  const year = pickYear(ys, r.params.get('anio'));
  const list = all.filter((e) => inYear(e.date, year) && (kind === 'todo' || e.kind === kind) && (!area || e.areas.has(area)));

  // Un apunte de varias áreas reparte su coste a partes iguales entre ellas,
  // para que la suma por áreas cuadre con el total.
  const share = (e) => (area && e.areas.size > 1 ? e.cost / e.areas.size : e.cost);
  const sum = (arr) => arr.reduce((s, e) => s + share(e), 0);
  const total = sum(list);
  const multi = area ? list.filter((e) => e.areas.size > 1).length : 0;
  const groups = {};
  for (const e of list) {
    if (area) groups[e.kind] = (groups[e.kind] || 0) + share(e);
    else for (const a of e.areas) groups[a] = (groups[a] || 0) + e.cost / e.areas.size;
  }
  const rows = Object.entries(groups).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const work = list.filter((e) => e.kind !== 'combustible');
  const mine = sum(work.filter((e) => e.obj.doneBy !== 'taller'));
  const fuelList = list.filter((e) => e.kind === 'combustible').map((e) => e.obj);
  const liters = fuelList.reduce((s, f) => s + num(f.liters), 0);
  const cons = fuelConsumption(repo.state.fuel);
  const href = (k, y, a = area) => link('historial', { tipo: k, anio: y, area: a });

  return `
  <h1>Historial</h1>
  ${chips('Tipo', TYPES, kind, (k) => href(k, year))}
  ${yearChips(ys, year, (y) => href(kind, y))}
  <form class="areafilter" id="hist-area" data-tipo="${esc(kind)}" data-anio="${esc(year)}">
    <label>Área ${areaSelect('area', area, { all: true, extra: [{ id: 'combustible', name: 'Combustible' }] })}</label>
  </form>
  <section class="spend">
    <p class="spend-total"><span class="money big">${fmtMoney(total)}</span> en ${list.length} ${list.length === 1 ? 'apunte' : 'apuntes'}${year === 'todo' ? '' : ` en ${esc(year)}`}${area ? `, ${esc(areaName(area).toLowerCase())}` : ''}</p>
    ${multi ? `<p class="hint">Incluye ${multi} ${multi === 1 ? 'apunte' : 'apuntes'} de varias áreas: aquí cuenta la parte proporcional de su coste.</p>` : ''}
    ${work.length ? `<p class="muted">Trabajos: material propio ${fmtMoney(mine)}, talleres ${fmtMoney(sum(work) - mine)}.</p>` : ''}
    ${fuelList.length ? `<p class="muted">Combustible: ${fmtNum(liters)} L${pplText(fuelList)}.${cons ? ` Consumo medio del motor: ${fmtNum(cons.lph, 2)} L/h.` : ''}</p>` : ''}
    ${bars(rows, (k) => (area ? TYPES.find((t) => t.id === k).name : areaName(k)))}
  </section>
  ${list.length ? `<ul class="log">${list.map((e) => e.row(e.obj)).join('')}</ul>` : '<p class="muted">Nada registrado con este filtro.</p>'}`;
}
