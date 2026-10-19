/**
 * Lista los dispositivos de todas las casas (propias y compartidas) en la región del cliente.
 * Útil para descubrir el `model` de la báscula.
 * @param {import('./client.js').XiaomiCloudClient} client
 */
export async function getDevices(client) {
  const homes = [];

  const homesResult = await client.request('/v2/homeroom/gethome', {
    fg: true,
    fetch_share: true,
    fetch_share_dev: true,
    limit: 300,
    app_ver: 7,
  });
  for (const home of homesResult?.homelist ?? []) {
    homes.push({
      homeId: home.id,
      homeOwner: client.credentials.userId,
      homeName: home.name ?? null,
    });
  }

  try {
    const count = await client.request('/v2/user/get_device_cnt', {
      fetch_own: true,
      fetch_share: true,
    });
    for (const shared of count?.share?.share_family ?? []) {
      homes.push({
        homeId: shared.home_id,
        homeOwner: shared.home_owner,
        homeName: shared.home_name ?? null,
      });
    }
  } catch (error) {
    client.logger?.debug?.({ err: error.message }, 'xiaomi get_device_cnt');
  }

  const seen = new Set();
  const devices = [];
  for (const home of homes) {
    const key = `${home.homeOwner}:${home.homeId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const result = await client.request('/v2/home/home_device_list', {
      home_owner: Number(home.homeOwner),
      home_id: Number(home.homeId),
      limit: 200,
      get_split_device: true,
      support_smart_home: true,
    });
    for (const device of result?.device_info ?? []) devices.push({ ...device, home });
  }

  return devices;
}

/** Filtra los dispositivos que son básculas. */
export async function getScales(client) {
  return (await getDevices(client)).filter((d) => String(d.model).includes('.scales.'));
}
