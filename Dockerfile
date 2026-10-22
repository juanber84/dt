# Imagen de una app del monorepo: docker build --build-arg APP=api|bot|worker .
FROM node:22-alpine

ARG APP
RUN test -n "$APP" || (echo "Falta --build-arg APP=api|bot|worker" && exit 1)

ENV NODE_ENV=production
WORKDIR /app

# CLI de Infisical: en producción los secretos se inyectan con `infisical run` (ver docker-compose.prod.yml).
# Por npm porque el repo apk de Infisical no tiene paquete para la Alpine de node:22.
RUN npm install -g @infisical/cli@0.43.137 && npm cache clean --force
COPY --chmod=755 docker/digitaltwin-run.sh /usr/local/bin/digitaltwin-run

# El worker lee los informes médicos en PDF con pdftotext (poppler-utils) y los escaneados con OCR
# (pdftoppm los pasa a imagen y tesseract los lee, con el modelo de español)
# y hace la copia de seguridad diaria: pg_dump (misma versión que la BD), cifrada con age y a
# Google Drive con rclone
RUN if [ "$APP" = "worker" ]; then \
      apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-spa \
        postgresql18-client age rclone; \
    fi

# 1. Manifiestos (capa cacheada mientras no cambien las dependencias)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/docs/package.json apps/docs/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/clinical/package.json packages/clinical/
COPY packages/coach/package.json packages/coach/
COPY packages/connections/package.json packages/connections/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/llm-usage/package.json packages/llm-usage/
COPY packages/logger/package.json packages/logger/
COPY packages/mcp/package.json packages/mcp/
COPY packages/nutrition/package.json packages/nutrition/
COPY packages/push/package.json packages/push/
COPY packages/queue/package.json packages/queue/
COPY packages/timeline/package.json packages/timeline/
COPY packages/google-health/package.json packages/google-health/
COPY packages/intervals-icu/package.json packages/intervals-icu/
COPY packages/motra/package.json packages/motra/
COPY packages/xiaomi/package.json packages/xiaomi/

# 2. Solo las dependencias de producción de esta app (y de los paquetes que usa)
RUN npm ci --omit=dev --workspace=@digitaltwin/${APP} && npm cache clean --force

# 3. Código
COPY packages ./packages
COPY apps/${APP} ./apps/${APP}

USER node
WORKDIR /app/apps/${APP}
# "node ." arranca el "main" del package.json de la app
CMD ["node", "."]
