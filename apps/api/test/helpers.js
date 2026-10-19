import { createLogger } from '@digitaltwin/logger';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';

export function buildApp(env = {}, deps = {}) {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...env });
  return createApp({ config, logger: createLogger({ level: 'silent', pretty: false }), ...deps });
}
