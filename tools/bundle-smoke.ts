// Starts an unpacked offline bundle and checks it (docs/DEVELOPMENT.md, "Offline bundle").
// Usage: node tools/bundle-smoke.ts <unpacked ColiseumGrid folder> [--node <node binary>]
//
// Without --node it runs the folder's own start script, ColiseumGrid.cmd on Windows and
// coliseumgrid.sh elsewhere. With --node it runs that binary on app/packages/server/src/launcher.ts,
// which is what both scripts do; that is how the Windows layout is checked with Linux's Node.
// The launcher gets --no-browser. The checks: /api/health is ColiseumGrid's, / is the client's
// page, the data folder it printed exists, and a second launch finds the first and exits 0.
// The data folder is the real per-user one (HOME, or LOCALAPPDATA on Windows), so point HOME
// at a scratch folder when running it on a machine you use.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { node: { type: 'string' } } });
const folder = positionals[0];
if (!folder || positionals.length !== 1) {
  console.error('Usage: node tools/bundle-smoke.ts <unpacked ColiseumGrid folder> [--node <node binary>]');
  process.exit(2);
}
const bundle = resolve(folder);
const windows = process.platform === 'win32';

function command(): { file: string; args: string[] } {
  if (values.node) {
    return { file: values.node, args: [join(bundle, 'app/packages/server/src/launcher.ts'), '--no-browser'] };
  }
  // A .cmd file needs cmd.exe to run it
  // (https://nodejs.org/docs/latest-v26.x/api/child_process.html, "Spawning .bat and .cmd files on Windows").
  if (windows) return { file: 'cmd.exe', args: ['/d', '/c', join(bundle, 'ColiseumGrid.cmd'), '--no-browser'] };
  return { file: join(bundle, 'coliseumgrid.sh'), args: ['--no-browser'] };
}

type Run = { child: ChildProcess; output: () => string; exited: Promise<number | null> };

function launch(label: string): Run {
  const { file, args } = command();
  // stdin is empty, so the .cmd file's pause after an error doesn't wait.
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  const take = (chunk: Buffer) => {
    text += chunk.toString();
    for (const line of chunk.toString().split(/\r?\n/)) if (line) console.log(`[${label}] ${line}`);
  };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  return { child, output: () => text, exited };
}

async function waitFor<T>(what: string, ms: number, check: () => T | undefined): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = check();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

// taskkill /T ends cmd.exe and the node.exe it started
// (https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).
// Elsewhere the script exec's node, so SIGINT reaches the server, which closes and exits.
async function stop(run: Run): Promise<void> {
  if (windows) spawnSync('taskkill', ['/pid', String(run.child.pid), '/T', '/F']);
  else run.child.kill('SIGINT');
  await run.exited;
}

const failures: string[] = [];
const first = launch('first');
try {
  const port = await waitFor('the host screen address', 60_000, () => {
    const match = /Host screen: http:\/\/localhost:(\d+)\/host/.exec(first.output());
    if (match) return Number(match[1]);
    if (first.child.exitCode !== null) throw new Error(`The launcher exited with code ${first.child.exitCode}.`);
    return undefined;
  });

  const health = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as Record<string, unknown>;
  if (health['status'] !== 'ok' || health['app'] !== 'coliseumgrid') failures.push(`/api/health: ${JSON.stringify(health)}`);
  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  if (!page.includes('id="root"')) failures.push('/ is not the client page');

  const dataDir = /Your events are saved in (.+)/.exec(first.output())?.[1]?.trim();
  if (!dataDir || !existsSync(join(dataDir, 'coliseumgrid.db'))) failures.push(`no database in the data folder (${dataDir})`);

  const second = launch('second');
  const code = await Promise.race([second.exited, new Promise<'timeout'>((done) => setTimeout(() => done('timeout'), 30_000))]);
  if (code === 'timeout') {
    await stop(second);
    failures.push('the second launch did not exit');
  } else if (code !== 0 || !second.output().includes(`already running. Opening the host screen: http://localhost:${port}/host`)) {
    failures.push(`the second launch exited with ${code} without finding port ${port}`);
  }
  console.log(`Checked port ${port}.`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await stop(first);
}

if (failures.length > 0) {
  console.error(`Bundle check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('Bundle check passed.');
