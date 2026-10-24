// Comprobaciones desde fuera (Grafana Synthetic Monitoring): las mismas URLs que usa la gente,
// pasando por Cloudflare y el túnel. Si algo de eso cae, aquí se ve aunque el VPS no lo sepa.
// Plan gratis: 100k ejecuciones al mes. Con estas: (3 × 30 × 24 × 60/2) + (2 × 30 × 24 × 60/5)
// = 64.800 + 17.280 ≈ 82k.

// Sondas públicas (ids de /api/v1/probe/list): España, París y Frankfurt
export const PROBES = { spain: 622, paris: 19, frankfurt: 14 };

export const CHECKS = [
  {
    job: 'twinme-ready',
    target: 'https://twinme.app/api/v1/health/ready',
    frequency: 120_000,
    timeout: 10_000,
    probes: [PROBES.spain, PROBES.paris, PROBES.frankfurt],
    // La API responde y llega a la BD (si no, devuelve 503 y "degraded")
    http: { validStatusCodes: [200], failIfBodyNotMatchesRegexp: ['^\\{"status":"ok"'] },
  },
  {
    job: 'twinme-web',
    target: 'https://twinme.app/',
    frequency: 300_000,
    timeout: 10_000,
    probes: [PROBES.spain, PROBES.paris],
    // El HTML del frontal (nginx), no una página de error de Cloudflare
    http: { validStatusCodes: [200], failIfBodyNotMatchesRegexp: ['<div id="app">'] },
  },
];
