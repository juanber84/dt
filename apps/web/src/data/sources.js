/**
 * Fuentes de datos y lo que aporta cada una. Lo usan el timeline (de dónde viene cada registro) y
 * administración (qué conectar y con qué prioridad).
 *
 * auth:
 *  - oauth: el botón redirige al proveedor y vuelve a la API con el code
 *  - credentials: usuario y contraseña (y 2FA) que la API usa para sacar el token
 *  - login: email y contraseña directos (la API hace login y comprueba antes de guardar)
 *  - apikey: una clave personal que se pega (y la API comprueba antes de guardarla)
 *  - internal: no hay que conectar nada (bot, registros a mano)
 */
export const SOURCES = {
  'google-health': {
    name: 'Google Health',
    monogram: 'G',
    auth: 'oauth',
    description: 'Reloj y móvil: sueño, frecuencia cardiaca, VFC, pasos, SpO2, VO2 máx.',
    provides: ['sleep', 'heart-rate', 'hrv', 'steps', 'spo2', 'vo2max', 'weight', 'workouts'],
  },
  xiaomi: {
    name: 'Xiaomi',
    monogram: 'Mi',
    auth: 'credentials',
    description: 'Báscula de bioimpedancia: peso, grasa, músculo, agua, grasa visceral.',
    provides: ['weight', 'body-composition'],
  },
  strava: {
    name: 'Strava',
    monogram: 'S',
    auth: 'oauth',
    description: 'Actividades con GPS: rutas, ritmos, desnivel y potencia.',
    provides: ['workouts'],
  },
  'intervals-icu': {
    name: 'intervals.icu',
    monogram: 'i',
    auth: 'apikey',
    description: 'Carga de entrenamiento (TSS), forma y fatiga, wellness y entrenos planificados.',
    provides: ['workouts', 'training-load', 'wellness'],
  },
  // La API no oficial de una app de fuerza: no lleva su marca (la buena será por su MCP)
  motra: {
    name: 'Fuerza (experimental)',
    monogram: 'Fx',
    auth: 'login',
    description: 'Entrenos de fuerza con ejercicios, series, repeticiones, peso y descanso.',
    provides: ['workouts', 'strength'],
  },
  fatsecret: {
    name: 'FatSecret',
    monogram: 'F',
    auth: 'oauth',
    description: 'Diario de comidas con calorías y macros.',
    provides: ['nutrition'],
  },
  telegram: {
    name: 'Bot de Telegram',
    monogram: 'T',
    auth: 'internal',
    description: 'Comidas por texto o foto con macros estimados, y registros rápidos.',
    provides: ['nutrition', 'notes'],
  },
  clinical: {
    name: 'Informes médicos',
    monogram: 'Rx',
    auth: 'internal',
    description: 'Analíticas, holter y pruebas de esfuerzo que subes en PDF (Clínica).',
    provides: ['lab-tests', 'heart-rate', 'vo2max'],
  },
  manual: {
    name: 'Manual',
    monogram: 'M',
    auth: 'internal',
    description: 'Lo que apuntas a mano desde aquí.',
    provides: ['notes', 'hydration', 'weight'],
  },
};

export const DATA_TYPES = {
  sleep: 'Sueño',
  'heart-rate': 'Frecuencia cardiaca',
  hrv: 'VFC',
  steps: 'Pasos',
  spo2: 'SpO2',
  vo2max: 'VO2 máx.',
  weight: 'Peso',
  'body-composition': 'Composición corporal',
  workouts: 'Entrenamientos',
  strength: 'Fuerza (series y repeticiones)',
  'training-load': 'Carga de entrenamiento',
  wellness: 'Wellness',
  nutrition: 'Nutrición',
  hydration: 'Hidratación',
  notes: 'Notas y síntomas',
  'lab-tests': 'Analíticas',
};

export const sourceName = (id) => SOURCES[id]?.name ?? id;
