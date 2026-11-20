// Catálogo inicial de tareas para un Jeanneau Sun Odyssey 36i (2007)
// con Yanmar 3YM30, transmisión por eje, mayor clásica, enrollador de génova,
// molinete eléctrico, piloto, calentador, placas solares, calefacción diésel,
// tangón de spi y botalón de génaker.
//
// Intervalos: manual Yanmar y práctica habitual (motor y equipos) y normativa
// de bandera española (RD 339/2021, RD 1434/1999) para seguridad y documentación.
// Todo es editable desde la app.
//
// type: "intervalo" -> próxima = última + intervalo (horas y/o meses, lo que llegue antes)
//       "caducidad" -> próxima = fecha de caducidad/revisión que anotas al registrar
//                      (si no la anotas, se usa última + meses)
//
// Los id son estables: no cambiarlos (las intervenciones los referencian).

// Áreas del barco: sirven para filtrar preventivos, correctivos y gastos.
// Los id son estables (las tareas y los correctivos los guardan).
export const AREAS = [
  { id: 'casco', name: 'Casco y obra viva' },
  { id: 'cubierta', name: 'Cubierta y herrajes' },
  { id: 'jarcia-firme', name: 'Jarcia firme y palo' },
  { id: 'jarcia-labor', name: 'Jarcia de labor y maniobra' },
  { id: 'velas', name: 'Velas' },
  { id: 'motor', name: 'Motor' },
  { id: 'transmision', name: 'Transmisión y hélice' },
  { id: 'gobierno', name: 'Gobierno y piloto' },
  { id: 'fondeo', name: 'Fondeo y molinete' },
  { id: 'electricidad', name: 'Electricidad y electrónica' },
  { id: 'agua', name: 'Agua y aseo' },
  { id: 'confort', name: 'Cocina, gas y calefacción' },
  { id: 'interior', name: 'Interior' },
  { id: 'seguridad', name: 'Seguridad' },
  { id: 'documentacion', name: 'Documentación' },
  { id: 'otros', name: 'Otros' },
];
// Nombre antiguo, por compatibilidad
export const SYSTEMS = AREAS;

// Versión del reparto de tareas por áreas (para migrar datos guardados)
export const AREAS_VERSION = 2;

export const PRIORITIES = [
  { id: 'urgente', name: 'Urgente', hint: 'No salir a navegar sin arreglarlo' },
  { id: 'alta', name: 'Alta', hint: 'Antes de la próxima salida larga' },
  { id: 'media', name: 'Media', hint: 'Cuando se pueda' },
  { id: 'baja', name: 'Baja', hint: 'Mejora o detalle' },
];

const t = (id, system, name, intervalHours, intervalMonths, extra = {}) => ({
  id,
  system,
  name,
  type: 'intervalo',
  intervalHours: intervalHours ?? null,
  intervalMonths: intervalMonths ?? null,
  noticeHours: null, // null = usar el aviso por defecto de Ajustes
  noticeDays: null,
  active: true,
  notes: '',
  builtin: true,
  ...extra,
});

const exp = (id, system, name, intervalMonths, extra = {}) =>
  t(id, system, name, null, intervalMonths, { type: 'caducidad', ...extra });

