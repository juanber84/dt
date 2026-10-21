-- Lo que necesita el motor del perfil:
--   logging_since    desde qué día lo apunta todo (antes, los días no cuentan para el gasto)
--   weekly_rate_pct  ritmo buscado en % del peso por semana (-0.5 = perder un 0,5 %/semana;
--                    0 = mantener). Por defecto (null), -0.5
alter table user_profiles
  add column logging_since date,
  add column weekly_rate_pct numeric(4, 2) check (weekly_rate_pct between -1.5 and 1);
