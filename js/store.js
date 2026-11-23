// Almacenamiento con dos modos:
//  - local: IndexedDB en este dispositivo.
//  - nube:  Firebase Firestore con caché persistente (funciona sin conexión y
//           sincroniza al recuperar cobertura). Se activa al entrar con tu cuenta.
//
// Cada barco tiene su propio espacio de datos:
//  - el barco «principal» usa los sitios de siempre (base «velero-mantenimiento»,
//    nube users/{uid}/…), así los datos anteriores a la v1.5 no se mueven;
//  - los demás, una base «velero-mantenimiento--{id}» y users/{uid}/boats/{id}/….
// La lista de barcos (colección «boats») vive en el espacio del principal.
//
// La app trabaja siempre contra `state` en memoria; los backends lo mantienen al día.

import { FIREBASE_CONFIG } from './config.js';
import { sanitizeRecord } from './logic.js';

export const COLLECTIONS = ['tasks', 'interventions', 'readings', 'trips', 'fuel', 'issues', 'meta'];
export const BOATS = 'boats';
export const PRINCIPAL = 'principal';
const DB_PREFIX = 'velero-mantenimiento';
const DB_VERSION = 4; // v2: trips y fuel; v3: issues; v4: boats
const STORES = [...COLLECTIONS, BOATS, 'photos'];

const dbName = (boatId) => (boatId === PRINCIPAL ? DB_PREFIX : `${DB_PREFIX}--${boatId}`);
const cloudBase = (uid, boatId) => (boatId === PRINCIPAL ? `users/${uid}` : `users/${uid}/boats/${boatId}`);

function cleanRows(col, rows) {
  const out = [];
  for (const r of rows) {
    const c = sanitizeRecord(col, r);
    if (c) out.push(col === 'meta' ? c : { ...r, ...c });
    else console.warn('Registro descartado por no ser válido', col, r);
  }
  return out;
}

// ───────────────────────── IndexedDB (modo local) ─────────────────────────
function openIDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const c of STORES) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si otra pestaña abre una versión nueva o borra la base de datos, cerramos y recargamos
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      reject(new Error('La app está abierta en otra pestaña o ventana con una versión anterior. Ciérrala y vuelve a abrir esta.'));
    };
  });
}

const idbReq = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Avisa a las otras pestañas abiertas de que los datos locales han cambiado
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('velero-mantenimiento') : null;

class LocalBackend {
  constructor(boatId, cols) {
    this.name = dbName(boatId);
    this.cols = cols;
  }
  async start(onData) {
    const db = await openIDB(this.name);
    if (this.stopped) { db.close(); return; } // se cerró mientras se abría
    this.db = db;
    this.onData = onData;
    await this.reload();
    this.onMessage = (e) => {
      if (e.data?.db === this.name && this.cols.includes(e.data.col)) this.reload(e.data.col);
    };
    channel?.addEventListener('message', this.onMessage);
  }
  async reload(only) {
    for (const c of only ? [only] : this.cols) this.onData(c, cleanRows(c, await this.all(c)));
  }
  all(col) {
    return idbReq(this.db.transaction(col, 'readonly').objectStore(col).getAll());
  }
  async put(col, obj) {
    await idbReq(this.db.transaction(col, 'readwrite').objectStore(col).put(obj));
    if (col !== 'photos') channel?.postMessage({ db: this.name, col });
  }
  async del(col, id) {
    await idbReq(this.db.transaction(col, 'readwrite').objectStore(col).delete(id));
    if (col !== 'photos') channel?.postMessage({ db: this.name, col });
  }
  async getPhoto(id) {
    return idbReq(this.db.transaction('photos', 'readonly').objectStore('photos').get(id));
  }
  async dump() {
    const out = {};
    for (const c of [...COLLECTIONS, 'photos']) out[c] = await this.all(c);
    return out;
  }
  async clear() {
    for (const c of [...COLLECTIONS, 'photos']) await idbReq(this.db.transaction(c, 'readwrite').objectStore(c).clear());
    for (const c of COLLECTIONS) channel?.postMessage({ db: this.name, col: c });
  }
  stop() {
    this.stopped = true;
    if (this.onMessage) channel?.removeEventListener('message', this.onMessage);
    this.db?.close();
  }
}

// Abre la base de un barco, hace algo y la cierra
async function withLocal(boatId, fn) {
  const b = new LocalBackend(boatId, []);
  await b.start(() => {});
  try {
    return await fn(b);
  } finally {
    b.stop();
  }
}

