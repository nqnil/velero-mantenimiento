// Datos: tareas por defecto, migraciones y fusión de datos (copias, subida a la nube).

import { DEFAULT_TASKS, AREAS_VERSION } from './tasks-default.js';
import { repo, EPOCH, settings, saveSettings, find, taskById } from './core.js';
import { sanitizeRecord } from './logic.js';
import { COLLECTIONS } from './store.js';

// Añade las tareas del catálogo que falten (también las que traigan versiones nuevas).
export async function ensureDefaults() {
  const deleted = new Set(settings().deletedDefaults || []);
  const have = new Set(repo.state.tasks.map((t) => t.id));
  for (const t of DEFAULT_TASKS) {
    if (!have.has(t.id) && !deleted.has(t.id)) await repo.put('tasks', { ...t, createdAt: EPOCH, updatedAt: EPOCH }, { touch: false });
  }
  if (!find('meta', 'settings')) {
    await saveSettings({ areasVersion: AREAS_VERSION, createdAt: EPOCH, updatedAt: EPOCH }, { touch: false });
  }
  await migrateAreas();
}

// v1.3: las tareas pasan de «sistemas» a «áreas» más finas.
// Área que tenía cada tarea predefinida antes de v1.3 (solo las que cambiaron).
const OLD_DEFAULT_AREA = {
  'c-sellados': 'casco',
  'j-firme-inspeccion': 'jarcia', 'j-firme-sustitucion': 'jarcia', 'j-labor': 'jarcia', 'j-enrollador': 'jarcia',
  'j-mayor': 'jarcia', 'j-velas': 'jarcia', 'j-winches': 'jarcia', 'j-poleas': 'jarcia', 'j-tangon': 'jarcia',
  'j-botalon': 'jarcia', 'j-spi-genaker': 'jarcia',
  'a-inodoro': 'confort', 'a-negras': 'confort', 'a-depositos-agua': 'confort', 'a-bomba-agua': 'confort', 'a-calentador': 'confort',
};

export async function migrateAreas({ force = false } = {}) {
  const version = settings().areasVersion || 1;
  if (!force && version >= AREAS_VERSION) return;
  const byId = new Map(DEFAULT_TASKS.map((t) => [t.id, t]));
  for (const t of repo.state.tasks) {
    const def = t.builtin ? byId.get(t.id) : null;
    // Solo se mueven las que siguen en su área antigua por defecto: si tú la cambiaste, se respeta
    if (def && t.system === OLD_DEFAULT_AREA[t.id] && t.system !== def.system) {
      await repo.put('tasks', { ...t, system: def.system }, { touch: false });
    }
  }
  if (version < AREAS_VERSION) await saveSettings({ areasVersion: AREAS_VERSION }, { touch: false });
}

// Fusiona datos (copia o modo local) con los actuales: añade lo que falta y
// sustituye solo lo que sea más reciente. Descarta registros no válidos.
export async function mergeData(data) {
  let written = 0, skipped = 0;
  for (const c of COLLECTIONS) {
    for (const raw of Array.isArray(data[c]) ? data[c] : []) {
      const rec = sanitizeRecord(c, raw);
      if (!rec) { skipped++; continue; }
      if (c === 'meta') { if (await mergeSettings(rec)) written++; continue; }
      const cur = find(c, rec.id);
      if (cur && (cur.updatedAt || '') >= (rec.updatedAt || '')) continue;
      await repo.put(c, rec, { touch: false });
      written++;
    }
  }
  for (const raw of Array.isArray(data.photos) ? data.photos : []) {
    const ph = sanitizeRecord('photos', raw);
    if (!ph) { skipped++; continue; }
    await repo.putPhoto(ph);
  }
  // Tareas predefinidas que se habían borrado, y áreas de versiones antiguas
  for (const id of settings().deletedDefaults || []) {
    if (taskById(id)?.builtin) await repo.del('tasks', id);
  }
  await migrateAreas({ force: true });
  return { written, skipped };
}

// Ajustes: campo a campo (gana el más reciente o el que falte) y las tareas borradas se suman
async function mergeSettings(rec) {
  const cur = find('meta', 'settings') || { id: 'settings' };
  const newer = (rec.updatedAt || '') > (cur.updatedAt || '');
  const out = { ...cur };
  let changed = false;
  for (const k of ['boatName', 'boatModel', 'engine', 'noticeHours', 'noticeDays']) {
    if (rec[k] === undefined) continue;
    if ((cur[k] === undefined || newer) && cur[k] !== rec[k]) { out[k] = rec[k]; changed = true; }
  }
  const del = [...new Set([...(cur.deletedDefaults || []), ...(rec.deletedDefaults || [])])];
  if (del.length !== (cur.deletedDefaults || []).length) { out.deletedDefaults = del; changed = true; }
  if (!changed) return false;
  if (newer) out.updatedAt = rec.updatedAt;
  await repo.put('meta', out, { touch: !newer });
  return true;
}

// Todo lo que va en una copia de seguridad. missing = fotos que no están en este dispositivo.
export async function backupData(version) {
  const photos = [];
  let missing = 0;
  for (const r of [...repo.state.interventions, ...repo.state.issues]) {
    for (const id of [...(r.photoIds || []), ...(r.problemPhotoIds || [])]) {
      const p = await repo.getPhoto(id);
      if (p) photos.push(p);
      else missing++;
    }
  }
  const data = { app: 'velero-mantenimiento', version, exportedAt: new Date().toISOString(), photos };
  for (const c of COLLECTIONS) data[c] = repo.state[c];
  return { data, missing };
}
