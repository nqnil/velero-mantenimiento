// Ajustes: barco, avisos, calendario, sincronización y copias de seguridad.

import { DEFAULT_SETTINGS } from '../tasks-default.js';
import { repo, esc, toast, go, render, settings, saveSettings, savedBoat, boats, APP_VERSION } from '../core.js';
import { todayStr, allStatuses, buildICS } from '../logic.js';
import {
  cloudConfigured, signIn, signUp, resetPassword, signOutCloud, readLocalBoats, readLocalDump, clearLocalData, PRINCIPAL, BOATS, COLLECTIONS,
} from '../store.js';
import { check, optNumber, bindPlainForm, formSaved } from '../forms.js';
import { mergeData, backupData, syncBoatEntry, prepareBoat } from '../data.js';

export function viewSettings() {
  const st = settings();
  const s = repo.sync;
  let syncHtml;
  if (!cloudConfigured()) {
    syncHtml = `<p>La sincronización entre dispositivos aún no está configurada. Mientras tanto, los datos se guardan solo en este dispositivo. Haz copias de seguridad de vez en cuando.</p>`;
  } else if (s.mode === 'cloud') {
    syncHtml = `<p>Conectado como <strong>${esc(s.email || '')}</strong>. Tus datos se guardan en este dispositivo y se sincronizan con tus otros dispositivos cuando hay conexión.</p>
      <p class="muted">${navigator.onLine ? (s.pending ? 'Hay cambios pendientes de subir.' : 'Todo sincronizado.') : 'Ahora mismo sin conexión.'}</p>
      <button class="btn" data-action="signout">Cerrar sesión en este dispositivo</button>`;
  } else {
    syncHtml = `<p>Entra con tu cuenta para tener los mismos datos en el móvil, la tablet y el ordenador. La primera vez en cada dispositivo necesitas conexión.</p>
      <form id="login-form" class="form">
        <label>Correo<input type="email" name="email" autocomplete="username" required></label>
        <label>Contraseña<input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <p class="form-error" id="login-error" role="alert" hidden></p>
        <div class="actions">
          <button class="btn primary" type="submit" name="op" value="in">Entrar</button>
          <button class="btn" type="submit" name="op" value="up">Crear cuenta</button>
          <button class="btn link" type="button" data-action="reset-pw">He olvidado la contraseña</button>
        </div>
      </form>`;
  }
  const numField = (name, label) => `<label>${label}<input type="number" name="${name}" min="0" step="1" inputmode="numeric" value="${esc(st[name])}"></label>`;
  return `
  <h1>Ajustes</h1>
  <div class="actions"><a class="btn" href="#/barcos">Barcos</a><a class="btn" href="#/trabajos?tipo=preventivos">Tareas de mantenimiento e intervalos</a><a class="btn" href="#/horas">Horas de motor</a></div>
  <section>
    <h2>Avisos en el calendario</h2>
    <p>Descarga un archivo con las próximas fechas de mantenimiento (24 meses) y ábrelo para añadirlo al calendario. Cada evento lleva dos avisos: con la antelación de la tarea y el día antes.</p>
    <p class="hint">En iPhone y iPad, al abrirlo elige «Añadir todo» y un calendario propio (por ejemplo «Velero»). Para actualizarlo más adelante, borra ese calendario y vuelve a importar.</p>
    <button class="btn primary" data-action="export-ics">Exportar al calendario</button>
  </section>

  <section>
    <h2>Sincronización</h2>
    ${syncHtml}
  </section>

  <form id="settings-form" class="form">
    <h2>Barco abierto</h2>
    <label>Nombre<input type="text" name="boatName" value="${esc(st.boatName)}"></label>
    <label>Modelo<input type="text" name="boatModel" value="${esc(st.boatModel)}"></label>
    <label>Motor<input type="text" name="engine" value="${esc(st.engine)}"></label>
    <h2>Aviso por defecto</h2>
    <p class="hint">Una tarea pasa a «Toca pronto» cuando le quedan estas horas o estos días. Cada tarea puede tener el suyo.</p>
    <div class="grid2">${numField('noticeHours', 'Horas antes')}${numField('noticeDays', 'Días antes')}</div>
    <p class="form-error" role="alert" hidden></p>
    <div class="actions"><button class="btn primary" type="submit">Guardar ajustes</button></div>
  </form>

  <section>
    <h2>Copia de seguridad</h2>
    <p>Un archivo con todas las tareas, intervenciones, correctivos, navegaciones, lecturas y facturas de <strong>${esc(st.boatName)}</strong>. Al importar una copia, se añade al barco abierto. Guárdala en iCloud Drive o en tu ordenador.</p>
    <div class="actions">
      <button class="btn" data-action="export-json">Exportar copia</button>
      <label class="btn file"><span>Importar copia</span><input type="file" id="import-input" class="sr" accept="application/json,.json"></label>
    </div>
  </section>

  <section class="about">
    <h2>Acerca de</h2>
    <p>Versión ${APP_VERSION}. Los plazos de seguridad y documentación siguen la normativa de bandera española (RD 339/2021 y RD 1434/1999). Si cambias de bandera, revisa esas tareas.</p>
    <button class="btn link" data-action="check-update">Buscar actualización</button>
  </section>`;
}