// ───────────────────────── Firestore (modo nube) ─────────────────────────
let fb = null; // módulo Firebase cargado bajo demanda
let fbAuth = null;
let fbDb = null;

export function cloudConfigured() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

async function loadFirebase() {
  if (!cloudConfigured()) return null;
  if (fb) return fb;
  fb = await import('./vendor/firebase.js');
  const app = fb.initializeApp(FIREBASE_CONFIG);
  fbAuth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence] });
  fbDb = fb.initializeFirestore(app, {
    // 300 MB de caché: que las facturas sigan disponibles sin conexión
    localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager(), cacheSizeBytes: 300 * 1024 * 1024 }),
  });
  return fb;
}

// Resuelve con el usuario guardado (también sin conexión) o null.
export async function currentUser() {
  const f = await loadFirebase();
  if (!f) return null;
  return new Promise((resolve) => {
    const unsub = f.onAuthStateChanged(fbAuth, (u) => { unsub(); resolve(u); });
  });
}

const withAuth = (fn) => async (...args) => { const f = await loadFirebase(); return fn(f, ...args); };
export const signIn = withAuth((f, email, password) => f.signInWithEmailAndPassword(fbAuth, email, password));
export const signUp = withAuth((f, email, password) => f.createUserWithEmailAndPassword(fbAuth, email, password));
export const resetPassword = withAuth((f, email) => f.sendPasswordResetEmail(fbAuth, email));
export const signOutCloud = withAuth((f) => f && f.signOut(fbAuth));

class CloudBackend {
  constructor(user, boatId, cols) {
    this.base = cloudBase(user.uid, boatId);
    this.cols = cols;
    this.unsubs = [];
  }
  path(col) {
    return `${this.base}/${col}`;
  }
  // Resuelve cuando cada colección ha dado su primera respuesta.
  // onSync recibe { pending, serverConfirmed } (confirmado = todas vinieron ya del servidor).
  start(onData, onSync = () => {}) {
    const pending = new Set();
    const confirmed = new Set();
    let firsts = 0;
    return new Promise((resolve) => {
      for (const c of this.cols) {
        let first = true;
        const done = () => {
          if (!first) return;
          first = false;
          if (++firsts === this.cols.length) resolve();
        };
        this.unsubs.push(fb.onSnapshot(
          fb.collection(fbDb, this.path(c)),
          { includeMetadataChanges: true },
          (snap) => {
            onData(c, cleanRows(c, snap.docs.map((d) => d.data())));
            if (snap.metadata.hasPendingWrites) pending.add(c); else pending.delete(c);
            if (!snap.metadata.fromCache) confirmed.add(c);
            onSync({ pending: pending.size > 0, serverConfirmed: confirmed.size === this.cols.length });
            done();
          },
          (err) => { console.error('Firestore', c, err); done(); }
        ));
      }
    });
  }
  // Las escrituras se aplican al instante en la caché local; no esperamos al servidor
  // (sin cobertura, la promesa no se resolvería hasta sincronizar).
  // La lista de barcos se escribe fusionando campos: así cambiar el nombre en un dispositivo
  // no deshace un borrado hecho en otro.
  put(col, obj) {
    fb.setDoc(fb.doc(fbDb, this.path(col), obj.id), JSON.parse(JSON.stringify(obj)), col === BOATS ? { merge: true } : {}).catch((e) => console.error(e));
    return Promise.resolve();
  }
  del(col, id) {
    fb.deleteDoc(fb.doc(fbDb, this.path(col), id)).catch((e) => console.error(e));
    return Promise.resolve();
  }
  async getPhoto(id) {
    try {
      const snap = await fb.getDoc(fb.doc(fbDb, this.path('photos'), id));
      return snap.exists() ? snap.data() : null;
    } catch {
      return null; // sin conexión y sin caché de esa foto
    }
  }
  // Borra todos los documentos de las colecciones de datos (para borrar un barco)
  async clear() {
    for (const c of [...COLLECTIONS, 'photos']) {
      const snap = await fb.getDocs(fb.collection(fbDb, this.path(c)));
      for (const d of snap.docs) this.del(c, d.id);
    }
  }
  stop() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }
}

// ───────────────────────── Repositorio ─────────────────────────
const emptyState = () => Object.fromEntries([...COLLECTIONS, BOATS].map((c) => [c, []]));

