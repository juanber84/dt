import { apiFetch } from '../api.js';

/** Admin → IA: modelos, saldo del proveedor y gasto (solo admin). */
export const fetchAiStatus = () => apiFetch('/api/v1/admin/ai');

/** Nombre de cada función que gasta LLM. */
export const FEATURE_LABELS = {
  coach: 'Coach',
  nutrition: 'Comidas (macros)',
  'nutrition.analyze': 'Comidas: análisis',
  'nutrition.refine': 'Comidas: corrección',
  clinical: 'Informes médicos',
  'clinical.extract': 'Informes médicos: lectura',
};

export const featureLabel = (feature) => FEATURE_LABELS[feature] ?? feature;

const money = (value, currency = 'USD') =>
  new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.1 ? 4 : 2,
  }).format(value);

export const fmtMoney = money;

/** Estado del saldo para una pastilla: { tone, label, text }. */
export function balanceStatus(status) {
  const balance = status?.balance;
  if (!status) return { tone: 'neutral', label: 'Sin datos', text: 'Sin conexión con la API.' };
  if (!balance) {
    return {
      tone: 'neutral',
      label: 'Sin saldo',
      text: 'El proveedor no dice el saldo (solo DeepSeek) o no hay LLM configurado.',
    };
  }
  if (balance.error) {
    return {
      tone: 'warning',
      label: 'No se sabe',
      text: `No se ha podido leer el saldo: ${balance.error}`,
    };
  }
  const main = balance.balances[0];
  const amount = main ? money(main.total, main.currency) : '—';
  const runway =
    balance.runwayDays == null ? '' : ` · ${fmtRunway(balance.runwayDays)} a este ritmo`;
  if (!balance.available) {
    return { tone: 'critical', label: 'Sin saldo', text: `Saldo ${amount}: el LLM no contestará.` };
  }
  return {
    tone: balance.low ? 'warning' : 'good',
    label: balance.low ? 'Saldo bajo' : 'Con saldo',
    text: `Saldo ${amount}${runway}`,
  };
}

/** Para cuánto da el saldo: "unos 12 días", "más de un año". */
export function fmtRunway(days) {
  if (days > 365) return 'da para más de un año';
  if (days < 1) return 'no llega a un día';
  return `da para unos ${Math.floor(days)} días`;
}
