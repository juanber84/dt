import { Router } from 'express';
import { EmailError, escapeHtml, layout } from '@digitaltwin/email';
import { HttpError } from '../utils/http-error.js';

/**
 * /api/v1/email (con sesión): los correos del usuario. El historial y el botón de prueba, que
 * manda al momento (sin cola) para ver enseguida si llega.
 * @param {{ email: ReturnType<typeof import('@digitaltwin/email').createEmail>, publicUrl: string }} deps
 */
export function createEmailRouter({ email, publicUrl }) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ to: req.user.email, history: await email.history(req.user.id, 10) });
  });

  router.post('/test', async (req, res) => {
    const name = req.user.name?.split(' ')[0] ?? '';
    try {
      const result = await email.send(req.user.id, {
        kind: 'test',
        to: req.user.email,
        subject: 'Así te llegarán los informes de TwinMe',
        html: layout({
          title: `Hola${name ? `, ${escapeHtml(name)}` : ''} 👋`,
          preheader: 'Si lees esto, los correos de TwinMe te llegan bien.',
          body: `<p style="margin:0 0 12px;">Si lees esto, los correos de TwinMe te llegan bien.</p>
<p style="margin:0;">Por aquí te llegará el informe de cada mañana. <a href="${escapeHtml(publicUrl)}/day" style="color:#2f6f4f;">Abrir TwinMe</a></p>`,
          appUrl: publicUrl,
        }),
        text: `Si lees esto, los correos de TwinMe te llegan bien.\n\nAbrir TwinMe: ${publicUrl}/day`,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof EmailError) {
        throw new HttpError(502, `No se pudo mandar: ${err.message}`, { code: 'EMAIL_FAILED' });
      }
      throw err;
    }
  });

  return router;
}
