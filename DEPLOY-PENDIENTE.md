# Pendiente del deploy

Revisión del 19 oct 2026. El primer deploy de `juanber84/dt` (run 39321747382) falló porque el
repo no tiene secrets. Pasaron los tests y el lint, pero se paró en _Setup SSH key_: `VPS_HOST` y
`VPS_SSH_KEY` llegaron vacíos. Cuando esté todo hecho, borra este fichero. La guía completa está
en [INSTALL.md](INSTALL.md).

## 0. Cambios ya hechos en local (sin commit)

- `docker/web-nginx.conf`: el límite de subida pasa de 10m a 16m. La API acepta PDFs de Clínica de
  hasta 15mb, y nginx los cortaba con un 413.
- `.github/workflows/deploy.yml`: un primer paso comprueba los secrets y dice cuáles faltan.
- `Dockerfile.web`: añadidos los manifiestos de `clinical` y `llm-usage`.
- `docker-compose.prod.yml`: corregida la ruta del workflow en un comentario.
- `INSTALL.md`: puesto al día con los contenedores, los secretos, cloudflared, la creación del
  usuario y la copia de la BD.

## 1. Secrets del repo en GitHub

Van en _Settings → Secrets and variables → Actions_ de `juanber84/dt`. Los del repo antiguo no
sirven: hay que ponerlos otra vez.

| Secret                                            | Valor                                                      |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `VPS_HOST`                                        | host del VPS                                               |
| `VPS_USERNAME`                                    | usuario de SSH                                             |
| `VPS_SSH_KEY`                                     | clave privada SSH                                          |
| `INFISICAL_DOMAIN`                                | URL de Infisical, sin `/api`                               |
| `INFISICAL_PROJECT_ID`                            | ID del proyecto digitaltwin                                |
| `INFISICAL_TOKEN`                                 | service token, **o bien** los dos de abajo                 |
| `INFISICAL_CLIENT_ID` + `INFISICAL_CLIENT_SECRET` | machine identity (universal auth)                          |
| `DIGITALTWIN_DB_PASSWORD`                         | `openssl rand -hex 24`; no la cambies una vez creada la BD |

```bash
gh secret set VPS_SSH_KEY < ~/.ssh/id_rsa
gh secret set VPS_HOST            # pide el valor
gh secret set VPS_USERNAME
gh secret set INFISICAL_DOMAIN
gh secret set INFISICAL_PROJECT_ID
gh secret set INFISICAL_TOKEN
gh secret set DIGITALTWIN_DB_PASSWORD
gh secret list                    # comprobar
```

- [ ] Secrets puestos

## 2. Secretos en Infisical (entorno `prod`)

El worker también usa la carpeta `/api`. Las claves nuevas se generan con `openssl rand -hex 32`.

**`/api`**

| Secreto                                     | Valor                            | Si falta                                                       |
| ------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `DIGITALTWIN_API_KEYS`                      | `bot:<clave>`                    | el bot no puede llamar a la API                                |
| `LLM_API_KEY`                               | clave de DeepSeek                | no hay macros, ni coach, ni lectura de los PDFs de Clínica     |
| `TIMEZONE`                                  | `Europe/Madrid`                  | los días se cortan mal                                         |
| `TOKEN_ENCRYPTION_KEY`                      | clave nueva                      | las conexiones se pierden al reiniciar                         |
| `JWT_SECRET`                                | clave nueva                      | las sesiones de la web se pierden al reiniciar                 |
| `DIGITALTWIN_WEBHOOK_SECRET`                | clave nueva (la misma en `/bot`) | no llegan los eventos del bot                                  |
| `PUBLIC_URL`                                | `https://<tu dominio>`           | se queda en `http://localhost:3081` y falla el login de Google |
| `TRUST_PROXY`                               | `2` (cloudflared + nginx)        | IPs mal en el rate limit                                       |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | cliente OAuth de Google Cloud    | Google sale "no disponible"                                    |

**`/bot`**

| Secreto                      | Valor                                      |
| ---------------------------- | ------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`         | token del bot de producción (no el de dev) |
| `TELEGRAM_ALLOWED_USER_IDS`  | tu ID de Telegram                          |
| `DIGITALTWIN_API_KEY`        | la `<clave>` de `bot:<clave>`              |
| `DIGITALTWIN_WEBHOOK_SECRET` | el mismo que en `/api`                     |
| `TIMEZONE`                   | `Europe/Madrid`                            |

- [ ] `/api` completa
- [ ] `/bot` completa

## 3. Cloudflared y Google

- [ ] En el túnel, un hostname que apunte a `http://digitaltwin-web:80`, no a la API. nginx
      sirve el front y reenvía `/api`. Cloudflared tiene que estar en la red `red-n8n`.
- [ ] Ese hostname es el que va en `PUBLIC_URL`.
- [ ] En Google Cloud → Credenciales, da de alta como URI de redirección
      `<PUBLIC_URL>/api/v1/connections/google-health/callback`.

## 4. Desplegar y comprobar

- [ ] Commit y push a `main`, o _Actions → digitaltwin deploy → Run workflow_.
- [ ] En el VPS, todos los contenedores en marcha y la API "healthy":
      `cd /opt/digitaltwin/app && sudo docker compose -f docker-compose.prod.yml ps`
- [ ] Crea tu usuario (te pide la contraseña):
      `sudo docker exec -it digitaltwin-api node scripts/create-user.js --email yo@x.com --name Yo --role admin`
- [ ] Entra en la web y vuelve a conectar Google, Xiaomi e intervals.icu. Están cifradas con la
      `TOKEN_ENCRYPTION_KEY` de dev, así que en prod hay que conectarlas de nuevo.
- [ ] Vincula Telegram en Conexiones → Bot de Telegram.
- [ ] Sube un PDF de prueba desde Hoy → Registrar → Informe y comprueba que se lee
      (`sudo docker logs -f digitaltwin-worker`).

## 5. Para más adelante

- **Copia automática de la BD.** Ahora no hay ninguna: si se pierde el volumen del VPS, se pierde
  todo. Por ejemplo, un cron diario en el VPS:
  `sudo docker exec digitaltwin-db pg_dump -U digitaltwin -Fc digitaltwin > /opt/digitaltwin/backups/dt-$(date +%F).dump`,
  y llevarse la copia fuera del VPS.
