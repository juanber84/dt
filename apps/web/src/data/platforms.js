import { siGarmin, siGoogle, siStrava, siTelegram, siXiaomi } from 'simple-icons';

/**
 * Catálogo de Conexiones: cada plataforma con lo que da, cómo llega a TwinMe y dónde conseguirla.
 * Las que se conectan aquí apuntan a su fuente (`source`, de data/sources.js); las demás llegan a
 * través de otra (`via`), aún no están (`soon`) o son de la propia app.
 *
 * Logos: los de simple-icons (CC0) donde los hay; si no, monograma. Cuando una plataforma mande su
 * kit de marca, su SVG va en `logo` (en public/platforms/).
 */
export const CATEGORIES = {
  health: { label: 'Reloj y salud' },
  training: { label: 'Entreno' },
  cycling: { label: 'Ciclismo' },
  scale: { label: 'Báscula' },
  food: { label: 'Comida' },
  twinme: { label: 'De TwinMe' },
};

/** tone: el de StatusPill. */
export const STATES = {
  direct: { label: 'Conexión directa', tone: 'good' },
  via: { label: 'A través de otra', tone: 'neutral' },
  experimental: { label: 'Experimental', tone: 'warning' },
  soon: { label: 'Próximamente', tone: 'neutral' },
  twinme: { label: 'De TwinMe', tone: 'good' },
};

/** Estado de una conexión directa (lo que da la API). */
export const CONNECTION_STATUS = {
  connected: { tone: 'good', label: 'Conectado' },
  expired: { tone: 'warning', label: 'Hay que reconectar' },
  error: { tone: 'critical', label: 'Error' },
  disconnected: { tone: 'neutral', label: 'Sin conectar' },
};

// scale: lo que ocupa dentro del cuadro (los logotipos con letras necesitan más)
const icon = (si, scale) => ({ path: si.path, color: `#${si.hex}`, scale });

