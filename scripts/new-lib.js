#!/usr/bin/env node
// Uso: npm run new:lib <nombre>   ->  crea packages/<nombre> como @digitaltwin/<nombre>
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Uso: npm run new:lib <nombre>  (minúsculas, números y guiones)');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'packages', name);
if (existsSync(dir)) {
  console.error(`Ya existe packages/${name}`);
  process.exit(1);
}

const files = {
  'package.json':
    JSON.stringify(
      {
        name: `@digitaltwin/${name}`,
        version: '0.1.0',
        private: true,
        type: 'module',
        main: './src/index.js',
        exports: { '.': './src/index.js' },
        scripts: { test: 'vitest run' },
      },
      null,
      2,
    ) + '\n',
  'vitest.config.js': `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: '${name}', environment: 'node' },
});
`,
  'src/index.js': `export function hello(who = 'world') {
  return \`hello \${who}\`;
}
`,
  'test/index.test.js': `import { describe, it, expect } from 'vitest';
import { hello } from '../src/index.js';

describe('${name}', () => {
  it('saluda', () => {
    expect(hello('twin')).toBe('hello twin');
  });
});
`,
  'README.md': `# @digitaltwin/${name}\n`,
};

for (const [file, content] of Object.entries(files)) {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

console.log(`Creada packages/${name} (@digitaltwin/${name}).`);
console.log('Ejecuta "npm install" para enlazarla en el workspace.');
console.log(`Para usarla en la API: npm install @digitaltwin/${name} -w @digitaltwin/api`);
