-- Gestión de usuarios (Administración → Usuarios).
--   features:    funciones extra activadas para ese usuario (p. ej. 'experimental-connections').
--                Los administradores las tienen todas sin apuntarlas.
--   demo:        cuenta de demostración (para enseñar el producto): sin informe ni avisos push.
--   expires_at:  a partir de esa fecha no puede entrar (las demo, p. ej., un mes).
--   disabled_at: desactivada a mano; tampoco puede entrar. Sus datos se quedan.
alter table users
  add column features text[] not null default '{}',
  add column demo boolean not null default false,
  add column expires_at timestamptz,
  add column disabled_at timestamptz,
  add column last_login_at timestamptz;

-- Quien ya tenga conectados Xiaomi o Motra (API no oficial) sigue pudiendo usarlos
update users u set features = array['experimental-connections']
where u.role <> 'admin'
  and exists (
    select 1 from connections c where c.user_id = u.id and c.provider in ('xiaomi', 'motra')
  );
