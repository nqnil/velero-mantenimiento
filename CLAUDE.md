# Notas para Claude

App PWA de mantenimiento de un velero (Jeanneau Sun Odyssey 36i 2007, Yanmar 3YM30, eje). Usuario único, en español, usa iPhone, iPad, Windows 11 y Ubuntu. Debe funcionar sin cobertura.

- Interfaz y textos en español de España, tono directo. Importes en euros, fechas `es-ES`.
- Sin compilación: módulos ES servidos desde GitHub Pages (`https://nqnil.github.io/velero-mantenimiento/`). Rutas siempre relativas.
- Cada cambio publicado: subir `VERSION` en `sw.js` y `APP_VERSION` en `js/app.js`; añadir archivos nuevos a `FILES` en `sw.js`.
- Datos: `tasks`, `interventions`, `readings`, `trips` (bitácora), `fuel` (repostajes; `tripId` si se apuntó en una navegación), `issues` (correctivos: pendiente/hecho, prioridad, área, coste igual que las intervenciones), `meta` (doc `settings`) y `photos` (dataURL JPEG/PDF < 900 KB). Modo local = IndexedDB; modo nube = Firestore `users/{uid}/{colección}` con caché persistente. Las escrituras en nube no se esperan (offline-first).
- Los `id` de `js/tasks-default.js` son estables; las intervenciones los referencian.
- Campos decimales con `type="text" inputmode="decimal"` y `parseNum()` (acepta coma decimal).
- Normativa de seguridad: bandera española aunque el barco pueda abanderarse en Polonia.
- Probar con Playwright y Chrome (`/usr/bin/google-chrome`) a 390×844 y en modo sin conexión.
- Todo lo que entra de fuera (copias importadas, nube) pasa por `sanitizeRecord()` en `js/logic.js`; todo valor en HTML va con `esc()`, también en atributos y en parámetros de la URL.
- Formularios: borrador por ruta en `sessionStorage` (sobrevive a recargas de iOS), aviso al salir con cambios, `guarded()` contra doble envío.
- Fusión de datos (importar, subir a la nube): gana el `updatedAt` más reciente.
- Preventivo (tareas periódicas, `tasks` + `interventions`) y correctivo (`issues`) son cosas distintas; ambos y los gastos se filtran por `AREAS` (`js/tasks-default.js`; el campo de la tarea sigue llamándose `system`). `AREAS_VERSION` + `migrateAreas()` reasignan áreas en datos guardados.
