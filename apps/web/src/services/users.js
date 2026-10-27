import { apiFetch } from '../api.js';

/** Administración → Usuarios (solo admin). */
export const listUsers = () => apiFetch('/api/v1/admin/users');
export const createUser = (input) =>
  apiFetch('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(input) });
export const updateUser = (id, patch) =>
  apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
export const deleteUser = (id) =>
  apiFetch(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Las cuentas demo caducan por defecto al mes. */
export const DEMO_DAYS = 30;

/** "2026-11-26" (día local) → fin de ese día, en ISO. Vacío → sin caducidad. */
export const endOfDayISO = (date) => (date ? new Date(`${date}T23:59:59`).toISOString() : null);
