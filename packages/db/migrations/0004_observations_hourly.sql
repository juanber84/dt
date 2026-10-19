-- no-transaction
-- Resumen por hora de cada métrica y stream: lo que lee el timeline (el día se agrega desde aquí
-- en la consulta, con la zona horaria de quien pregunta). Con materialized_only = false lo que
-- aún no está materializado se calcula al vuelo, así que lo recién llegado se ve enseguida.
create materialized view if not exists observations_hourly
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select
  time_bucket(interval '1 hour', time) as bucket,
  user_id,
  metric_id,
  stream_id,
  avg(value) as avg,
  min(value) as min,
  max(value) as max,
  sum(value) as sum,
  count(*) as count,
  last(value, time) as last
from observations
group by bucket, user_id, metric_id, stream_id
with no data;

-- start_offset null: también recoge lo que llega con fechas antiguas (backfills). Solo recalcula
-- los tramos que han cambiado, no todo el histórico.
select add_continuous_aggregate_policy('observations_hourly',
  start_offset => null,
  end_offset => interval '1 hour',
  schedule_interval => interval '15 minutes',
  if_not_exists => true);
