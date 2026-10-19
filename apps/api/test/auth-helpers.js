import request from 'supertest';
import { createUserStore, hashPassword, Role } from '../src/services/users.js';

export const PASSWORD = 'patata-de-test';

/** Usuarios de prueba: un admin y un usuario normal con la misma contraseña. */
export async function testUsers() {
  const passwordHash = await hashPassword(PASSWORD);
  return createUserStore([
    { id: 'admin', email: 'admin@example.com', name: 'Admin', role: Role.ADMIN, passwordHash },
    { id: 'ana', email: 'ana@example.com', name: 'Ana', role: Role.USER, passwordHash },
  ]);
}

/** Inicia sesión y devuelve la cookie para las siguientes peticiones. */
export async function loginCookie(app, email = 'admin@example.com', extra = {}) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: email, password: PASSWORD, ...extra });
  if (res.status !== 200) throw new Error(`login ${res.status}: ${JSON.stringify(res.body)}`);
  return res.headers['set-cookie'];
}
