// Almacenamiento con dos modos:
//  - local: IndexedDB en este dispositivo.
//  - nube:  Firebase Firestore con caché persistente (funciona sin conexión y
//           sincroniza al recuperar cobertura). Se activa al entrar con tu cuenta.
//
// La app trabaja siempre contra `state` en memoria; el backend lo mantiene al día.

import { FIREBASE_CONFIG } from './config.js';

export const COLLECTIONS = ['tasks', 'interventions', 'readings', 'meta'];
const DB_NAME = 'velero-mantenimiento';
const DB_VERSION = 1;

// ───────────────────────── IndexedDB (modo local) ─────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const c of [...COLLECTIONS, 'photos']) {
        if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class LocalBackend {
  constructor() {
    this.kind = 'local';
  }
  async start(onData) {
    this.db = await openIDB();
    this.onData = onData;
    for (const c of COLLECTIONS) {
      const tx = this.db.transaction(c, 'readonly');
      const rows = await idbReq(tx.objectStore(c).getAll());
      onData(c, rows);
    }
    return { fresh: true };
  }
  async put(col, obj) {
    const tx = this.db.transaction(col, 'readwrite');
    await idbReq(tx.objectStore(col).put(obj));
  }
  async del(col, id) {
    const tx = this.db.transaction(col, 'readwrite');
    await idbReq(tx.objectStore(col).delete(id));
  }
  async putPhoto(photo) {
    return this.put('photos', photo);
  }
  async getPhoto(id) {
    const tx = this.db.transaction('photos', 'readonly');
    return idbReq(tx.objectStore('photos').get(id));
  }
  async delPhoto(id) {
    return this.del('photos', id);
  }
  async dumpAll() {
    const out = {};
    for (const c of [...COLLECTIONS, 'photos']) {
      const tx = this.db.transaction(c, 'readonly');
      out[c] = await idbReq(tx.objectStore(c).getAll());
    }
    return out;
  }
  stop() {}
}

// ───────────────────────── Firestore (modo nube) ─────────────────────────
let fb = null; // módulo Firebase cargado bajo demanda
let fbApp = null;
let fbAuth = null;
let fbDb = null;

export function cloudConfigured() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

export async function loadFirebase() {
  if (!cloudConfigured()) return null;
  if (fb) return fb;
  fb = await import('./vendor/firebase.js');
  fbApp = fb.initializeApp(FIREBASE_CONFIG);
  fbAuth = fb.initializeAuth(fbApp, {
    persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence],
  });
  fbDb = fb.initializeFirestore(fbApp, {
    localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
  });
  return fb;
}

// Resuelve con el usuario guardado (también sin conexión) o null.
export async function currentUser() {
  const f = await loadFirebase();
  if (!f) return null;
  return new Promise((resolve) => {
    const unsub = f.onAuthStateChanged(fbAuth, (u) => {
      unsub();
      resolve(u);
    });
  });
}

export async function signIn(email, password) {
  const f = await loadFirebase();
  return f.signInWithEmailAndPassword(fbAuth, email, password);
}
export async function signUp(email, password) {
  const f = await loadFirebase();
  return f.createUserWithEmailAndPassword(fbAuth, email, password);
}
export async function resetPassword(email) {
  const f = await loadFirebase();
  return f.sendPasswordResetEmail(fbAuth, email);
}
export async function signOutCloud() {
  const f = await loadFirebase();
  if (f) await f.signOut(fbAuth);
}

