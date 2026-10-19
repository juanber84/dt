/**
 * Sesión del front. La API pondrá una cookie de sesión (HttpOnly) al entrar: el front no ve ni
 * guarda ningún token.
 */
import { apiFetch } from '../api.js';

/** @param {{ username: string, password: string, remember: boolean }} credentials */
export const login = (credentials) =>
  apiFetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(credentials) });

export const logout = () => apiFetch('/api/v1/auth/logout', { method: 'POST' });

/** Quién soy (o 401 si no hay sesión). */
export const fetchSession = () => apiFetch('/api/v1/auth/session');