async function saveBoat(form) {
  const fd = new FormData(form);
  const nh = optNumber(fd.get('noticeHours'), 'Los avisos deben ser números (horas y días).');
  const nd = optNumber(fd.get('noticeDays'), 'Los avisos deben ser números (horas y días).');
  check(nh !== null && nd !== null, 'Los avisos deben ser números (horas y días).');
  const text = (k) => String(fd.get(k) || '').trim();
  const name = text('boatName') || DEFAULT_SETTINGS.boatName;
  check(!boats().some((b) => b.id !== repo.boatId && b.name.toLowerCase() === name.toLowerCase()), 'Ya tienes otro barco con ese nombre.');
  await saveSettings({
    boatName: name,
    boatModel: text('boatModel'),
    engine: text('engine'),
    noticeHours: Math.round(nh),
    noticeDays: Math.round(nd),
  });
  await syncBoatEntry();
  formSaved();
  toast('Ajustes guardados');
}

export function bindSettings() {
  bindPlainForm('settings-form', saveBoat);
  const login = document.getElementById('login-form');
  login?.addEventListener('click', (e) => {
    const b = e.target.closest('button[type=submit]');
    if (b) login.dataset.op = b.value;
  });
  login?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (login.dataset.busy) return;
    const fd = new FormData(login);
    const op = e.submitter?.value || login.dataset.op || 'in';
    const errEl = document.getElementById('login-error');
    errEl.hidden = true;
    login.dataset.busy = '1';
    try {
      const cred = await (op === 'up' ? signUp : signIn)(fd.get('email'), fd.get('password'));
      await switchToCloud(cred.user);
    } catch (err) {
      errEl.textContent = authError(err);
      errEl.hidden = false;
    } finally {
      delete login.dataset.busy;
    }
  });
  document.getElementById('import-input').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importBackup(f);
  });
}

