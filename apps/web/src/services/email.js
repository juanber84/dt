/** Correos de la app (informe del día...): a qué dirección llegan, el historial y la prueba. */
import { apiFetch } from '../api.js';

export const fetchEmail = () => apiFetch('/api/v1/email');

export const sendTestEmail = () => apiFetch('/api/v1/email/test', { method: 'POST' });