class CloudBackend {
  constructor(user) {
    this.kind = 'cloud';
    this.user = user;
    this.unsubs = [];
    this.pending = new Set();
    this.onSync = () => {};
  }
  path(col) {
    return `users/${this.user.uid}/${col}`;
  }
  // Resuelve cuando cada colección ha dado su primera respuesta.
  // fresh = true si al menos una vino del servidor (no solo de la caché).
  start(onData) {
    const f = fb;
    let firstCount = 0;
    let fresh = false;
    let serverConfirmed = new Set();
    return new Promise((resolve) => {
      const maybeResolve = () => {
        if (firstCount === COLLECTIONS.length) resolve({ fresh });
      };
      for (const c of COLLECTIONS) {
        let first = true;
        const unsub = f.onSnapshot(
          f.collection(fbDb, this.path(c)),
          { includeMetadataChanges: true },
          (snap) => {
            onData(
              c,
              snap.docs.map((d) => d.data())
            );
            if (snap.metadata.hasPendingWrites) this.pending.add(c);
            else this.pending.delete(c);
            if (!snap.metadata.fromCache) serverConfirmed.add(c);
            this.onSync({
              pending: this.pending.size > 0,
              fromCache: snap.metadata.fromCache,
              serverConfirmed: serverConfirmed.size === COLLECTIONS.length,
            });
            if (first) {
              first = false;
              if (!snap.metadata.fromCache) fresh = true;
              firstCount++;
              maybeResolve();
            }
          },
          (err) => {
            console.error('Firestore', c, err);
            if (first) {
              first = false;
              firstCount++;
              maybeResolve();
            }
          }
        );
        this.unsubs.push(unsub);
      }
    });
  }
  // Las escrituras se aplican al instante en la caché local; no esperamos al servidor
  // (sin cobertura, la promesa no se resolvería hasta sincronizar).
  put(col, obj) {
    fb.setDoc(fb.doc(fbDb, this.path(col), obj.id), clean(obj)).catch((e) => console.error(e));
    return Promise.resolve();
  }
  del(col, id) {
    fb.deleteDoc(fb.doc(fbDb, this.path(col), id)).catch((e) => console.error(e));
    return Promise.resolve();
  }
  putPhoto(photo) {
    return this.put('photos', photo);
  }
  async getPhoto(id) {
    try {
      const snap = await fb.getDoc(fb.doc(fbDb, this.path('photos'), id));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      return null; // sin conexión y sin caché de esa foto
    }
  }
  delPhoto(id) {
    return this.del('photos', id);
  }
  async dumpAll() {
    throw new Error('dumpAll no se usa en modo nube');
  }
  stop() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }
}

// Firestore no admite undefined
function clean(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ───────────────────────── Repositorio ─────────────────────────
export class Repo {
  constructor() {
    this.state = { tasks: [], interventions: [], readings: [], meta: [] };
    this.listeners = new Set();
    this.backend = null;
    this.sync = { mode: 'local', pending: false, online: navigator.onLine };
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this.state, this.sync);
  }
  async useLocal() {
    if (this.backend) this.backend.stop();
    this.backend = new LocalBackend();
    this.sync.mode = 'local';
    this.sync.pending = false;
    const r = await this.backend.start((c, rows) => {
      this.state[c] = rows;
    });
    this.emit();
    return r;
  }
  async useCloud(user) {
    if (this.backend) this.backend.stop();
    const b = new CloudBackend(user);
    this.backend = b;
    this.sync.mode = 'cloud';
    this.sync.email = user.email;
    b.onSync = (s) => {
      this.sync.pending = s.pending;
      this.sync.serverConfirmed = s.serverConfirmed;
      this.emit();
    };
    const r = await b.start((c, rows) => {
      this.state[c] = rows;
      this.emit();
    });
    this.emit();
    return r;
  }
  // Escritura optimista: actualiza el estado en memoria y persiste.
  async put(col, obj) {
    obj.updatedAt = new Date().toISOString();
    const arr = this.state[col];
    const idx = arr.findIndex((x) => x.id === obj.id);
    if (idx >= 0) arr[idx] = obj;
    else arr.push(obj);
    this.emit();
    await this.backend.put(col, obj);
  }
  async del(col, id) {
    this.state[col] = this.state[col].filter((x) => x.id !== id);
    this.emit();
    await this.backend.del(col, id);
  }
  putPhoto(p) {
    return this.backend.putPhoto(p);
  }
  getPhoto(id) {
    return this.backend.getPhoto(id);
  }
  delPhoto(id) {
    return this.backend.delPhoto(id);
  }
}

// Datos guardados en el modo local de este dispositivo (para subirlos a la nube)
export async function readLocalDump() {
  const b = new LocalBackend();
  await b.start(() => {});
  return b.dumpAll();
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
