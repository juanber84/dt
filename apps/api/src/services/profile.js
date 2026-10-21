const FIELDS = ['birthDate', 'sex', 'heightCm', 'weightGoalKg'];

/**
 * Perfil del usuario: lo que ha escrito él y, para lo que no, lo de su báscula (el perfil que
 * guarda la app de Xiaomi en cada pesaje). Cada campo dice de dónde sale.
 * @param {{ db: import('postgres').Sql, timeZone: string }} deps
 */
export function createProfiles({ db, timeZone }) {
  /** Perfil de la báscula del último pesaje que lo trae (Xiaomi). */
  async function fromScale(userId) {
    const [row] = await db`
      select details from episodes
      where user_id = ${userId} and kind = 'weigh-in' and details ? 'profile' and deleted_at is null
      order by start_time desc limit 1
    `;
    const p = row?.details?.profile;
    if (!p) return {};
    const birth = Number(p.birth);
    return {
      // La app de Xiaomi guarda el nacimiento como medianoche local en milisegundos
      birthDate: Number.isFinite(birth) && birth > 0 ? localDate(new Date(birth), timeZone) : null,
      // 1 = hombre, 2 = mujer (si viene otra cosa, no se supone nada)
      sex: { 1: 'male', 2: 'female' }[String(p.sex)] ?? null,
      heightCm: Number(p.height) || Number(row.details.height) || null,
      weightGoalKg: Number(p.weightTarget) || null,
    };
  }

  return {
    /** @returns {Promise<{ birthDate, sex, heightCm, weightGoalKg, age, sources }>} */
    async get(userId) {
      const [row] = await db`select * from user_profiles where user_id = ${userId}`;
      const own = row
        ? {
            birthDate: row.birth_date ? localDate(row.birth_date, 'UTC') : null,
            sex: row.sex,
            heightCm: row.height_cm == null ? null : Number(row.height_cm),
            weightGoalKg: row.weight_goal_kg == null ? null : Number(row.weight_goal_kg),
          }
        : {};
      const scale = await fromScale(userId);
      const profile = { sources: {} };
      for (const field of FIELDS) {
        if (own[field] != null) {
          profile[field] = own[field];
          profile.sources[field] = 'manual';
        } else if (scale[field] != null) {
          profile[field] = scale[field];
          profile.sources[field] = 'scale';
        } else {
          profile[field] = null;
        }
      }
      profile.age = profile.birthDate ? age(profile.birthDate, new Date(), timeZone) : null;
      return profile;
    },

    /** Guarda lo que escribe el usuario; null en un campo vuelve a usar el de la báscula. */
    async save(userId, patch) {
      const [row] = await db`select * from user_profiles where user_id = ${userId}`;
      const next = {
        birth_date: row?.birth_date ?? null,
        sex: row?.sex ?? null,
        height_cm: row?.height_cm ?? null,
        weight_goal_kg: row?.weight_goal_kg ?? null,
      };
      if ('birthDate' in patch) next.birth_date = patch.birthDate;
      if ('sex' in patch) next.sex = patch.sex;
      if ('heightCm' in patch) next.height_cm = patch.heightCm;
      if ('weightGoalKg' in patch) next.weight_goal_kg = patch.weightGoalKg;
      await db`
        insert into user_profiles (user_id, birth_date, sex, height_cm, weight_goal_kg)
        values (${userId}, ${next.birth_date}, ${next.sex}, ${next.height_cm}, ${next.weight_goal_kg})
        on conflict (user_id) do update set
          birth_date = excluded.birth_date, sex = excluded.sex, height_cm = excluded.height_cm,
          weight_goal_kg = excluded.weight_goal_kg, updated_at = now()
      `;
      return this.get(userId);
    },
  };
}

const localDate = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

/** Años cumplidos en la fecha local de `now`. */
export function age(birthDate, now, timeZone) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const [ty, tm, td] = localDate(now, timeZone).split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
