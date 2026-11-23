# Mantenimiento del velero

Cuaderno de bitácora y de mantenimiento para un Jeanneau Sun Odyssey 36i (2007) con motor Yanmar 3YM30. Registra navegaciones, repostajes e intervenciones (fecha, horas de motor, notas, coste, facturas) y avisa cuando toca el siguiente mantenimiento, por horas o por fecha.

- Funciona **sin cobertura**: se instala en la pantalla de inicio y guarda los datos en el dispositivo.
- **Sincroniza** iPhone, iPad y ordenador cuando hay conexión (con Firebase, ver más abajo).
- Avisos al abrir la app y **exportación al calendario** (.ics) con alarmas.
- Unas 70 tareas predefinidas (motor, eje, casco, jarcia, seguridad, documentación…), todas editables. Los plazos de seguridad y documentación siguen la bandera española (RD 339/2021 y RD 1434/1999).

Dirección de la app: **https://nqnil.github.io/velero-mantenimiento/**

---

## 1. Publicar la app (una sola vez)

1. En GitHub, abre el repositorio → **Settings** → **Pages**.
2. En *Build and deployment*, *Source*: **Deploy from a branch**. Rama **main**, carpeta **/ (root)**. Pulsa **Save**.
3. En uno o dos minutos la app estará en la dirección de arriba.

## 2. Instalarla

**iPhone y iPad:** abre la dirección en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**. Ábrela siempre desde ese icono.

**Windows y Ubuntu:** abre la dirección en **Chrome** o **Edge** → icono de instalar en la barra de direcciones (o menú → *Instalar aplicación*).

## 3. Sincronización entre dispositivos (Firebase, gratis)

Hasta que esto esté hecho, cada dispositivo guarda sus propios datos.

1. Entra en <https://console.firebase.google.com> con una cuenta de Google y crea un proyecto (por ejemplo `velero`). Google Analytics no hace falta.
2. **Authentication** → *Comenzar* → *Método de acceso* → activa **Correo electrónico/contraseña**.
3. **Authentication** → *Configuración* → *Dominios autorizados* → añade `nqnil.github.io`.
4. **Firestore Database** → *Crear base de datos* → modo **producción**, ubicación en Europa (por ejemplo `europe-southwest1`, Madrid).
5. **Firestore Database** → *Reglas* → sustituye el contenido por el de [`firestore.rules`](firestore.rules) → *Publicar*.
6. **Configuración del proyecto** (rueda dentada) → *Tus apps* → icono **Web** `</>` → registra la app (sin Firebase Hosting) → copia el bloque `firebaseConfig`.
7. Pega esos valores en [`js/config.js`](js/config.js) (o pásaselos a Claude para que lo haga) y sube la versión en `sw.js`.

Después, en cada dispositivo: **Ajustes → Sincronización** → *Crear cuenta* (la primera vez) o *Entrar*. Si el dispositivo ya tenía datos, la app ofrece subirlos a tu cuenta.

Los valores de `firebaseConfig` no son secretos: lo que protege tus datos es el inicio de sesión y las reglas, que solo dejan a cada usuario ver lo suyo. El plan gratuito de Firebase sobra para este uso.

## 4. Uso

- **Estado**: contador de horas de motor y tareas vencidas o próximas. Con dos o más lecturas la app estima en qué fecha tocará cada tarea por horas.
- **Bitácora**: cada salida (fechas, puertos, horas de motor al salir y al volver, millas, tripulación, viento y mar, notas y, si echaste, combustible). Las horas que apuntas aquí actualizan el contador.
- **Repostaje**: combustible en surtidor o con garrafas, aunque no muevas el barco. Cuenta como gasto y, marcando «depósito lleno», calcula el consumo medio del motor (L/h).
- **Registrar**: fecha, horas, tareas hechas, quién lo hizo. Si lo haces tú, anotas el material; si es un taller, el total y la foto o PDF de la factura. En tareas de caducidad (balsa, bengalas, extintores, ITB…) anota la fecha de la etiqueta.
- **Trabajos**: *Correctivos* (cosas que hay que arreglar, con prioridad urgente/alta/media/baja; al hacerlas se apunta el trabajo y el coste) y *Preventivos* (tareas periódicas). Se filtran por área del barco.
- **Historial**: preventivo, correctivo y combustible, con el gasto por año y por área.
- **Tareas preventivas** (en Trabajos): cambia intervalos y avisos, desactiva lo que no lleves o crea tareas nuevas.
- **Ajustes** (engranaje): exportar al calendario, sincronización, copia de seguridad.
- **Varios barcos**: toca el nombre del barco arriba para cambiar de barco o añadir otro. Cada uno lleva sus propias tareas, horas, bitácora y gastos.
- **Cambio de motor**: en *Horas de motor → Cambio de motor* pones el contador a cero (o a lo que marque el nuevo). Las tareas por horas empiezan a contar desde el cambio.

## 5. Para mantener el proyecto

- Sin paso de compilación: HTML, CSS y JavaScript (módulos ES) servidos tal cual.
- Al cambiar cualquier archivo, sube `VERSION` en `sw.js` (y `APP_VERSION` en `js/app.js`) para que los dispositivos descarguen la versión nueva; la app muestra un aviso «Actualizar».
- `js/tasks-default.js`: catálogo de tareas. Las tareas nuevas que añadas aquí aparecen solas en los dispositivos. No cambies los `id` existentes.
- `js/logic.js`: cálculo de vencimientos y calendario. `js/store.js`: almacenamiento local (IndexedDB) y en la nube (Firestore con caché sin conexión). `js/app.js`: pantallas.
- `js/vendor/firebase.js` es el SDK de Firebase empaquetado; se regenera con `tools/build-firebase.sh`.
- Para probar en local: `python3 -m http.server` en esta carpeta y abrir <http://localhost:8000>.
