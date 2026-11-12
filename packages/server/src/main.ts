// Entry point: node packages/server/src/main.ts
// Environment (docs/DEVELOPMENT.md, "Server settings"):
//   HOST                default 0.0.0.0
//   PORT                default 3000
//   COLISEUMGRID_MODE   offline (default) or online

import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
const app = await buildApp({ clientDist, logger: true });
await app.listen({ host: config.host, port: config.port });
console.log(`coliseumgrid server (${config.mode} mode) listening on ${config.host}:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