export const DEFAULT_TASKS = [
  // ── Motor Yanmar 3YM30 ──────────────────────────────────────────────
  t('m-aceite', 'motor', 'Aceite del motor y filtro de aceite', 250, 12, {
    notes: 'Manual Yanmar: cada 250 h o anual. Filtro de aceite habitual del 3YM: Yanmar 119305-35151 (compruébalo con tu recambista).',
  }),
  t('m-filtro-gasoil', 'motor', 'Filtro de gasoil del motor', 250, 12, {
    notes: 'Filtro habitual del 3YM: Yanmar 104500-55710 (compruébalo). Purgar el circuito después.',
  }),
  t('m-decantador-purga', 'motor', 'Prefiltro decantador: purgar agua', 50, 6, {
    notes: 'Revisar el vaso y purgar el agua y los lodos acumulados.',
  }),
  t('m-decantador-elemento', 'motor', 'Prefiltro decantador: cambiar elemento', 250, 12),
  t('m-filtro-agua-salada', 'motor', 'Filtro de agua salada: limpiar', 50, 6, {
    notes: 'Revisar también la junta de la tapa y que no entre aire.',
  }),
  t('m-impulsor', 'motor', 'Rodete (impulsor) de la bomba de agua salada', null, 24, {
    notes: 'Rodete habitual del 3YM: Yanmar 128990-42200 (compruébalo). Lleva siempre uno de respeto y recupera las aletas si se rompe.',
  }),
  t('m-refrigerante', 'motor', 'Refrigerante: cambiar', 1000, 24, {
    notes: 'Revisar el nivel a menudo. Ajusta el intervalo al tipo de refrigerante (estándar o de larga duración) según tu manual.',
  }),
  t('m-correa-revisar', 'motor', 'Correa del alternador: revisar tensión y estado', 250, 12),
  t('m-correa-cambiar', 'motor', 'Correa del alternador: sustituir', 1000, 36, {
    notes: 'Lleva una de respeto a bordo.',
  }),
  t('m-anodo-intercambiador', 'motor', 'Ánodo de zinc del intercambiador', 250, 12),
  t('m-filtro-aire', 'motor', 'Filtro / silenciador de admisión: limpiar', 250, 12),
  t('m-valvulas', 'motor', 'Holgura de válvulas: comprobar y ajustar', 1000, null),
  t('m-inyectores', 'motor', 'Inyectores: revisar y tarar', 1000, null),
  t('m-codo-escape', 'motor', 'Codo de escape (mezclador): inspeccionar', 1000, 60, {
    notes: 'En un motor de 2007 es pieza crítica: se obstruye por carbonilla y se corroe.',
  }),
  t('m-mangueras', 'motor', 'Mangueras, abrazaderas y soportes del motor', null, 12),
  t('m-deposito-gasoil', 'motor', 'Depósito de gasoil: revisar agua, lodos y bacterias', null, 24),
  t('m-invernaje', 'motor', 'Invernaje del motor', null, 12, {
    active: false,
    notes: 'Actívala si dejas el barco parado en invierno.',
  }),

  // ── Transmisión por eje ─────────────────────────────────────────────
  t('t-aceite-inversor', 'transmision', 'Aceite del inversor', 250, 12),
  t('t-prensaestopas', 'transmision', 'Prensaestopas: revisar goteo y estado', null, 12, {
    notes: 'Si es de empaquetadura: ajustar o cambiar la estopa. Si es de tipo seco/labial: revisar el fuelle y sustituirlo según el fabricante.',
  }),
  t('t-casquillo', 'transmision', 'Casquillo (cutless) y holgura del eje', null, 24, {
    notes: 'Se revisa en varada.',
  }),
  t('t-alineacion', 'transmision', 'Alineación motor–eje y silentblocks', null, 36),
  t('t-anodo-eje', 'transmision', 'Ánodo del eje', null, 12),
  t('t-helice', 'transmision', 'Hélice: revisar, limpiar (y engrasar si es plegable)', null, 12),

  // ── Casco y varada ──────────────────────────────────────────────────
  t('c-antifouling', 'casco', 'Antifouling', null, 12),
  t('c-anodos', 'casco', 'Otros ánodos (casco, timón si los hay)', null, 12),
  t('c-grifos-fondo', 'casco', 'Grifos de fondo y pasacascos: accionar y revisar', null, 12, {
    notes: 'Comprobar que abren y cierran, revisar abrazaderas (dobles) y tapones de madera a mano.',
  }),
  t('c-quilla', 'casco', 'Quilla: unión casco–quilla y pernos', null, 24),
  t('c-timon', 'casco', 'Timón: holgura de bocina y cojinetes', null, 24),
  t('c-sellados', 'cubierta', 'Sellados de cubierta: herrajes, candeleros y portillos', null, 24),
  t('c-obra-muerta', 'casco', 'Obra muerta: pulir y encerar', null, 12),

  // ── Jarcia, maniobra y velas ──────────────────────────────────────────────────
  t('j-firme-inspeccion', 'jarcia-firme', 'Jarcia firme: inspección (terminales, tensores, crucetas)', null, 12, {
    notes: 'Mejor con subida al palo. Buscar hilos rotos y fisuras en terminales.',
  }),
  t('j-firme-sustitucion', 'jarcia-firme', 'Jarcia firme: sustitución', null, 120, {
    notes: 'Es habitual cambiarla a los 10–12 años; algunas aseguradoras lo exigen. Si la tuya es de 2007, ya ha pasado ese plazo.',
  }),
  t('j-labor', 'jarcia-labor', 'Jarcia de labor: drizas y escotas', null, 12),
  t('j-enrollador', 'jarcia-labor', 'Enrollador de génova: limpiar, engrasar y revisar', null, 12),
  t('j-mayor', 'velas', 'Mayor: rizos, sables, garruchos y lazy-bag', null, 12),
  t('j-velas', 'velas', 'Velas: revisión de costuras, puños y banda UV', null, 24),
  t('j-winches', 'jarcia-labor', 'Winches: desmontar, limpiar y engrasar', null, 12),
  t('j-poleas', 'jarcia-labor', 'Poleas, mordazas y stoppers', null, 12),
  t('j-tangon', 'jarcia-labor', 'Tangón de spinnaker: herrajes y pistones', null, 12),
  t('j-botalon', 'jarcia-labor', 'Botalón de génaker: herrajes y anclaje', null, 12),
  t('j-spi-genaker', 'velas', 'Spinnaker y génaker: velas, calcetín y drizas', null, 24),

  // ── Fondeo y molinete ───────────────────────────────────────────────
  t('f-molinete', 'fondeo', 'Molinete eléctrico: limpiar, engrasar y revisar embrague', null, 12, {
    notes: 'Revisar también conexiones, relé/solenoide y el mando.',
  }),
  t('f-cadena', 'fondeo', 'Cadena y fondeo: galvanizado, marcas, grillete y gaza', null, 12),

  // ── Gobierno y piloto ───────────────────────────────────────────────
  t('g-rueda', 'gobierno', 'Gobierno de rueda: tensión de cables, poleas y sector', null, 12),
  t('g-cana-emergencia', 'gobierno', 'Caña de emergencia: comprobar que encaja', null, 12),
  t('g-piloto', 'gobierno', 'Piloto automático: actuador, conexiones y calibración', null, 12),

  // ── Electricidad y energía ──────────────────────────────────────────
  t('e-baterias', 'electricidad', 'Baterías: estado, bornes y carga', null, 6),
  t('e-achique', 'electricidad', 'Bombas de achique (eléctrica y manual): probar', null, 6),
  t('e-luces', 'electricidad', 'Luces de navegación: probar', null, 12),
  t('e-placas', 'electricidad', 'Placas solares: limpiar, conexiones y regulador', null, 12),
  t('e-puerto', 'electricidad', 'Cargador y toma de puerto: cable y conexiones', null, 12),

  // ── Agua, aseo, gas y calefacción ────────────────────────────────────────────
  t('a-inodoro', 'agua', 'Inodoro: bomba, juntas y válvulas', null, 12),
  t('a-negras', 'agua', 'Depósito de aguas negras: válvulas y respiradero', null, 12),
  t('a-depositos-agua', 'agua', 'Depósitos de agua dulce: higienizar', null, 12),
  t('a-bomba-agua', 'agua', 'Bomba y filtro de agua dulce', null, 12),
  t('a-calentador', 'agua', 'Calentador: válvula de seguridad y conexiones', null, 12, {
    notes: 'Vaciarlo si invernas con riesgo de heladas.',
  }),
  t('a-calefaccion', 'confort', 'Calefacción diésel: revisión (bujía/quemador, escape, toma de aire)', null, 12, {
    notes: 'Webasto o Eberspächer: mira la placa del aparato. Fuera de temporada, hazla funcionar 15–20 min al mes para evitar carbonilla.',
  }),
  exp('a-gas-latiguillo', 'confort', 'Latiguillo de gas: sustituir', 60, {
    notes: 'Al registrar, anota la fecha de caducidad impresa en el latiguillo.',
  }),
  t('a-gas-detector', 'confort', 'Detector de gas y llave de paso: probar', null, 12),

  // ── Seguridad (bandera española) ────────────────────────────────────
  exp('s-balsa', 'seguridad', 'Balsa salvavidas: revisión', 12, {
    notes: 'RD 339/2021, art. 6: revisión según el fabricante, en estación de servicio autorizada. Al registrar, anota la fecha de la próxima revisión que pone la etiqueta.',
  }),
  exp('s-chalecos', 'seguridad', 'Chalecos autohinchables: revisión (cartucho y zafa)', 12, {
    notes: 'RD 339/2021, art. 7: según el fabricante, en estación autorizada. Anota la fecha de la próxima revisión.',
  }),
  exp('s-pirotecnia', 'seguridad', 'Bengalas, cohetes y señales fumígenas: caducidad', 36, {
    notes: 'Anota la fecha de caducidad impresa. Llevarlas caducadas es infracción grave (RD 339/2021, art. 24).',
  }),
  t('s-extintores', 'seguridad', 'Extintores: revisión anual', null, 12, {
    notes: 'RD 339/2021 remite al Reglamento de instalaciones contra incendios (RD 513/2017): revisión anual por empresa mantenedora.',
  }),
  exp('s-extintores-retimbrado', 'seguridad', 'Extintores: retimbrado / caducidad', 60, {
    notes: 'Prueba de presión cada 5 años; vida útil máxima de 20 años. Anota la fecha que figura en la etiqueta.',
  }),
  exp('s-botiquin', 'seguridad', 'Botiquín: caducidades', 12),
  t('s-aro', 'seguridad', 'Aro salvavidas, luz, rabiza y pilas de luces', null, 12),
  t('s-arneses', 'seguridad', 'Arneses y líneas de vida', null, 12),
  t('s-vhf', 'seguridad', 'VHF / DSC: prueba y datos MMSI', null, 12),
  exp('s-tablilla-desvios', 'seguridad', 'Compás: tablilla de desvíos', 60, {
    notes: 'RD 339/2021, art. 12: revisar cada cinco años.',
  }),
  exp('s-epirb', 'seguridad', 'Radiobaliza / PLB: batería y zafa hidrostática', 60, {
    active: false,
    notes: 'Actívala si llevas radiobaliza o PLB. Anota las fechas de caducidad de batería y zafa.',
  }),

  // ── Documentación ───────────────────────────────────────────────────
  exp('d-itb', 'documentacion', 'Reconocimiento periódico (ITB) y certificado de navegabilidad', 60, {
    notes: 'RD 1434/1999: embarcaciones de lista 7ª de 6 a 24 m, cada cinco años como máximo. Anota la fecha de caducidad del certificado.',
  }),
  exp('d-seguro', 'documentacion', 'Seguro: renovación', 12),
];

export const DEFAULT_SETTINGS = {
  boatName: 'Mi velero',
  boatModel: 'Jeanneau Sun Odyssey 36i (2007)',
  engine: 'Yanmar 3YM30, transmisión por eje',
  noticeHours: 25,
  noticeDays: 30,
  deletedDefaults: [],
};