function authError(err) {
  const code = err?.code || '';
  if (/invalid-credential|wrong-password|user-not-found/.test(code)) return 'Correo o contraseña incorrectos.';
  if (code.includes('email-already-in-use')) return 'Ya existe una cuenta con ese correo. Usa «Entrar».';
  if (code.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (code.includes('invalid-email')) return 'El correo no es válido.';
  if (code.includes('network')) return 'Sin conexión. Para entrar la primera vez necesitas cobertura.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos.';
  return 'No se ha podido entrar: ' + (err?.message || code);
}

// ───────────────────────── Nube ─────────────────────────
// Al entrar en la cuenta, ofrece subir lo guardado sin cuenta en este dispositivo
// (todos los barcos). Si algo ya está en la cuenta, gana la versión más reciente.
async function switchToCloud(user) {
  const localBoats = (await readLocalBoats()).filter((b) => !b.deleted);
  const ids = [...new Set([PRINCIPAL, ...localBoats.map((b) => b.id)])];
  const dumps = {};
  for (const id of ids) dumps[id] = await readLocalDump(id);
  const count = (k) => ids.reduce((n, id) => n + dumps[id][k].length, 0);
  const hasLocal = ['interventions', 'readings', 'trips', 'fuel', 'issues'].some((k) => count(k));
  localStorage.setItem('velero.mode', 'cloud');
  await repo.open('cloud', user, PRINCIPAL);
  const boatsText = ids.length > 1 ? ` de ${ids.length} barcos` : '';
  if (hasLocal && confirm(`Este dispositivo tiene datos guardados sin cuenta${boatsText} (${count('interventions')} intervenciones, ${count('issues')} correctivos, ${count('trips')} navegaciones, ${count('fuel')} repostajes y ${count('readings')} lecturas). ¿Subirlos a tu cuenta? Si algo ya está en la cuenta, se conserva la versión más reciente.`)) {
    await waitFor((s) => s.boatsConfirmed, 10000);
    for (const b of localBoats) {
      const cur = repo.state[BOATS].find((x) => x.id === b.id);
      if (!cur || (cur.updatedAt || '') < (b.updatedAt || '')) await repo.put(BOATS, b, { touch: false });
    }
    let written = 0;
    for (const id of ids) {
      if (!COLLECTIONS.some((c) => dumps[id][c].length)) continue;
      await repo.selectBoat(id);
      await waitFor((s) => s.serverConfirmed, 10000);
      written += (await mergeData(dumps[id])).written;
    }
    for (const id of ids) await clearLocalData(id); // ya están en la cuenta: que no se vuelvan a ofrecer ni a mezclar
    toast(`Datos subidos a tu cuenta (${written} registros)`);
  }
  const target = savedBoat('cloud');
  if (repo.boatId !== target && boats().some((b) => b.id === target)) await repo.selectBoat(target);
  await prepareBoat();
  render(true);
}

// Espera a que se cumpla algo del estado de sincronización (o se agote el tiempo)
function waitFor(cond, ms) {
  return new Promise((resolve) => {
    if (cond(repo.sync)) return resolve(true);
    const t = setTimeout(() => { off(); resolve(false); }, ms);
    const off = repo.onChange((_, sync) => {
      if (cond(sync)) { clearTimeout(t); off(); resolve(true); }
    });
  });
}

// ───────────────────────── Exportar e importar ─────────────────────────
async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Ese archivo no es una copia válida.');
    return;
  }
  if (!data || typeof data !== 'object' || data.app !== 'velero-mantenimiento') { toast('Ese archivo no es una copia de esta app.'); return; }
  const len = (k) => (Array.isArray(data[k]) ? data[k].length : 0);
  if (!confirm(`La copia tiene ${len('interventions')} intervenciones, ${len('issues')} correctivos, ${len('trips')} navegaciones y ${len('fuel')} repostajes. Se añadirá lo que falte y se actualizará lo que en la copia sea más reciente. ¿Continuar?`)) return;
  toast('Importando…');
  try {
    const sameBoat = (data.boatId || PRINCIPAL) === repo.boatId;
    const res = await mergeData(data, { sameBoat });
    toast(`Copia importada (${res.written} registros).${res.skipped ? ` ${res.skipped} no eran válidos y se han descartado.` : ''}`);
  } catch (e) {
    console.error(e);
    toast('La importación se ha detenido por un error: ' + e.message);
  }
  go('#/');
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      // El permiso del toque ha caducado mientras se preparaba el archivo: pedir otro toque
      if (e.name === 'NotAllowedError') { offerShare(file, title); return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function offerShare(file, title) {
  document.getElementById('sharebar')?.remove();
  const bar = Object.assign(document.createElement('div'), { id: 'sharebar', className: 'sharebar' });
  bar.innerHTML = `<span>El archivo está listo.</span><button class="btn small primary" type="button">Compartir</button><button class="btn small" type="button">Cerrar</button>`;
  const [share, close] = bar.querySelectorAll('button');
  share.addEventListener('click', () => navigator.share({ files: [file], title }).catch(() => {}).finally(() => bar.remove()));
  close.addEventListener('click', () => bar.remove());
  document.body.appendChild(bar);
  share.focus();
}

// ───────────────────────── Acciones ─────────────────────────
export const actions = {
  'export-ics': async () => {
    const st = settings();
    const ics = buildICS(allStatuses(repo.state, st), st, { boatId: repo.boatId });
    if (!ics.includes('BEGIN:VEVENT')) { toast('No hay fechas próximas: registra antes alguna intervención.'); return; }
    await shareOrDownload(new Blob([ics], { type: 'text/calendar' }), 'mantenimiento-velero.ics', 'Mantenimiento del velero');
  },
  'export-json': async () => {
    const { data, missing } = await backupData(APP_VERSION);
    if (missing) toast(`Atención: ${missing} ${missing === 1 ? 'foto o factura no está' : 'fotos o facturas no están'} en este dispositivo y no van en la copia. Hazla con conexión.`);
    const slug = settings().boatName.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'velero';
    await shareOrDownload(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${slug}-copia-${todayStr()}.json`, `Copia de seguridad de ${settings().boatName}`);
  },
  signout: async () => {
    if (!confirm('¿Cerrar sesión en este dispositivo? Tus datos siguen en tu cuenta.')) return;
    await signOutCloud();
    localStorage.setItem('velero.mode', 'local');
    await repo.open('local', null, savedBoat('local'));
    if (!boats().some((b) => b.id === repo.boatId)) await repo.selectBoat(PRINCIPAL);
    await prepareBoat();
    render(true);
  },
  'reset-pw': async () => {
    const email = document.querySelector('#login-form [name=email]')?.value;
    if (!email) { toast('Escribe primero tu correo.'); return; }
    try { await resetPassword(email); toast('Te hemos enviado un correo para cambiarla.'); }
    catch (err) { toast(authError(err)); }
  },
  'check-update': async () => {
    if (!navigator.onLine) { toast('Sin conexión: no se puede buscar ahora.'); return; }
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return;
    try { await reg.update(); } catch { toast('No se ha podido comprobar. Inténtalo más tarde.'); return; }
    toast(reg.installing || reg.waiting ? 'Hay una versión nueva: pulsa «Actualizar» arriba.' : 'Tienes la última versión.');
  },
  'apply-update': async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.waiting?.postMessage('skipWaiting');
  },
};
