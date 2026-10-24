#!/bin/sh
# Arranca Alloy si están las claves de Grafana Cloud (Infisical prod, carpeta /observability).
# Sin ellas no falla en bucle: avisa y espera, así el resto del stack despliega igual.
for name in GRAFANA_PROM_URL GRAFANA_PROM_USER GRAFANA_LOKI_URL GRAFANA_LOKI_USER \
  GRAFANA_OTLP_URL GRAFANA_OTLP_USER GRAFANA_INGEST_TOKEN; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Observabilidad apagada: falta $name en Infisical (/observability). Ver INSTALL.md." >&2
    exec sleep infinity
  fi
done

exec /bin/alloy run /etc/alloy/config.alloy \
  --storage.path=/var/lib/alloy/data \
  --server.http.listen-addr=0.0.0.0:12345 \
  --stability.level=generally-available
