// Cálculo de vencimientos, horas de motor y exportación a calendario.
// Funciones puras: no tocan el DOM ni el almacenamiento.

import { AREAS, DEFAULT_TASKS } from './tasks-default.js';

export const DAY_MS = 86400000;

// ── Fechas (siempre como 'YYYY-MM-DD', en hora local) ────────────────
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addMonths(s, months) {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return todayStr(d);
}

export function addDays(s, days) {
  const d = parseDate(s);
  d.setDate(d.getDate() + Math.round(days));
  return todayStr(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

// ── Horas de motor ───────────────────────────────────────────────────
// Un cambio de motor (o de contador) es una lectura con kind 'motor': abre un «tramo»
// nuevo de horas que empieza en sus horas (normalmente 0). Las horas de tramos distintos
// no se comparan ni se restan entre sí.
const at = (o) => o.createdAt || o.updatedAt || '';
const byWhen = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0);

export function engineChanges(state) {
  return state.readings.filter((r) => r.kind === 'motor').sort(byWhen);
}

// Tramo (0 = motor original) al que pertenece algo con fecha `date` apuntado en el instante `t`.
// El mismo día que un cambio, cuenta como del motor nuevo lo apuntado después del cambio.
export const LATER = '\uffff'; // «apuntado ahora», posterior a cualquier cambio ya guardado
export function epochAt(changes, date, t = LATER) {
  let e = 0;
  changes.forEach((c, i) => {
    if (date > c.date || (date === c.date && t >= at(c))) e = i + 1;
  });
  return e;
}

// Puntos (fecha, horas, tramo) de lecturas y de todo lo que lleva horas anotadas, en orden.
// En un mismo día manda lo último que se apuntó (así se corrige un error tecleando de nuevo).
export function hourPoints(state) {
  const ctx = engineContext(state);
  const pts = [];
  // src: colección de origen; o: orden dentro del mismo registro (salida antes que llegada)
  const add = (src, date, hours, rec, o = 0) => {
    if (!date || !isNum(hours)) return;
    const t = src === 'issues' ? rec.doneAt || rec.updatedAt || '' : at(rec);
    const epoch = rec.kind === 'motor' ? ctx.changes.indexOf(rec) + 1 : epochOf(ctx, date, t, hours);
    pts.push({ src, date, hours, t, o, epoch, rec });
  };
  for (const r of state.readings) add('readings', r.date, r.hours, r);
  for (const i of state.interventions) add('interventions', i.date, i.engineHours, i);
  for (const t of state.trips || []) {
    add('trips', t.date, t.hoursStart, t);
    add('trips', t.endDate || t.date, t.hoursEnd, t, 1);
  }
  for (const f of state.fuel || []) add('fuel', f.date, f.engineHours, f);
  for (const i of state.issues || []) if (i.status === 'hecho') add('issues', i.doneDate, i.engineHours, i);
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  pts.sort((a, b) => a.epoch - b.epoch || cmp(a.date, b.date) || cmp(a.t, b.t) || a.o - b.o || a.hours - b.hours);
  return pts;
}

// Tramos de motor y, para cada cambio, las últimas horas conocidas del motor anterior
export function engineContext(state) {
  const changes = engineChanges(state);
  const oldLast = changes.map((c, i) => {
    let best = null;
    const consider = (date, hours) => {
      if (!date || !isNum(hours) || date >= c.date || epochAt(changes, date, '') !== i) return;
      if (!best || date >= best.date) best = { date, hours };
    };
    for (const r of state.readings) if (r.kind !== 'motor') consider(r.date, r.hours);
    for (const x of state.interventions) consider(x.date, x.engineHours);
    for (const t of state.trips || []) { consider(t.date, t.hoursStart); consider(t.endDate || t.date, t.hoursEnd); }
    for (const f of state.fuel || []) consider(f.date, f.engineHours);
    for (const x of state.issues || []) if (x.status === 'hecho') consider(x.doneDate, x.engineHours);
    return best ? best.hours : null;
  });
  return { changes, oldLast };
}

// Tramo de algo con horas. El día de un cambio de motor no basta con el orden en que se
// apuntó (se puede apuntar después algo del motor viejo): decide qué horas encajan mejor,
// las del motor anterior o las del nuevo.
export function epochOf(ctx, date, t, hours) {
  let e = epochAt(ctx.changes, date, t);
  ctx.changes.forEach((c, i) => {
    if (date !== c.date || !isNum(hours) || ctx.oldLast[i] === null) return;
    e = Math.abs(hours - c.hours) <= Math.abs(hours - ctx.oldLast[i]) ? i + 1 : i;
  });
  return e;
}

// Horas aproximadas en una fecha, interpolando entre lecturas del mismo tramo.
// Si solo hay lecturas anteriores, usa la última (estimación prudente: avisa antes).
export function hoursAt(state, date, epoch) {
  let before = null, after = null;
  for (const p of hourPoints(state)) {
    if (epoch !== undefined && p.epoch !== epoch) continue;
    if (p.date <= date) before = p;
    else if (!after) after = p;
  }
  if (before && after) {
    const span = daysBetween(before.date, after.date);
    if (span <= 0 || after.hours < before.hours) return before.hours;
    return round1(before.hours + (after.hours - before.hours) * (daysBetween(before.date, date) / span));
  }
  return before ? before.hours : null;
}

// Lectura más reciente del motor actual: { hours, date, epoch }
export function currentHours(state) {
  const pts = hourPoints(state);
  if (!pts.length) return null;
  const { hours, date, epoch } = pts[pts.length - 1];
  return { hours, date, epoch };
}

// Ritmo de uso en horas/día. Usa el último año si hay datos suficientes.
// Con cambios de motor, suma lo que avanzó cada tramo por separado.
export function usageRate(state, today = todayStr()) {
  const pts = hourPoints(state);
  const yearAgo = addDays(today, -400);
  for (const set of [pts.filter((p) => p.date >= yearAgo), pts]) {
    if (set.length < 2) continue;
    const ends = new Map();
    for (const p of set) {
      const e = ends.get(p.epoch);
      if (e) e.last = p; else ends.set(p.epoch, { first: p, last: p });
    }
    const delta = [...ends.values()].reduce((s, e) => s + Math.max(0, e.last.hours - e.first.hours), 0);
    const dates = set.map((p) => p.date).sort();
    const span = daysBetween(dates[0], dates[dates.length - 1]);
    if (span >= 21 && delta > 0) return delta / span;
  }
  return null;
}

// ¿Encajan unas horas nuevas con las lecturas de su tramo? Devuelve null o
// { kind: 'menos' | 'salto' | 'mas', point, diff } para avisar al usuario.
export function hoursAnomaly(state, hours, date) {
  const epoch = epochOf(engineContext(state), date, LATER, hours);
  let before = null, after = null;
  for (const p of hourPoints(state)) {
    if (p.epoch !== epoch) continue;
    if (p.date <= date) before = p;
    else if (!after) after = p;
  }
  if (before) {
    if (hours < before.hours - 0.05 && before.date < date) return { kind: 'menos', point: before };
    if (hours > before.hours + 24 * Math.max(1, daysBetween(before.date, date))) return { kind: 'salto', point: before, diff: round1(hours - before.hours) };
  }
  if (after && hours > after.hours + 0.05) return { kind: 'mas', point: after };
  return null;
}

// ── Estado de cada tarea ─────────────────────────────────────────────
export function lastInterventionFor(taskId, interventions) {
  let best = null;
  for (const i of interventions) {
    if (!i.taskIds || !i.taskIds.includes(taskId)) continue;
    if (
      !best ||
      i.date > best.date ||
      (i.date === best.date && (i.engineHours ?? -1) > (best.engineHours ?? -1))
    ) {
      best = i;
    }
  }
  return best;
}

/**
 * Devuelve el estado de una tarea:
 *  status: 'overdue' | 'soon' | 'ok' | 'nohistory' | 'inactive'
 *  nextDate: fecha más próxima en la que toca (por fecha o estimada por horas)
 */
export function taskStatus(task, state, settings, today = todayStr(), cache = {}) {
  const cur = cache.cur !== undefined ? cache.cur : currentHours(state);
  const rate = cache.rate !== undefined ? cache.rate : usageRate(state, today);
  const noticeHours = task.noticeHours ?? settings.noticeHours ?? 25;
  const noticeDays = task.noticeDays ?? settings.noticeDays ?? 30;
  const last = lastInterventionFor(task.id, state.interventions);
  const res = {
    task,
    last,
    status: 'ok',
    dueDate: null,
    daysLeft: null,
    dueHours: null,
    hoursLeft: null,
    estDateFromHours: null,
    nextDate: null,
    missingHours: false,
  };
  if (!task.active) {
    res.status = 'inactive';
    return res;
  }
  if (!last) {
    res.status = 'nohistory';
    return res;
  }

  // Por fecha
  const expiry = last.expiries && last.expiries[task.id];
  if (task.type === 'caducidad' && expiry) {
    res.dueDate = expiry;
  } else if (isNum(task.intervalMonths) && task.intervalMonths > 0) {
    res.dueDate = addMonths(last.date, task.intervalMonths);
  }
  if (res.dueDate) res.daysLeft = daysBetween(today, res.dueDate);

  // Por horas. Si el motor se cambió después de la última vez, se cuenta desde el cambio.
  if (isNum(task.intervalHours) && task.intervalHours > 0) {
    const ctx = cache.ctx || engineContext(state);
    const changes = ctx.changes;
    const lastEpoch = epochOf(ctx, last.date, at(last), last.engineHours);
    let base = null;
    if (lastEpoch < changes.length) {
      res.engineChange = changes[changes.length - 1];
      base = res.engineChange.hours;
    } else if (isNum(last.engineHours)) {
      base = last.engineHours;
    } else {
      base = hoursAt(state, last.date, lastEpoch);
      if (base !== null) res.hoursEstimated = true;
    }
    if (base !== null) {
      res.dueHours = round1(base + task.intervalHours);
      if (cur) {
        res.hoursLeft = round1(res.dueHours - cur.hours);
        if (rate && res.hoursLeft > 0) {
          const days = res.hoursLeft / rate;
          res.estDateFromHours = days <= 3650 ? addDays(today, days) : null; // más de 10 años: no estimar
        } else if (res.hoursLeft <= 0) {
          res.estDateFromHours = today;
        }
      }
    } else {
      res.missingHours = true;
    }
  }

  // Sin fecha ni horas con las que calcular (p. ej. caducidad sin fecha anotada): pedir el dato
  if (res.dueDate === null && res.dueHours === null) {
    res.status = 'soon';
    res.noDate = true;
    return res;
  }

  const overdue =
    (res.daysLeft !== null && res.daysLeft <= 0) || (res.hoursLeft !== null && res.hoursLeft <= 0);
  const soon =
    (res.daysLeft !== null && res.daysLeft <= noticeDays) ||
    (res.hoursLeft !== null && res.hoursLeft <= noticeHours);
  res.status = overdue ? 'overdue' : soon ? 'soon' : 'ok';

  const dates = [res.dueDate, res.estDateFromHours].filter(Boolean).sort();
  res.nextDate = dates[0] || null;
  return res;
}

export function allStatuses(state, settings, today = todayStr()) {
  const cache = { cur: currentHours(state), rate: usageRate(state, today), ctx: engineContext(state) };
  return state.tasks.map((t) => taskStatus(t, state, settings, today, cache));
}

const ORDER = { overdue: 0, soon: 1, nohistory: 2, ok: 3, inactive: 4 };

export function sortStatuses(list) {
  return [...list].sort((a, b) => {
    if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
    // Dentro de cada grupo: lo que antes toque, primero
    const ah = a.hoursLeft ?? Infinity;
    const bh = b.hoursLeft ?? Infinity;
    const ad = a.nextDate || '9999';
    const bd = b.nextDate || '9999';
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (ah !== bh) return ah - bh;
    return a.task.name.localeCompare(b.task.name, 'es');
  });
}

// ── Costes ───────────────────────────────────────────────────────────
export function interventionCost(i) {
  if (i.doneBy === 'taller') return num(i.invoiceTotal);
  return (i.materials || []).reduce((s, m) => s + num(m.cost), 0);
}

// Un correctivo solo tiene coste cuando está hecho (mismo formato: material o factura)
export function issueCost(i) {
  return i.status === 'hecho' ? interventionCost(i) : 0;
}

const PRIORITY_ORDER = { urgente: 0, alta: 1, media: 2, baja: 3 };
export function sortIssues(list) {
  return [...list].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) ||
    (a.detectedDate || '').localeCompare(b.detectedDate || '') ||
    (a.title || '').localeCompare(b.title || '', 'es'));
}

