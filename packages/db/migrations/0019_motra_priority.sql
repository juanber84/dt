-- Motra (entrenos de fuerza con series/reps/kg) es fuente directa: gana a Google, que solo tiene
-- el resumen del mismo entreno colado por Apple Health. Misma prioridad que las otras directas.
insert into source_priorities (metric_id, provider, priority) values (null, 'motra', 30)
on conflict (coalesce(metric_id, 0), provider) do nothing;
