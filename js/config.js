// Configuración de Firebase para sincronizar entre dispositivos.
// Mientras sea null, la app funciona solo en este dispositivo.
// Pasos para obtenerla: ver README.md, apartado «Sincronización».
//
// Estos valores no son secretos: la protección de tus datos la dan
// el inicio de sesión y las reglas de firestore.rules.

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCcpAB0fyBjzLSa0AOva5NTTYNqWVyd3b8',
  authDomain: 'velero-888db.firebaseapp.com',
  projectId: 'velero-888db',
  storageBucket: 'velero-888db.firebasestorage.app',
  messagingSenderId: '92210616618',
  appId: '1:92210616618:web:cc33503663ffd7dfc92653',
};

// Ejemplo de cómo quedará:
// export const FIREBASE_CONFIG = {
//   apiKey: 'AIza...',
//   authDomain: 'velero-xxxx.firebaseapp.com',
//   projectId: 'velero-xxxx',
//   storageBucket: 'velero-xxxx.appspot.com',
//   messagingSenderId: '1234567890',
//   appId: '1:1234567890:web:abcdef',
// };
