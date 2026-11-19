// Cálculo de vencimientos, horas de motor y exportación a calendario.
// Funciones puras: no tocan el DOM ni el almacenamiento.

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
// Puntos (fecha, horas) de lecturas y de intervenciones con horas anotadas.
export function hourPoints(state) {
  const pts = [];
  for (const r of state.readings) {
    if (isNum(r.hours)) pts.push({ date: r.date, hours: r.hours });
  }
  for (const i of state.interventions) {
    if (isNum(i.engineHours)) pts.push({ date: i.date, hours: i.engineHours });
  }
  pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hours - b.hours));
  return pts;
}

export function currentHours(state) {
  const pts = hourPoints(state);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  return { hours: last.hours, date: last.date };
}

// Ritmo de uso en horas/día. Usa el último año si hay datos suficientes.
export function usageRate(state, today = todayStr()) {
  const pts = hourPoints(state);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const yearAgo = addDays(today, -400);
  const recent = pts.filter((p) => p.date >= yearAgo);
  const candidates = [recent.length >= 2 ? recent : null, pts].filter(Boolean);
  for (const set of candidates) {
    const first = set[0];
    const span = daysBetween(first.date, last.date);
    const delta = last.hours - first.hours;
    if (span >= 21 && delta > 0) return delta / span;
  }
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

  // Por horas
  if (isNum(task.intervalHours) && task.intervalHours > 0) {
    if (isNum(last.engineHours)) {
      res.dueHours = round1(last.engineHours + task.intervalHours);
      if (cur) {
        res.hoursLeft = round1(res.dueHours - cur.hours);
        if (rate && res.hoursLeft > 0) {
          res.estDateFromHours = addDays(today, res.hoursLeft / rate);
        } else if (res.hoursLeft <= 0) {
          res.estDateFromHours = today;
        }
      }
    } else {
      res.missingHours = true;
    }
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
  const cache = { cur: currentHours(state), rate: usageRate(state, today) };
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

// ── Calendario (.ics) ────────────────────────────────────────────────
export function buildICS(statuses, settings, { horizonMonths = 24, today = todayStr() } = {}) {
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
    const desc = [];
    if (s.dueDate) desc.push(`Vence por fecha: ${fmtDate(s.dueDate)}`);
    if (s.dueHours !== null) desc.push(`Vence a las ${s.dueHours} h de motor`);
    if (byHours) desc.push('Fecha estimada según tu ritmo de uso del motor.');
    if (s.last) desc.push(`Última vez: ${fmtDate(s.last.date)}`);
    const d = date.replace(/-/g, '');
    const end = addDays(date, 1).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.task.id}@velero-mantenimiento`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${icsText('⛵ ' + s.task.name + (byHours ? ' (estimada)' : ''))}`,
      `DESCRIPTION:${icsText(desc.join('\n'))}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(s.task.name)}`,
      `TRIGGER:-P${Math.max(0, notice - 1)}DT15H`,
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(s.task.name)}`,
      'TRIGGER:-PT15H',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
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
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
  return parseFloat(s);
}
export function num(v) {
  const n = parseNum(v);
  return Number.isFinite(n) ? n : 0;
}
export function round1(n) {
  return Math.round(n * 10) / 10;
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