export class Repo {
  constructor() {
    this.state = emptyState();
    this.listeners = new Set();
    this.home = null; // lista de barcos
    this.data = null; // datos del barco elegido
    this.user = null;
    this.boatId = PRINCIPAL;
    this.sync = { mode: 'local', pending: false, serverConfirmed: false, boatsConfirmed: false };
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this.state, this.sync);
  }
  // mode 'local' | 'cloud' (con user). Abre la lista de barcos y el barco indicado.
  async open(mode, user, boatId) {
    this.home?.stop();
    this.data?.stop();
    this.data = null;
    this.user = user || null;
    Object.assign(this.sync, { mode, email: user?.email, pending: false, serverConfirmed: false, boatsConfirmed: mode !== 'cloud' });
    this.state = emptyState();
    const home = this.backend(PRINCIPAL, [BOATS]);
    this.home = home;
    await home.start((c, rows) => {
      if (this.home !== home) return;
      this.state[c] = rows;
      this.emit();
    }, (s) => {
      if (this.home !== home) return;
      this.sync.boatsConfirmed = s.serverConfirmed;
      this.emit();
    });
    // Un barco que ya no existe (o nunca existió aquí) no se abre: se crearía una base vacía
    const ok = boatId === PRINCIPAL || this.state[BOATS].some((b) => b.id === boatId && !b.deleted);
    await this.selectBoat(ok ? boatId : PRINCIPAL);
  }
  backend(boatId, cols) {
    return this.sync.mode === 'cloud' ? new CloudBackend(this.user, boatId, cols) : new LocalBackend(boatId, cols);
  }
  // Cambia de barco: deja de escuchar el anterior y carga el nuevo
  async selectBoat(boatId) {
    this.data?.stop();
    this.boatId = boatId;
    for (const c of COLLECTIONS) this.state[c] = [];
    // loading: mientras llegan los datos, nadie debe sacar conclusiones de un estado vacío
    Object.assign(this.sync, { pending: false, loading: true, serverConfirmed: this.sync.mode !== 'cloud' });
    const b = this.backend(boatId, COLLECTIONS);
    this.data = b;
    let started = false;
    await b.start((c, rows) => {
      if (this.data !== b) return; // respuesta tardía de un barco ya cerrado
      this.state[c] = rows;
      if (started || this.sync.mode === 'cloud') this.emit();
    }, (s) => {
      if (this.data !== b) return;
      Object.assign(this.sync, s);
      this.emit();
    });
    started = true;
    if (this.data === b) this.sync.loading = false;
    this.emit();
  }
  target(col) {
    return col === BOATS ? this.home : this.data;
  }
  // Escritura optimista: actualiza el estado en memoria y persiste.
  // touch=false conserva la fecha de modificación (al importar o fusionar datos)
  async put(col, obj, { touch = true } = {}) {
    if (touch || !obj.updatedAt) obj.updatedAt = new Date().toISOString();
    const arr = this.state[col];
    const idx = arr.findIndex((x) => x.id === obj.id);
    if (idx >= 0) arr[idx] = obj;
    else arr.push(obj);
    this.emit();
    await this.target(col).put(col, obj);
  }
  async del(col, id) {
    this.state[col] = this.state[col].filter((x) => x.id !== id);
    this.emit();
    await this.target(col).del(col, id);
  }
  putPhoto(p) {
    return this.data.put('photos', p);
  }
  async getPhoto(id) {
    const p = await this.data.getPhoto(id);
    return p ? sanitizeRecord('photos', p) : null;
  }
  delPhoto(id) {
    return this.data.del('photos', id);
  }
  // Borra todos los datos de un barco (que no sea el abierto)
  async clearBoat(boatId) {
    if (this.sync.mode === 'cloud') return new CloudBackend(this.user, boatId, []).clear();
    if (boatId === PRINCIPAL) return withLocal(boatId, (b) => b.clear());
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(dbName(boatId));
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
}

// ───────────────────────── Modo local → nube ─────────────────────────
// Barcos con datos en el modo local de este dispositivo (para subirlos a la cuenta)
export function readLocalBoats() {
  return withLocal(PRINCIPAL, (b) => b.all(BOATS));
}
export function readLocalDump(boatId = PRINCIPAL) {
  return withLocal(boatId, (b) => b.dump());
}
// Vacía el modo local de un barco (después de subir sus datos a la cuenta)
export function clearLocalData(boatId = PRINCIPAL) {
  return withLocal(boatId, async (b) => {
    await b.clear();
    if (boatId === PRINCIPAL) for (const x of await b.all(BOATS)) await b.del(BOATS, x.id);
  });
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
