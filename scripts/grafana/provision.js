#!/usr/bin/env node
// Monta la observabilidad de TwinMe en Grafana Cloud. Se puede repetir: actualiza en vez de duplicar.
//   make grafana                      (o: node scripts/grafana/provision.js)
//   node scripts/grafana/provision.js --rotate-ingest   token nuevo para Alloy
//
// Qué hace:
//   1. Política de acceso "twinme-ingest" (solo escribir métricas, logs y trazas) y su token, que
//      guarda en Infisical prod /observability con las URLs del stack. Lo usa digitaltwin-alloy.
//   2. Synthetic Monitoring: lo activa en el stack si hace falta y crea/actualiza las comprobaciones
//      desde fuera (checks.js).
//   3. En el Grafana del stack, con una cuenta de servicio y un token de 10 min: carpeta TwinMe,
//      el correo como punto de contacto, la ruta de avisos project=twinme → correo, las alertas
//      (alerts.js) y el dashboard (dashboard.js).
//
// Necesita en .env.grafana (no se sube: .gitignore):
//   GRAFANA_CLOUD_ADMIN_TOKEN  política "twinme-admin" de grafana.com (stacks:read,
//                              accesspolicies:*, stack-service-accounts:write, metrics/logs/traces:read)
//   GRAFANA_STACK              (opcional) slug del stack; por defecto juanber84
//   GRAFANA_ALERT_EMAIL        (opcional) a quién avisar; por defecto el del admin de TwinMe
//   GRAFANA_SM_TOKEN           lo añade el propio script al activar Synthetic Monitoring
// Y .env.infisical (el de make docker-up) para escribir en Infisical.

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CHECKS } from './checks.js';
import { ALERTS, toGrafanaRule } from './alerts.js';
import { buildDashboard } from './dashboard.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_GRAFANA = join(ROOT, '.env.grafana');
const ENV_INFISICAL = join(ROOT, '.env.infisical');

const FOLDER = { uid: 'twinme', title: 'TwinMe' };
const RULE_GROUP = 'twinme';
const CONTACT = { uid: 'twinme-email', name: 'TwinMe · correo' };
const INGEST_POLICY = 'twinme-ingest';
const SM_POLICY = 'twinme-synthetics';
const SERVICE_ACCOUNT = 'twinme-provisioner';
const OBSERVABILITY_PATH = '/observability';

function loadEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ''),
        ];
      }),
  );
}

const env = { ...loadEnv(ENV_INFISICAL), ...loadEnv(ENV_GRAFANA), ...process.env };
const rotateIngest = process.argv.includes('--rotate-ingest');
const STACK = env.GRAFANA_STACK || 'juanber84';
const ALERT_EMAIL = env.GRAFANA_ALERT_EMAIL || 'juanber84@gmail.com';

if (!env.GRAFANA_CLOUD_ADMIN_TOKEN) {
  console.error(
    'Falta GRAFANA_CLOUD_ADMIN_TOKEN en .env.grafana (ver INSTALL.md, Observabilidad).',
  );
  process.exit(1);
}

const log = (msg) => console.log(`· ${msg}`);

