#!/usr/bin/env node
/**
 * Login real contra Xiaomi Cloud, simulando lo que hará el front + API:
 * cada paso recibe el `state` serializado a JSON (como si viniera de BD/Redis).
 *
 *   node examples/login.js
 *   XIAOMI_USERNAME=... XIAOMI_PASSWORD=... node examples/login.js
 */
import { XiaomiAuth, LoginStatus, XiaomiError } from '../src/index.js';
import { ask, saveLocal, CREDENTIALS_FILE } from './_shared.js';

const logger = process.env.DEBUG
  ? { debug: (obj, msg) => console.log('[DEBUG]', msg, obj) }
  : undefined;
const auth = new XiaomiAuth({ logger });

const username = process.env.XIAOMI_USERNAME || (await ask('Usuario Xiaomi (email/teléfono/ID): '));
const password = process.env.XIAOMI_PASSWORD || (await ask('Contraseña: ', { hidden: true }));

const roundTrip = (state) => JSON.parse(JSON.stringify(state));

try {
  let result = await auth.start({ username, password });

  while (result.status !== LoginStatus.AUTHENTICATED) {
    if (result.status === LoginStatus.CAPTCHA_REQUIRED) {
      const ext = result.captcha.mimeType.split('/')[1] ?? 'jpg';
      const base64 = result.captcha.image.split(',')[1];
      const path = saveLocal(`captcha.${ext}`, Buffer.from(base64, 'base64'), 0o644);
      if (result.captchaRetry) console.log('Captcha incorrecto, prueba con el nuevo.');
      console.log(`Captcha guardado en ${path}`);
      const code = await ask('Texto del captcha: ');
      result = await auth.submitCaptcha(roundTrip(result.state), code);
    } else if (result.status === LoginStatus.EMAIL_CODE_REQUIRED) {
      const state = roundTrip(result.state);
      for (;;) {
        const code = await ask('Código recibido por email: ');
        try {
          result = await auth.submitEmailCode(state, code);
          break;
        } catch (error) {
          if (error.code !== 'INVALID_EMAIL_CODE') throw error;
          console.log('Código incorrecto, inténtalo de nuevo.');
        }
      }
    }
  }

  saveLocal('credentials.json', result.credentials);
  console.log(`\n✓ Login completado (userId ${result.credentials.userId})`);
  console.log(`✓ Credenciales guardadas en ${CREDENTIALS_FILE}`);
  if (!result.credentials.passToken) {
    console.log(
      '! Xiaomi no devolvió passToken: no se podrá renovar la sesión sin volver a hacer login.',
    );
  }
} catch (error) {
  console.error(
    `\nERROR${error instanceof XiaomiError ? ` [${error.code}]` : ''}: ${error.message}`,
  );
  if (error.details) console.error(error.details);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
}
