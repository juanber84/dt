/**
 * Quita los datos personales del texto de un informe antes de mandarlo al LLM: para leer los
 * valores no hacen falta, y así al proveedor solo le llegan números. Reglas deterministas (nada de
 * IA aquí), pensadas para los informes españoles:
 *
 *   1. El bloque "Datos del paciente" … "Comentario de informe" (cabecera de cada página de los
 *      laboratorios tipo Sanitas) se quita entero.
 *   2. El valor de etiquetas como Paciente:, Nombre:, NHC:, DNI:, Póliza:, Fecha de nacimiento:...
 *   3. Patrones sueltos: DNI/NIE, correos, teléfonos, números larguísimos (pólizas, tarjetas) y
 *      nombres con el formato "APELLIDOS, NOMBRE" en mayúsculas.
 *   4. Los nombres que se pasen (los del usuario), en cualquier parte, sin mirar mayúsculas ni tildes.
 *
 * Lo quitado se cambia por MASK para que se note que había algo.
 */
export const MASK = '[oculto]';

const BLOCK_START = /^\s*datos del paciente\b/i;
const BLOCK_END = /comentario de informe/i;
const BLOCK_MAX_LINES = 20;

const LABELS = [
  'paciente',
  'nombre(?: y apellidos)?',
  'apellidos',
  'nhc',
  'n[º°o]\\.?\\s?(?:de\\s)?historia',
  'historia cl[ií]nica',
  'd\\.?n\\.?i\\.?(?:\\s?/\\s?pasaporte)?',
  'nie',
  'pasaporte',
  'n[º°o]\\.?\\s?(?:de\\s)?p[óo]liza',
  'p[óo]liza',
  'tarjeta sanitaria',
  'cip',
  'nuss',
  'fecha de nacimiento',
  'f\\.\\s?nacimiento',
  'f\\.\\s?nac\\.?',
  'direcci[óo]n',
  'domicilio',
  'tel[ée]fono',
  'tfno\\.?',
  'm[óo]vil',
  'e-?mail',
  'correo(?: electr[óo]nico)?',
  'peticionario',
  'm[ée]dico solicitante',
];
// Etiqueta + ":" + su valor (hasta dos espacios seguidos, que en -layout separa columnas)
const LABELED = new RegExp(
  `(^|[^\\p{L}])(${LABELS.join('|')})(\\s*:\\s*)(\\S(?:.*?\\S)?)(?=\\s{2,}|$)`,
  'gimu',
);

const UPPER = 'A-ZÁÉÍÓÚÜÑ';
const PATTERNS = [
  // DNI y NIE
  /\b\d{8}[A-HJ-NP-TV-Z]\b/g,
  /\b[XYZ]\d{7}[A-Z]\b/g,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  // Teléfonos españoles (9 cifras empezando por 6-9, con o sin +34 y separadores)
  /(?<!\d)(?:\+34[\s.-]?)?[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/g,
  // Pólizas, tarjetas, IBAN...: 12 cifras o más seguidas
  /\b\d{12,}\b/g,
  // "APELLIDO APELLIDO, NOMBRE" (o "APELLIDO , NOMBRE") en mayúsculas
  new RegExp(
    `\\b[${UPPER}]{2,}(?:[ -][${UPPER}]{2,})*\\s?,\\s?[${UPPER}]{2,}(?:[ -][${UPPER}]{2,})*\\b`,
    'gu',
  ),
  // Firmas de médicos: "Dr. Nombre Apellido", "Dra. ..."
  new RegExp(`\\bDra?\\.\\s+[${UPPER}][\\p{Ll}]+(?:\\s+[${UPPER}][\\p{Ll}]+){0,3}`, 'gu'),
];

/**
 * @param {string} text
 * @param {{ names?: string[] }} [options]  Nombres a quitar además (nombre, apellidos del usuario).
 * @returns {{ text: string, count: number }}  Texto limpio y cuántas cosas se han quitado.
 */
export function redactPersonalData(text, { names = [] } = {}) {
  let count = 0;
  const lines = text.split('\n');
  const kept = [];

  for (let i = 0; i < lines.length; i++) {
    if (BLOCK_START.test(lines[i])) {
      const end = lines.slice(i + 1, i + 1 + BLOCK_MAX_LINES).findIndex((l) => BLOCK_END.test(l));
      if (end >= 0) {
        kept.push(MASK);
        count++;
        // La línea "Comentario de informe:" se queda (lo que siga puede ser útil)
        i += end;
        continue;
      }
    }
    kept.push(lines[i]);
  }

  let out = kept.join('\n').replace(LABELED, (_m, before, label, sep) => {
    count++;
    return `${before}${label}${sep}${MASK}`;
  });

  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match) => {
      if (match === MASK) return match;
      count++;
      return MASK;
    });
  }

  for (const name of nameTokens(names)) {
    out = out.replace(name, () => {
      count++;
      return MASK;
    });
  }

  return { text: out, count };
}

/** Cada palabra de los nombres (3+ letras) como regex de palabra completa sin tildes ni mayúsculas. */
function nameTokens(names) {
  const words = new Set();
  for (const name of names) {
    for (const word of String(name ?? '').split(/[\s,.@_-]+/)) {
      if (word.length >= 3 && /\p{L}/u.test(word)) words.add(word);
    }
  }
  return [...words].map(
    (word) => new RegExp(`(?<![\\p{L}])${accentInsensitive(word)}(?![\\p{L}])`, 'giu'),
  );
}

const ACCENTS = { a: 'aáàä', e: 'eéèë', i: 'iíìï', o: 'oóòö', u: 'uúùü', n: 'nñ', c: 'cç' };

function accentInsensitive(word) {
  return [...word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()]
    .map((ch) => (ACCENTS[ch] ? `[${ACCENTS[ch]}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
}