// ── Bitácora y combustible ───────────────────────────────────────────
export function tripEngineHours(t) {
  return isNum(t.hoursStart) && isNum(t.hoursEnd) && t.hoursEnd >= t.hoursStart ? round1(t.hoursEnd - t.hoursStart) : null;
}

export function tripDays(t) {
  return t.endDate && t.endDate > t.date ? daysBetween(t.date, t.endDate) + 1 : 1;
}

export function tripStats(trips) {
  let miles = 0, engine = 0, days = 0;
  for (const t of trips) {
    miles += num(t.miles);
    engine += tripEngineHours(t) || 0;
    days += tripDays(t);
  }
  return { count: trips.length, miles: round1(miles), engine: round1(engine), days };
}

export function fuelCost(f) {
  return num(f.total);
}

/**
 * Consumo medio (L/h) por el método de depósito lleno a depósito lleno:
 * entre dos repostajes con «depósito lleno» y horas anotadas, los litros
 * echados después del primero (incluido el segundo) divididos por las horas.
 */
export function fuelConsumption(fuel) {
  const list = [...fuel].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.engineHours ?? 0) - (b.engineHours ?? 0));
  let liters = 0, hours = 0, prev = null, acc = 0;
  for (const f of list) {
    if (prev) acc += num(f.liters);
    if (f.fullTank) {
      if (isNum(f.engineHours) && num(f.liters) > 0) {
        if (prev && f.engineHours > prev.engineHours) {
          liters += acc;
          hours += f.engineHours - prev.engineHours;
        }
        prev = f;
      } else {
        prev = null; // depósito lleno sin horas o sin litros: no sirve de referencia
      }
      acc = 0;
    }
  }
  return hours > 0 ? { lph: liters / hours, liters, hours } : null;
}

