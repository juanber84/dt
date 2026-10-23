-- El informe de la mañana pasa a las 09:00 por defecto: a las 07:30 el sueño de anoche casi nunca
-- había llegado (el reloj sincroniza al desbloquear el móvil). Quien ya eligió hora la conserva.
alter table report_settings alter column daily_time set default '09:00';
update report_settings set daily_time = '09:00' where daily_time = '07:30';
