-- Prioridad entre orígenes de un mismo proveedor (p. ej. dentro de Google: Apple Watch frente a
-- Garmin). Se compara después de la prioridad del proveedor y antes que "el stream más completo".
-- origin_pattern es un LIKE sobre streams.origin; metric_id null = todas las métricas.
create table origin_priorities (
  id integer generated always as identity primary key,
  metric_id smallint references metrics (id) on delete cascade,
  provider text not null,
  origin_pattern text not null,
  priority integer not null
);
create unique index origin_priorities_key
  on origin_priorities (coalesce(metric_id, 0), provider, origin_pattern);

-- El Apple Watch es el reloj de diario (también duerme con él): manda sobre el resto en Google
insert into origin_priorities (metric_id, provider, origin_pattern, priority) values
  (null, 'google-health', 'HEALTH_KIT|com.apple.health.%', 10);
