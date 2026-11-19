// The offline launcher: node packages/server/src/launcher.ts [--no-browser]
// The bundle's ColiseumGrid.cmd and coliseumgrid.sh start it (docs/PLAN.md section 8,
// "Offline: portable bundle"; docs/DEVELOPMENT.md, "Offline bundle").
//
// It picks the data folder and a port, then runs the server in this same process, so the
// window shows the server's log and closing it, or Ctrl+C, stops the server. When ColiseumGrid
// already answers on one of its ports, it opens the host screen there and exits.
// --no-browser skips opening the browser (the CI smoke test).
//
// Nothing from @coliseumgrid/core may be imported statically here: the resolve hook below has
// to be in place first, so the server is loaded with a dynamic import.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  browserCommand,
  candidatePorts,
  dataDirFor,
  hostUrl,
  isColiseumGridHealth,
  planLaunch,
  type PortState,
} from './launch.ts';

const noBrowser = process.argv.includes('--no-browser');
// The OS address the server will listen on; config.ts reads HOST the same way.
const listenHost = process.env['HOST'] || '0.0.0.0';

// Laid out as in the repo: <app>/packages/server/src/launcher.ts.
const appRoot = new URL('../../../', import.meta.url);
const coreEntry = new URL('packages/core/src/index.ts', appRoot).href;
const clientDist = fileURLToPath(new URL('packages/client/dist', appRoot));

/**
 * Something answers HTTP on the port: ColiseumGrid, or another program. A refused connection
 * still needs a bind test, because on Windows a program bound to one address can leave the
 * wildcard address free, and the reverse.
 */
async function probe(port: number): Promise<PortState> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body: unknown = await res.json().catch(() => null);
    return res.ok && isColiseumGridHealth(body) ? 'coliseumgrid' : 'busy';
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code !== 'ECONNREFUSED') return 'busy';
  }
  return (await canListen(port)) ? 'free' : 'busy';
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: listenHost, port }, () => server.close(() => resolve(true)));
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await probe(port)) === 'coliseumgrid') return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function openBrowser(url: string): void {
  if (noBrowser) return;
  const { command, args } = browserCommand(process.platform, url);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => console.log(`Open ${url} in your web browser.`));
    child.unref();
  } catch {
    console.log(`Open ${url} in your web browser.`);
  }
}

console.log('ColiseumGrid');
const dataDir = dataDirFor(process.platform, process.env, homedir());
mkdirSync(dataDir, { recursive: true });
console.log(`Your events are saved in ${dataDir}`);

const ports = candidatePorts();
const probes = await Promise.all(ports.map(async (port) => ({ port, state: await probe(port) })));
const plan = planLaunch(probes);

if (plan.action === 'open') {
  const url = hostUrl(plan.port);
  console.log(`ColiseumGrid is already running. Opening the host screen: ${url}`);
  openBrowser(url);
  process.exit(0);
}
if (plan.action === 'none') {
  console.log(`Ports ${ports[0]} to ${ports.at(-1)} are all in use by other programs.`);
  console.log('Close one of them, then start ColiseumGrid again.');
  process.exit(1);
}
if (plan.skipped.length > 0) {
  const taken = plan.skipped.length === 1 ? `Port ${plan.skipped[0]} is` : `Ports ${plan.skipped[0]} to ${plan.skipped.at(-1)} are`;
  console.log(`${taken} in use by another program, so ColiseumGrid uses port ${plan.port}.`);
}
if (!existsSync(clientDist)) {
  console.log(`The app's screens are missing from ${clientDist}. Unzip ColiseumGrid again.`);
  process.exit(1);
}

process.env['PORT'] = String(plan.port);
process.env['DATA_DIR'] = dataDir;
process.env['CLIENT_DIST'] = clientDist;

// Node won't strip types from a .ts file under node_modules
// (https://nodejs.org/docs/latest-v26.x/api/typescript.html, "Type stripping";
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). In the repo, node_modules/@coliseumgrid/core
// is a pnpm symlink whose real path is packages/core/src, so it works. The bundle has no
// symlinks (a zip made on Linux can't carry them to Windows), so this hook sends the import
// straight to core's source, the same file the symlink reaches. module.registerHooks is
// "Release candidate" in the Node 26.13.1 docs (checked 2026-11-19); the async
// module.register it replaced is deprecated
// (https://nodejs.org/docs/latest-v26.x/api/module.html#moduleregisterhooksoptions).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@coliseumgrid/core') return { url: coreEntry, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

console.log(`Starting ColiseumGrid on port ${plan.port}...`);
await import('./main.ts');

if (!(await waitForHealth(plan.port, 30_000))) {
  console.log('ColiseumGrid started but does not answer. Close this window and try again.');
  process.exit(1);
}
const url = hostUrl(plan.port);
console.log('');
console.log('ColiseumGrid is running.');
console.log(`Host screen: ${url}`);
console.log('Keep this window open while you play. To stop ColiseumGrid, close this window or press Ctrl+C.');
console.log('');
openBrowser(url);
