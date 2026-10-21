-- Datos de la persona que necesitan el coach y los cálculos (gasto, objetivos): lo que escribe el
-- usuario. Lo que no haya escrito se saca de la báscula (perfil de Xiaomi) al leerlo.
create table user_profiles (
  user_id uuid primary key references users (id) on delete cascade,
  birth_date date,
  sex text check (sex in ('male', 'female')),
  height_cm numeric(5, 1) check (height_cm between 50 and 260),
  weight_goal_kg numeric(5, 1) check (weight_goal_kg between 20 and 400),
  updated_at timestamptz not null default now()
);