// ── Calendario (.ics) ────────────────────────────────────────────────
// boatId: los barcos que no son el principal llevan su id en el UID de cada evento,
// para que importar el calendario de otro barco no pise los eventos de este.
export function buildICS(statuses, settings, { horizonMonths = 24, today = todayStr(), boatId = 'principal' } = {}) {
  const uidSuffix = boatId === 'principal' ? '' : `.${boatId}`;
  const limit = addMonths(today, horizonMonths);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//velero-mantenimiento//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText('Mantenimiento ' + (settings.boatName || 'velero'))}`,
  ];
  for (const s of statuses) {
    if (s.status === 'inactive' || s.status === 'nohistory' || !s.nextDate) continue;
    let date = s.nextDate < today ? today : s.nextDate;
    if (date > limit) continue;
    const byHours = s.estDateFromHours && s.nextDate === s.estDateFromHours && s.nextDate !== s.dueDate;
    const notice = s.task.noticeDays ?? settings.noticeDays ?? 30;
    const alarms = date <= today
      ? ['PT9H'] // vencida o vence hoy: aviso hoy a las 9:00
      : notice > 1 ? [`-P${notice - 1}DT15H`, '-PT15H'] : ['-PT15H'];
    const desc = [];
    if (s.dueDate) desc.push(`Vence por fecha: ${fmtDate(s.dueDate)}`);
    if (s.dueHours !== null) desc.push(`Vence a las ${s.dueHours} h de motor`);
    if (byHours) desc.push('Fecha estimada según tu ritmo de uso del motor.');
    if (s.last) desc.push(`Última vez: ${fmtDate(s.last.date)}`);
    const d = date.replace(/-/g, '');
    const end = addDays(date, 1).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.task.id}${uidSuffix}@velero-mantenimiento`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsText('⛵ ' + s.task.name + (byHours ? ' (estimada)' : ''))}`,
      `DESCRIPTION:${icsText(desc.join('\n'))}`,
      'TRANSP:TRANSPARENT',
      ...alarms.flatMap((tr) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(s.task.name)}`, `TRIGGER:${tr}`, 'END:VALARM']),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

function foldLine(line) {
  // RFC 5545: líneas de máx. 75 octetos
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// ── Utilidades ───────────────────────────────────────────────────────
export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
// Interpreta números escritos a la española o a la inglesa:
// "42,5" -> 42.5, "1.180,5" -> 1180.5, "1.180" -> 1180, "42.5" -> 42.5
export function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').trim().replace(/\s|€|h$/gi, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    // El último separador es el decimal: "1.180,5" o "1,180.5"
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(/\.$/, ''); // "42," o "42."
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return parseFloat(s);
}
export function num(v) {
  const n = parseNum(v);
  return Number.isFinite(n) ? n : 0;
}
export function round1(n) {
  return Math.round(n * 10) / 10;
}
export function round2(n) {
  return Math.round(n * 100) / 100;
}
export function fmtDate(s, opts) {
  if (!s) return '';
  return parseDate(s).toLocaleDateString('es-ES', opts || { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtMoney(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
export function fmtHours(n) {
  if (!isNum(n)) return '—';
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n) + ' h';
}

// ── Validación de registros (copias importadas, datos de la nube) ───
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_RE = /^data:(image\/jpeg|image\/png|application\/pdf);base64,[A-Za-z0-9+/=]+$/;
// Fecha real (rechaza 2026-02-30, que el calendario convertiría en otro día)
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && todayStr(parseDate(v)) === v;
// Fecha de algo ya ocurrido (margen de un día por husos horarios)
const isPast = (v) => isDate(v) && v <= addDays(todayStr(), 1);

// Áreas: las de versiones antiguas o desconocidas se llevan a la actual más parecida
const AREA_IDS = new Set(AREAS.map((a) => a.id));
const OLD_AREAS = { jarcia: 'jarcia-labor' };
const DEFAULT_AREA = new Map(DEFAULT_TASKS.map((t) => [t.id, t.system]));
export function normArea(v, taskId) {
  if (typeof v === 'string' && AREA_IDS.has(v)) return v;
  if (taskId && DEFAULT_AREA.has(taskId)) return DEFAULT_AREA.get(taskId);
  return OLD_AREAS[v] || 'otros';
}
const str = (v, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');
const optNum = (v) => (isNum(v) && v >= 0 && v < 1e7 ? v : null);
const optDate = (v) => (isDate(v) ? v : '');

/** Devuelve una copia limpia del registro, o null si no es aprovechable. */
export function sanitizeRecord(col, o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  // Ids que Firestore no admite (con «/», o del tipo __x__) se descartan
  if (typeof o.id !== 'string' || !o.id || o.id.length > 200 || o.id.includes('/') || /^__.*__$/.test(o.id) || o.id === '.' || o.id === '..') return null;
  const base = { id: o.id, createdAt: str(o.createdAt, 40), updatedAt: str(o.updatedAt, 40) };
  switch (col) {
    case 'tasks': {
      if (!str(o.name).trim()) return null;
      return {
        ...base,
        name: str(o.name, 200),
        system: normArea(o.system, o.builtin ? o.id : null),
        type: o.type === 'caducidad' ? 'caducidad' : 'intervalo',
        intervalHours: optNum(o.intervalHours) || null,
        intervalMonths: optNum(o.intervalMonths) || null,
        noticeHours: optNum(o.noticeHours),
        noticeDays: optNum(o.noticeDays),
        active: o.active !== false,
        notes: str(o.notes),
        builtin: !!o.builtin,
      };
    }
    case 'interventions': {
      if (!isPast(o.date)) return null;
      const expiries = {};
      if (o.expiries && typeof o.expiries === 'object') {
        for (const [k, v] of Object.entries(o.expiries)) if (typeof k === 'string' && isDate(v)) expiries[k] = v;
      }
      return {
        ...base,
        date: o.date,
        engineHours: optNum(o.engineHours),
        taskIds: Array.isArray(o.taskIds) ? o.taskIds.filter((x) => typeof x === 'string') : [],
        title: str(o.title, 300),
        doneBy: o.doneBy === 'taller' ? 'taller' : 'yo',
        materials: Array.isArray(o.materials)
          ? o.materials.filter((m) => m && typeof m === 'object').map((m) => ({ desc: str(m.desc, 300), cost: optNum(m.cost) ?? 0 }))
          : [],
        workshop: str(o.workshop, 200),
        invoiceTotal: optNum(o.invoiceTotal),
        photoIds: Array.isArray(o.photoIds) ? o.photoIds.filter((x) => typeof x === 'string') : [],
        expiries,
        notes: str(o.notes),
      };
    }
    case 'issues': {
      if (!str(o.title).trim() || !isPast(o.detectedDate)) return null;
      const done = o.status === 'hecho' && isPast(o.doneDate);
      // Si se arregló «antes» de detectarse, la detección pasa a ese día
      const detected = done && o.doneDate < o.detectedDate ? o.doneDate : o.detectedDate;
      return {
        ...base,
        title: str(o.title, 200),
        area: normArea(o.area),
        priority: ['urgente', 'alta', 'media', 'baja'].includes(o.priority) ? o.priority : 'media',
        description: str(o.description),
        detectedDate: detected,
        problemPhotoIds: Array.isArray(o.problemPhotoIds) ? o.problemPhotoIds.filter((x) => typeof x === 'string') : [],
        status: done ? 'hecho' : 'pendiente',
        doneDate: done ? o.doneDate : '',
        work: done ? str(o.work) : '',
        engineHours: done ? optNum(o.engineHours) : null,
        doneBy: o.doneBy === 'taller' ? 'taller' : 'yo',
        materials: done && Array.isArray(o.materials)
          ? o.materials.filter((m) => m && typeof m === 'object').map((m) => ({ desc: str(m.desc, 300), cost: optNum(m.cost) ?? 0 }))
          : [],
        workshop: done ? str(o.workshop, 200) : '',
        invoiceTotal: done ? optNum(o.invoiceTotal) : null,
        photoIds: done && Array.isArray(o.photoIds) ? o.photoIds.filter((x) => typeof x === 'string') : [],
        doneAt: done ? str(o.doneAt, 40) : '',
      };
    }
    case 'readings':
      if (!isPast(o.date) || optNum(o.hours) === null) return null;
      return o.kind === 'motor'
        ? { ...base, date: o.date, hours: o.hours, kind: 'motor', engine: str(o.engine, 200) }
        : { ...base, date: o.date, hours: o.hours };
    case 'boats':
      if (!o.deleted && !str(o.name).trim()) return null;
      return { ...base, name: str(o.name, 100), model: str(o.model, 200), engine: str(o.engine, 200), deleted: !!o.deleted };
    case 'trips': {
      if (!isPast(o.date)) return null;
      const end = optDate(o.endDate);
      return {
        ...base,
        date: o.date,
        endDate: end && end > o.date ? end : '',
        from: str(o.from, 200),
        to: str(o.to, 200),
        hoursStart: optNum(o.hoursStart),
        hoursEnd: optNum(o.hoursEnd),
        miles: optNum(o.miles),
        crew: str(o.crew, 300),
        conditions: str(o.conditions, 300),
        notes: str(o.notes),
        fuelId: typeof o.fuelId === 'string' ? o.fuelId : null,
      };
    }
    case 'fuel':
      if (!isPast(o.date)) return null;
      return {
        ...base,
        date: o.date,
        liters: optNum(o.liters) ?? 0,
        total: optNum(o.total) ?? 0,
        place: str(o.place, 200),
        method: o.method === 'garrafas' ? 'garrafas' : 'surtidor',
        fullTank: !!o.fullTank,
        engineHours: optNum(o.engineHours),
        tripId: typeof o.tripId === 'string' ? o.tripId : null,
        notes: str(o.notes),
      };
    case 'meta': {
      if (o.id !== 'settings') return null;
      // Solo los campos presentes y válidos: lo que falte lo ponen los valores por defecto
      const m = { id: 'settings' };
      if (base.createdAt) m.createdAt = base.createdAt;
      if (base.updatedAt) m.updatedAt = base.updatedAt;
      if (typeof o.boatName === 'string' && o.boatName.trim()) m.boatName = str(o.boatName, 100);
      if (typeof o.boatModel === 'string') m.boatModel = str(o.boatModel, 200);
      if (typeof o.engine === 'string') m.engine = str(o.engine, 200);
      if (optNum(o.noticeHours) !== null) m.noticeHours = o.noticeHours;
      if (optNum(o.noticeDays) !== null) m.noticeDays = o.noticeDays;
      if (Array.isArray(o.deletedDefaults)) m.deletedDefaults = o.deletedDefaults.filter((x) => typeof x === 'string');
      if (typeof o.seedDefaults === 'boolean') m.seedDefaults = o.seedDefaults;
      if (Number.isInteger(o.areasVersion)) m.areasVersion = o.areasVersion;
      return m;
    }
    case 'photos':
      if (typeof o.data !== 'string' || !PHOTO_RE.test(o.data) || o.data.length > 1_000_000) return null;
      return { id: o.id, data: o.data, mime: o.data.slice(5, o.data.indexOf(';')), name: str(o.name, 200), interventionId: str(o.interventionId, 200) };
    default:
      return null;
  }
}