/** fetch con JSON y error legible (sin enseñar cabeceras: llevan tokens). */
async function call(url, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(
      `${method} ${url.replace(/\?.*/, '')} → ${res.status}: ${text.slice(0, 300)}`,
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

// --------------------------------------------------------------------------- grafana.com

const COM = 'https://grafana.com/api';
const admin = env.GRAFANA_CLOUD_ADMIN_TOKEN;

async function getStack() {
  const s = await call(`${COM}/instances/${STACK}`, { token: admin });
  return {
    id: s.id,
    slug: s.slug,
    url: s.url,
    region: s.regionSlug,
    promUrl: `${s.hmInstancePromUrl}/api/prom/push`,
    promUser: String(s.hmInstancePromId),
    lokiUrl: `${s.hlInstanceUrl}/loki/api/v1/push`,
    lokiUser: String(s.hlInstanceId),
    // La pasarela OTLP del stack: usuario = id del stack
    otlpUrl: `https://otlp-gateway-${s.regionSlug}.grafana.net/otlp`,
    otlpUser: String(s.id),
    promId: s.hmInstancePromId,
    lokiId: s.hlInstanceId,
  };
}

async function ensurePolicy(stack, name, scopes) {
  const q = `region=${stack.region}`;
  const { items } = await call(`${COM}/v1/accesspolicies?${q}&name=${name}`, { token: admin });
  const existing = items.find((p) => p.name === name);
  const body = {
    name,
    displayName: name,
    scopes,
    realms: [{ type: 'stack', identifier: String(stack.id), labelPolicies: [] }],
  };
  if (existing) {
    await call(`${COM}/v1/accesspolicies/${existing.id}?${q}`, {
      method: 'POST',
      token: admin,
      body: { displayName: name, scopes, realms: body.realms },
    });
    return existing.id;
  }
  const created = await call(`${COM}/v1/accesspolicies?${q}`, {
    method: 'POST',
    token: admin,
    body,
  });
  log(`política ${name} creada`);
  return created.id;
}

async function createPolicyToken(stack, policyId, name) {
  const stamp = new Date().toISOString().slice(0, 10);
  const t = await call(`${COM}/v1/tokens?region=${stack.region}`, {
    method: 'POST',
    token: admin,
    body: {
      accessPolicyId: policyId,
      name: `${name}-${stamp}-${Date.now() % 100000}`,
      displayName: `${name} ${stamp}`,
    },
  });
  return t.token;
}

// ------------------------------------------------------------------------------- Infisical

async function infisical() {
  const domain = (env.INFISICAL_DOMAIN || 'https://app.infisical.com').replace(/\/$/, '');
  if (!env.INFISICAL_CLIENT_ID || !env.INFISICAL_CLIENT_SECRET || !env.INFISICAL_PROJECT_ID) {
    throw new Error(
      'Faltan INFISICAL_CLIENT_ID/INFISICAL_CLIENT_SECRET/INFISICAL_PROJECT_ID en .env.infisical',
    );
  }
  const { accessToken } = await call(`${domain}/api/v1/auth/universal-auth/login`, {
    method: 'POST',
    body: { clientId: env.INFISICAL_CLIENT_ID, clientSecret: env.INFISICAL_CLIENT_SECRET },
  });
  const base = { workspaceId: env.INFISICAL_PROJECT_ID, environment: 'prod' };
  const qs = (extra) =>
    new URLSearchParams({ ...base, secretPath: OBSERVABILITY_PATH, ...extra }).toString();

  return {
    async list() {
      try {
        const { secrets } = await call(`${domain}/api/v3/secrets/raw?${qs({})}`, {
          token: accessToken,
        });
        return Object.fromEntries(secrets.map((s) => [s.secretKey, s.secretValue]));
      } catch (err) {
        if (err.status === 404) return {};
        throw err;
      }
    },
    async ensureFolder() {
      try {
        await call(`${domain}/api/v1/folders`, {
          method: 'POST',
          token: accessToken,
          body: { ...base, name: OBSERVABILITY_PATH.slice(1), path: '/' },
        });
      } catch (err) {
        if (err.status !== 400 && err.status !== 409) throw err; // ya existe
      }
    },
    async set(values, existing) {
      for (const [secretKey, secretValue] of Object.entries(values)) {
        const body = { ...base, secretPath: OBSERVABILITY_PATH, secretValue, type: 'shared' };
        await call(`${domain}/api/v3/secrets/raw/${secretKey}`, {
          method: secretKey in existing ? 'PATCH' : 'POST',
          token: accessToken,
          body,
        });
      }
    },
  };
}

async function setupIngest(stack) {
  const policyId = await ensurePolicy(stack, INGEST_POLICY, [
    'metrics:write',
    'logs:write',
    'traces:write',
  ]);
  const vault = await infisical();
  const existing = await vault.list();
  const values = {
    GRAFANA_PROM_URL: stack.promUrl,
    GRAFANA_PROM_USER: stack.promUser,
    GRAFANA_LOKI_URL: stack.lokiUrl,
    GRAFANA_LOKI_USER: stack.lokiUser,
    GRAFANA_OTLP_URL: stack.otlpUrl,
    GRAFANA_OTLP_USER: stack.otlpUser,
  };
  if (rotateIngest || !existing.GRAFANA_INGEST_TOKEN) {
    values.GRAFANA_INGEST_TOKEN = await createPolicyToken(stack, policyId, 'twinme-vps');
    log('token de ingesta nuevo para digitaltwin-alloy');
  }
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => existing[k] !== v));
  if (Object.keys(changed).length) {
    await vault.ensureFolder();
    await vault.set(changed, existing);
    log(`Infisical prod ${OBSERVABILITY_PATH}: ${Object.keys(changed).join(', ')}`);
  } else log(`Infisical prod ${OBSERVABILITY_PATH} ya al día`);
}

// ------------------------------------------------------------------- Synthetic Monitoring