export const PLATFORMS = [
  {
    id: 'google-health',
    source: 'google-health',
    name: 'Google Health',
    category: 'health',
    state: 'direct',
    icon: icon(siGoogle),
    tagline: 'Tu reloj y tu móvil, con todo lo que pasa por Google.',
    description:
      'Sueño por fases, frecuencia cardiaca, VFC, SpO2, VO2 máx., pasos, kcal y entrenos. En el iPhone, también lo del Apple Watch y lo que llega a Apple Salud de otras apps.',
    provides: ['sleep', 'heart-rate', 'hrv', 'steps', 'spo2', 'vo2max', 'weight', 'workouts'],
    links: {
      ios: 'https://apps.apple.com/es/app/google-health-fitbit/id462638897',
      android: 'https://play.google.com/store/apps/details?id=com.fitbit.FitbitMobile',
    },
  },
  {
    id: 'whoop',
    name: 'WHOOP',
    category: 'health',
    state: 'soon',
    monogram: 'W',
    color: '#000000',
    tagline: 'Recuperación, esfuerzo y sueño.',
    description: 'Tiene API oficial: recuperación, carga del día, sueño y entrenos.',
    provides: ['sleep', 'hrv', 'heart-rate', 'workouts'],
    links: {
      ios: 'https://apps.apple.com/es/app/whoop/id933944389',
      android: 'https://play.google.com/store/apps/details?id=com.whoop.android',
      web: 'https://www.whoop.com',
    },
  },
  {
    id: 'oura',
    name: 'Oura',
    category: 'health',
    state: 'soon',
    monogram: 'O',
    color: '#000000',
    tagline: 'El anillo: sueño y recuperación.',
    description: 'Tiene API oficial: sueño, preparación, VFC, temperatura y actividad.',
    provides: ['sleep', 'hrv', 'heart-rate', 'steps'],
    links: {
      ios: 'https://apps.apple.com/es/app/oura/id1043837948',
      android: 'https://play.google.com/store/apps/details?id=com.ouraring.oura',
      web: 'https://ouraring.com',
    },
  },
  {
    id: 'intervals-icu',
    source: 'intervals-icu',
    name: 'intervals.icu',
    category: 'training',
    state: 'direct',
    monogram: 'icu',
    tagline: 'El análisis de entreno que junta todos tus dispositivos.',
    description:
      'Entrenos con potencia y TSS, forma, fatiga y wellness. Recibe lo de Garmin, Wahoo, Strava y muchos más, así que es la puerta de entrada de casi cualquier dispositivo.',
    provides: ['workouts', 'training-load', 'wellness'],
    links: { web: 'https://intervals.icu' },
  },
  {
    id: 'strava',
    source: 'strava',
    name: 'Strava',
    category: 'training',
    state: 'soon',
    icon: icon(siStrava),
    tagline: 'Actividades con GPS.',
    description:
      'Rutas, ritmos, desnivel y potencia. Mientras no esté, lo que subes a Strava puede llegar a través de intervals.icu.',
    provides: ['workouts'],
    links: {
      ios: 'https://apps.apple.com/es/app/strava-corre-camina-pedalea/id426826309',
      android: 'https://play.google.com/store/apps/details?id=com.strava',
      web: 'https://www.strava.com',
    },
  },
  {
    id: 'garmin',
    name: 'Garmin',
    category: 'training',
    state: 'via',
    via: ['intervals-icu'],
    icon: icon(siGarmin, 0.86),
    tagline: 'Relojes y ciclocomputadores.',
    description:
      'Garmin Connect manda los entrenos a intervals.icu (conexión oficial de Garmin) y de ahí llegan aquí.',
    how: 'En intervals.icu → Settings, conecta Garmin; luego conecta intervals.icu aquí.',
    provides: ['workouts', 'training-load', 'wellness'],
    links: {
      ios: 'https://apps.apple.com/es/app/garmin-connect/id583446403',
      android:
        'https://play.google.com/store/apps/details?id=com.garmin.android.apps.connectmobile',
      web: 'https://connect.garmin.com',
    },
  },
  {
    id: 'motra',
    source: 'motra',
    name: 'Motra',
    category: 'training',
    state: 'experimental',
    monogram: 'Mo',
    tagline: 'Fuerza con todo el detalle.',
    description:
      'Ejercicios, series, repeticiones, peso y descanso: lo que Google no trae de un entreno de fuerza.',
    provides: ['workouts', 'strength'],
    links: {
      ios: 'https://apps.apple.com/es/app/motra-ai-entrenador-fitness/id1548577496',
    },
  },
  {
    id: 'magene',
    name: 'Magene',
    category: 'cycling',
    state: 'via',
    via: ['intervals-icu'],
    monogram: 'Ma',
    tagline: 'Ciclocomputadores, potenciómetros y sensores.',
    description:
      'Su app (OnelapFit) sube las salidas a Strava y TrainingPeaks; a intervals.icu, por ahora, a través de Strava.',
    how: 'En OnelapFit, conecta Strava; en intervals.icu, conecta Strava; y conecta intervals.icu aquí.',
    provides: ['workouts'],
    links: {
      ios: 'https://apps.apple.com/us/app/onelapfit/id1555629744',
      web: 'https://www.magene.com',
    },
  },
  {
    id: 'igpsport',
    name: 'iGPSport',
    category: 'cycling',
    state: 'via',
    via: ['intervals-icu'],
    monogram: 'iG',
    tagline: 'Ciclocomputadores GPS.',
    description:
      'Su app sube las salidas a Strava y TrainingPeaks; a intervals.icu, a través de una de ellas.',
    how: 'En la app de iGPSport → Mi → Apps conectadas, conecta Strava; en intervals.icu, conecta Strava; y conecta intervals.icu aquí.',
    provides: ['workouts'],
    links: { web: 'https://www.igpsport.com' },
  },
  {
    id: 'xiaomi',
    source: 'xiaomi',
    name: 'Xiaomi',
    category: 'scale',
    state: 'experimental',
    icon: icon(siXiaomi),
    tagline: 'Báscula de bioimpedancia.',
    description: 'Peso, grasa, músculo, agua, grasa visceral y metabolismo basal.',
    provides: ['weight', 'body-composition'],
    links: {
      ios: 'https://apps.apple.com/es/app/zepp-life/id938688461',
      android: 'https://play.google.com/store/apps/details?id=com.xiaomi.hm.health',
    },
  },
  {
    id: 'fatsecret',
    source: 'fatsecret',
    name: 'FatSecret',
    category: 'food',
    state: 'soon',
    monogram: 'F',
    tagline: 'Diario de comidas.',
    description: 'Tiene API oficial: lo que apuntas en su diario, con calorías y macros.',
    provides: ['nutrition'],
    links: {
      ios: 'https://apps.apple.com/es/app/contador-de-calor%C3%ADas-fatsecret/id347184248',
      android: 'https://play.google.com/store/apps/details?id=com.fatsecret.android',
      web: 'https://www.fatsecret.es',
    },
  },
  {
    id: 'telegram',
    name: 'Bot de Telegram',
    category: 'twinme',
    state: 'twinme',
    icon: icon(siTelegram),
    tagline: 'Apunta comidas y agua escribiendo o con una foto.',
    description:
      'Le cuentas qué has comido (o le mandas la foto) y estima calorías y macros; también el agua.',
    provides: ['nutrition', 'hydration'],
    links: {
      ios: 'https://apps.apple.com/es/app/telegram-messenger/id686449807',
      android: 'https://play.google.com/store/apps/details?id=org.telegram.messenger',
    },
  },
  {
    id: 'clinical',
    name: 'Informes médicos',
    category: 'twinme',
    state: 'twinme',
    monogram: 'Rx',
    tagline: 'Tus PDFs, leídos por la IA.',
    description:
      'Analíticas, holter y pruebas de esfuerzo que subes en Clínica: se quitan tus datos personales y la IA saca los valores.',
    provides: ['lab-tests', 'heart-rate', 'vo2max'],
    links: {},
  },
  {
    id: 'manual',
    name: 'Registrar',
    category: 'twinme',
    state: 'twinme',
    monogram: '+',
    tagline: 'Lo que apuntas a mano.',
    description: 'Comidas, agua, peso, síntomas, medicación, suplementos y periodos fuera de casa.',
    provides: ['nutrition', 'hydration', 'weight', 'notes'],
    links: {},
  },
];

export const platformById = (id) => PLATFORMS.find((p) => p.id === id);

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca en nombre, frase y datos que da (sin tildes ni mayúsculas). */
export function matchesPlatform(platform, query, typeLabels = {}) {
  const q = normalize(query.trim());
  if (!q) return true;
  const haystack = [
    platform.name,
    platform.tagline,
    platform.description,
    ...platform.provides.map((t) => typeLabels[t] ?? t),
  ].join(' ');
  return normalize(haystack).includes(q);
}
