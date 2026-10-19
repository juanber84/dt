-- Lo que llega con fecha pasada (backfills, el móvil que sube tarde) solo se ve en las series
-- cuando se recalcula el agregado: cada 2 minutos en vez de 15. Solo recalcula lo que ha cambiado.
-- (Según la versión de Timescale el job apunta a la vista o a su tabla materializada.)
select alter_job(j.job_id, schedule_interval => interval '2 minutes')
from timescaledb_information.jobs j
join timescaledb_information.continuous_aggregates c
  on (c.view_schema = j.hypertable_schema and c.view_name = j.hypertable_name)
  or (c.materialization_hypertable_schema = j.hypertable_schema
    and c.materialization_hypertable_name = j.hypertable_name)
where j.proc_name = 'policy_refresh_continuous_aggregate'
  and c.view_name = 'observations_hourly'
  and c.view_schema = current_schema();
