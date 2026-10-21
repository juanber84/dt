/**
 * Cliente mínimo de la API. Rutas relativas: en dev las reenvía el proxy de Vite (API_URL) y en
 * producción va detrás del mismo dominio, así que la cookie de sesión viaja sola.
 */
import { startProgress } from './composables/useProgress.js';

let unauthorizedHandler = () => {};

/** Qué hacer cuando la API dice 401 fuera de /auth (la sesión ha caducado): ir al login. */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export async function apiFetch(path, options = {}) {
  // Los avisos periódicos (sondeos) no encienden la barra de carga
  const done = options.quiet ? () => {} : startProgress();
  try {
    return await request(path, options);
  } finally {
    done();
  }
}

async function request(path, { quiet: _quiet, ...options }) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  // En /auth/* el 401 es la respuesta normal (no hay sesión, contraseña mal): lo gestiona quien llama
  if (res.status === 401 && !path.startsWith('/api/v1/auth/')) unauthorizedHandler();
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(body?.error?.message ?? `HTTP ${res.status}`);
    error.status = res.status;
    error.code = body?.error?.code;
    error.body = body;
    throw error;
  }
  return body;
}

export const getApiStatus = () => apiFetch('/api/v1/health/ready');

/**
 * POST que contesta en streaming (SSE): llama a `onEvent(event, data)` con cada evento según
 * llega. Los errores antes de abrir el stream (404, 401...) se lanzan como en apiFetch.
 */
export async function apiStream(path, body, onEvent, { signal } = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) unauthorizedHandler();
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const error = new Error(payload?.error?.message ?? `HTTP ${res.status}`);
    error.status = res.status;
    error.code = payload?.error?.code;
    throw error;
  }

  const parse = createSseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parse(value);
  }
}

/** Trocea el texto de un stream SSE en eventos `(event, data)`; los trozos pueden cortar líneas. */
export function createSseParser(onEvent) {
  let buffer = '';
  return (text) => {
    buffer += text;
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      // Los comentarios (": ping") no traen datos
      if (data.length) onEvent(event, JSON.parse(data.join('\n')));
    }
  };
}
