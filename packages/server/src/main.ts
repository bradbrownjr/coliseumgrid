// Entry point: node packages/server/src/main.ts
// Environment (docs/DEVELOPMENT.md, "Server settings"):
//   HOST                default 0.0.0.0
//   PORT                default 3000
//   COLISEUMGRID_MODE   offline (default) or online
//   CLIENT_DIST         the built client to serve; default packages/client/dist
//   DATA_DIR            the folder for the database; default ./data (the image sets /data)
//   TRUSTED_PROXY       the reverse proxy's IP; only its X-Forwarded-For is read
//   COLISEUMGRID_HOST_PASSWORD  the host password (8 to 128 characters); required online

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './database.ts';
import { startupWarnings } from './startup-warnings.ts';

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// The default is found from this file, not the working directory, so it works from any folder.
const clientDist = process.env['CLIENT_DIST'] || fileURLToPath(new URL('../../client/dist', import.meta.url));
for (const warning of startupWarnings(config)) console.warn(`Warning: ${warning}`);
const db = openDatabase(join(config.dataDir, 'coliseumgrid.db'));
const app = await buildApp({
  clientDist,
  logger: true,
  db,
  mode: config.mode,
  ...(config.trustedProxy && { trustedProxy: config.trustedProxy }),
  ...(config.hostPassword && { hostPassword: config.hostPassword }),
});
await app.listen({ host: config.host, port: config.port });
console.log(`coliseumgrid server (${config.mode} mode) listening on ${config.host}:${config.port}`);
if (config.mode === 'offline' && !config.hostPassword) {
  console.log(`Host password: open http://localhost:${config.port}/host on this computer to set it.`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
