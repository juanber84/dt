#!/bin/sh
# Arranca la app del contenedor con los secretos de Infisical.
# Uso: digitaltwin-run <carpeta de Infisical> [comando...]   (p. ej. /api o /bot)
# Sin comando arranca la app de Node con las trazas de OpenTelemetry (no hacen nada si no hay
# OTEL_EXPORTER_OTLP_ENDPOINT); digitaltwin-alloy pasa el suyo. Van aquí y no en NODE_OPTIONS para
# que el healthcheck y los scripts de `docker exec` no arranquen el SDK.
#
# Autenticación (una de las dos):
#   - INFISICAL_TOKEN: token de acceso ya generado
#   - INFISICAL_CLIENT_ID + INFISICAL_CLIENT_SECRET: machine identity (universal auth); se hace
#     login al arrancar, así que cada arranque usa un token nuevo
set -e

: "${INFISICAL_DOMAIN:?Falta INFISICAL_DOMAIN}"
: "${INFISICAL_PROJECT_ID:?Falta INFISICAL_PROJECT_ID}"
FOLDER="${1:?Uso: digitaltwin-run <carpeta de Infisical> [comando...]}"
shift
[ $# -gt 0 ] || set -- node --import @digitaltwin/telemetry/register .

if [ -z "$INFISICAL_TOKEN" ]; then
  if [ -z "$INFISICAL_CLIENT_ID" ] || [ -z "$INFISICAL_CLIENT_SECRET" ]; then
    echo "Falta INFISICAL_TOKEN o INFISICAL_CLIENT_ID + INFISICAL_CLIENT_SECRET" >&2
    exit 1
  fi
  INFISICAL_TOKEN=$(infisical login --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" --client-secret="$INFISICAL_CLIENT_SECRET" \
    --domain="$INFISICAL_DOMAIN" --silent --plain)
  export INFISICAL_TOKEN
fi

exec infisical run --domain="$INFISICAL_DOMAIN" --projectId="$INFISICAL_PROJECT_ID" \
  --env="${INFISICAL_ENV:-prod}" --path="$FOLDER" --watch -- "$@"