async function setupSynthetics(stack) {
  const api = `https://synthetic-monitoring-api-${stack.region.replace(/^prod-/, '')}.grafana.net/api/v1`;
  let token = env.GRAFANA_SM_TOKEN;
  if (!token) {
    const policyId = await ensurePolicy(stack, SM_POLICY, [
      'metrics:write',
      'logs:write',
      'traces:write',
      'stacks:read',
    ]);
    const publisher = await createPolicyToken(stack, policyId, 'twinme-synthetics');
    ({ accessToken: token } = await call(`${api}/register/install`, {
      method: 'POST',
      token: publisher,
      body: { stackId: stack.id, metricsInstanceId: stack.promId, logsInstanceId: stack.lokiId },
    }));
    appendFileSync(ENV_GRAFANA, `GRAFANA_SM_TOKEN=${token}\n`, { mode: 0o600 });
    log('Synthetic Monitoring activado (token en .env.grafana)');
  }

  const current = await call(`${api}/check/list`, { token });
  for (const c of CHECKS) {
    const check = {
      job: c.job,
      target: c.target,
      frequency: c.frequency,
      timeout: c.timeout,
      enabled: true,
      probes: c.probes,
      labels: [{ name: 'project', value: 'twinme' }],
      basicMetricsOnly: true,
      alertSensitivity: 'none',
      settings: {
        http: {
          method: 'GET',
          ipVersion: 'V4',
          noFollowRedirects: false,
          failIfNotSSL: true,
          failIfSSL: false,
          ...c.http,
        },
      },
    };
    const found = current.find((x) => x.job === c.job);
    if (found) {
      await call(`${api}/check/update`, {
        method: 'POST',
        token,
        body: { ...check, id: found.id, tenantId: found.tenantId },
      });
    } else await call(`${api}/check/add`, { method: 'POST', token, body: check });
    log(`comprobación ${c.job} → ${c.target} (${found ? 'actualizada' : 'creada'})`);
  }
}

// ---------------------------------------------------------------------------- Grafana

/** Token de 10 min de la cuenta de servicio (se crea la primera vez, rol Admin). */
async function grafanaToken(stack) {
  const proxy = `${COM}/instances/${stack.slug}/api`;
  const { serviceAccounts } = await call(
    `${proxy}/serviceaccounts/search?query=${SERVICE_ACCOUNT}`,
    { token: admin },
  );
  let sa = serviceAccounts.find((s) => s.name === SERVICE_ACCOUNT);
  sa ??= await call(`${proxy}/serviceaccounts`, {
    method: 'POST',
    token: admin,
    body: { name: SERVICE_ACCOUNT, role: 'Admin', isDisabled: false },
  });
  const { key } = await call(`${proxy}/serviceaccounts/${sa.id}/tokens`, {
    method: 'POST',
    token: admin,
    body: { name: `provision-${Date.now()}`, secondsToLive: 600 },
  });
  return key;
}

async function setupGrafana(stack) {
  const token = await grafanaToken(stack);
  const g = (path, opts = {}) =>
    call(`${stack.url}${path}`, {
      token,
      ...opts,
      // Editables desde la interfaz (si no, Grafana las bloquea por venir de la API)
      headers: { 'X-Disable-Provenance': 'true', ...opts.headers },
    });

  // Carpeta
  try {
    await g(`/api/folders/${FOLDER.uid}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    await g('/api/folders', { method: 'POST', body: FOLDER });
    log('carpeta TwinMe creada');
  }

  // Punto de contacto: correo
  const contact = {
    uid: CONTACT.uid,
    name: CONTACT.name,
    type: 'email',
    settings: { addresses: ALERT_EMAIL, singleEmail: true },
    disableResolveMessage: false,
  };
  const contacts = await g('/api/v1/provisioning/contact-points');
  if (contacts.some((c) => c.uid === CONTACT.uid)) {
    await g(`/api/v1/provisioning/contact-points/${CONTACT.uid}`, { method: 'PUT', body: contact });
  } else await g('/api/v1/provisioning/contact-points', { method: 'POST', body: contact });
  log(`avisos por correo a ${ALERT_EMAIL}`);

  // Ruta de avisos: lo de project=twinme va al correo; el resto del stack, como estuviera
  const tree = await g('/api/v1/provisioning/policies');
  const route = {
    receiver: CONTACT.name,
    object_matchers: [['project', '=', 'twinme']],
    group_by: ['alertname'],
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
  };
  const routes = (tree.routes ?? []).filter(
    (r) => !(r.object_matchers ?? []).some(([k, , v]) => k === 'project' && v === 'twinme'),
  );
  await g('/api/v1/provisioning/policies', {
    method: 'PUT',
    body: { ...tree, routes: [route, ...routes] },
  });
  log('ruta de avisos project=twinme → correo');

  // Alertas: el grupo entero de una vez (lo que ya no esté en alerts.js se borra)
  await g(`/api/v1/provisioning/folder/${FOLDER.uid}/rule-groups/${RULE_GROUP}`, {
    method: 'PUT',
    body: {
      title: RULE_GROUP,
      folderUid: FOLDER.uid,
      interval: 60,
      rules: ALERTS.map((a) => toGrafanaRule(a, FOLDER.uid, RULE_GROUP)),
    },
  });
  log(`${ALERTS.length} alertas`);

  // Dashboard
  const dashboard = buildDashboard();
  const saved = await g('/api/dashboards/db', {
    method: 'POST',
    body: {
      dashboard,
      folderUid: FOLDER.uid,
      overwrite: true,
      message: 'scripts/grafana/provision.js',
    },
  });
  log(`dashboard: ${stack.url}${saved.url}`);
}

// ------------------------------------------------------------------------------------ main

const stack = await getStack();
log(`stack ${stack.slug} (${stack.url}, ${stack.region})`);
await setupIngest(stack);
await setupSynthetics(stack);
await setupGrafana(stack);
log('listo');
