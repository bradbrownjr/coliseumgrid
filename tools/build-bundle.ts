// Builds the offline bundle: the Node runtime, the server and core source with production
// dependencies only, the built client, and the launcher (docs/DEVELOPMENT.md, "Offline bundle").
// Usage: pnpm build, then
//   node tools/build-bundle.ts <linux-x64|win-x64>... [--label <name>] [--node <version>]
//                              [--out <folder>] [--cache <folder>]
//   --label  goes in the file name: ColiseumGrid-<label>-<target>.zip or .tar.gz (default dev)
//   --node   the Node version to ship (default: the newest release matching .nvmrc)
//   --out    where the archives go (default bundle-out, which git ignores)
//   --cache  where Node downloads are kept between runs (default ~/.cache/coliseumgrid/node)
//
// Both targets build on Linux: the bundle has no native modules (node:sqlite is part of Node),
// so only the Node binary differs between them. Needs pnpm, tar with xz, zip, and unzip.
//
// Two facts shape the layout:
// - Node won't strip types from a .ts file under node_modules
//   (https://nodejs.org/docs/latest-v26.x/api/typescript.html, "Type stripping"). So core and
//   server stay in packages/, and the launcher's resolve hook points @coliseumgrid/core at
//   packages/core/src/index.ts (packages/server/src/launcher.ts).
// - A zip made on Linux doesn't give Windows usable symlinks, and pnpm's default isolated
//   node_modules is made of them. nodeLinker "hoisted" makes "a flat node_modules without
//   symlinks", like npm's (https://pnpm.io/settings/node-modules#nodelinker). pnpm still links
//   workspace packages and command shims (.bin), so those are removed, and the build fails if
//   any symlink is left.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

type Target = 'linux-x64' | 'win-x64';

// The parts of each target that differ. Node's file names are those in
// https://nodejs.org/dist/v<version>/ (listed in its SHASUMS256.txt).
const TARGETS = {
  'linux-x64': {
    nodeArchive: (v: string) => `node-v${v}-linux-x64.tar.xz`,
    nodeBinary: 'bin/node',
    bundledNode: 'node',
    launchers: ['coliseumgrid.sh', 'coliseumgrid.desktop'],
    archive: 'tar.gz',
  },
  'win-x64': {
    nodeArchive: (v: string) => `node-v${v}-win-x64.zip`,
    nodeBinary: 'node.exe',
    bundledNode: 'node.exe',
    launchers: ['ColiseumGrid.cmd'],
    archive: 'zip',
  },
} as const;

const root = resolve(new URL('..', import.meta.url).pathname);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: 'string', default: 'dev' },
    node: { type: 'string' },
    out: { type: 'string', default: join(root, 'bundle-out') },
    cache: { type: 'string' },
  },
});

const targets = positionals.filter((t): t is Target => t in TARGETS);
if (targets.length === 0 || targets.length !== positionals.length) {
  console.error(`Usage: node tools/build-bundle.ts <${Object.keys(TARGETS).join('|')}>... [--label <name>]`);
  process.exit(2);
}
if (!/^[\w.-]+$/.test(values.label)) {
  console.error('--label may use letters, digits, dots, dashes, and underscores only.');
  process.exit(2);
}
const clientDist = join(root, 'packages/client/dist');
if (!existsSync(join(clientDist, 'index.html'))) {
  console.error('No built client in packages/client/dist. Run pnpm build first.');
  process.exit(1);
}

const out = resolve(values.out);
const cache = resolve(
  values.cache ?? join(process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache'), 'coliseumgrid', 'node'),
);
const work = join(out, 'work');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * The newest release matching .nvmrc ("26" matches every 26.x.y), read from the release index
 * at https://nodejs.org/dist/index.json, the list actions/setup-node also reads
 * (src/distributions/base-distribution.ts in https://github.com/actions/setup-node).
 */
async function resolveNodeVersion(): Promise<string> {
  if (values.node) return values.node.replace(/^v/, '');
  const spec = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
  const index = JSON.parse((await download('https://nodejs.org/dist/index.json')).toString('utf8')) as {
    version: string;
  }[];
  const matching = index
    .map((r) => r.version.replace(/^v/, ''))
    .filter((v) => v === spec || v.startsWith(`${spec}.`))
    .sort(compareVersions);
  const newest = matching.at(-1);
  if (!newest) throw new Error(`No Node release matches .nvmrc (${spec}).`);
  return newest;
}

/**
 * Node's archive for the target, kept in the cache and checked against the release's
 * SHASUMS256.txt every time, as Node's README describes ("Verifying binaries",
 * https://github.com/nodejs/node#verifying-binaries). Both files come from nodejs.org over
 * HTTPS. The README's further step, checking the PGP signature on SHASUMS256.txt.asc, is not
 * done here.
 */
async function nodeArchive(version: string, file: string): Promise<string> {
  const dir = join(cache, `v${version}`);
  mkdirSync(dir, { recursive: true });
  const sumsPath = join(dir, 'SHASUMS256.txt');
  if (!existsSync(sumsPath)) {
    writeFileSync(sumsPath, await download(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`));
  }
  const expected = readFileSync(sumsPath, 'utf8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === file)?.[0];
  if (!expected) throw new Error(`${file} is not in SHASUMS256.txt for v${version}.`);
  const path = join(dir, file);
  if (!existsSync(path)) {
    console.log(`Downloading ${file}`);
    writeFileSync(path, await download(`https://nodejs.org/dist/v${version}/${file}`));
  }
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) {
    rmSync(path);
    throw new Error(`${file} does not match SHASUMS256.txt (got ${actual}). The download was removed; run again.`);
  }
  return path;
}

function walk(dir: string, visit: (path: string, isLink: boolean) => void): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const isLink = lstatSync(path).isSymbolicLink();
    visit(path, isLink);
    if (!isLink && statSync(path).isDirectory()) walk(path, visit);
  }
}

function assertNoSymlinks(dir: string): void {
  const links: string[] = [];
  walk(dir, (path, isLink) => {
    if (isLink) links.push(relative(dir, path));
  });
  if (links.length > 0) throw new Error(`The bundle may not contain symlinks:\n  ${links.join('\n  ')}`);
}

/**
 * A package limited to some systems (package.json "os" or "cpu") would be installed for the
 * build machine only, and the other target would miss it. None is a production dependency
 * today; this keeps it that way.
 */
function assertNoPlatformPackages(nodeModules: string): void {
  const found: string[] = [];
  walk(nodeModules, (path, isLink) => {
    if (isLink || !path.endsWith('package.json')) return;
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; os?: unknown; cpu?: unknown };
    if (pkg.name && (pkg.os || pkg.cpu)) found.push(pkg.name);
  });
  if (found.length > 0) throw new Error(`These packages are built for some systems only: ${found.join(', ')}`);
}

/** The app folder, the same for every target: <work>/app. */
function stageApp(): string {
  const app = join(work, 'app');
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    cpSync(join(root, file), join(app, file));
  }
  // Every workspace package.json is needed for the frozen lockfile to match.
  for (const pkg of ['core', 'server', 'client']) {
    cpSync(join(root, 'packages', pkg, 'package.json'), join(app, 'packages', pkg, 'package.json'));
  }
  for (const pkg of ['core', 'server']) {
    cpSync(join(root, 'packages', pkg, 'src'), join(app, 'packages', pkg, 'src'), { recursive: true });
  }
  run(
    'pnpm',
    [
      'install',
      '--frozen-lockfile',
      '--prod',
      '--filter',
      '@coliseumgrid/server...',
      '--config.node-linker=hoisted',
    ],
    app,
  );
  // The workspace links (whose targets are packages/ in this same folder), command shims, and
  // pnpm's own bookkeeping. Nothing at run time reads them.
  for (const modules of [join(app, 'node_modules'), join(app, 'packages/server/node_modules')]) {
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      if (name === '@coliseumgrid' || name === '.bin' || name.startsWith('.pnpm') || name.startsWith('.modules')) {
        rmSync(join(modules, name), { recursive: true, force: true });
      }
    }
    if (readdirSync(modules).length === 0) rmSync(modules, { recursive: true });
  }
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/client/package.json']) {
    rmSync(join(app, file));
  }
  cpSync(clientDist, join(app, 'packages/client/dist'), { recursive: true });
  assertNoSymlinks(app);
  assertNoPlatformPackages(join(app, 'node_modules'));
  return app;
}

function extractNode(target: Target, archive: string, version: string, into: string): void {
  const t = TARGETS[target];
  const top = `node-v${version}-${target}`;
  const tmp = join(work, `${target}-node`);
  mkdirSync(tmp, { recursive: true });
  if (t.archive === 'zip') {
    run('unzip', ['-q', '-o', archive, `${top}/${t.nodeBinary}`, `${top}/LICENSE`, '-d', tmp], work);
  } else {
    run('tar', ['-xJf', archive, '-C', tmp, `${top}/${t.nodeBinary}`, `${top}/LICENSE`], work);
  }
  mkdirSync(into, { recursive: true });
  cpSync(join(tmp, top, t.nodeBinary), join(into, t.bundledNode));
  cpSync(join(tmp, top, 'LICENSE'), join(into, 'LICENSE'));
  chmodSync(join(into, t.bundledNode), 0o755);
}

function addLaunchers(target: Target, bundle: string): void {
  for (const name of TARGETS[target].launchers) {
    let text = readFileSync(join(root, 'deploy/bundle', name), 'utf8');
    // cmd.exe reads batch files with Windows line endings, whatever git checked out.
    if (name.endsWith('.cmd')) text = text.replace(/\r?\n/g, '\r\n');
    writeFileSync(join(bundle, name), text);
    if (name.endsWith('.sh')) chmodSync(join(bundle, name), 0o755);
  }
  cpSync(join(root, 'LICENSE'), join(bundle, 'LICENSE'));
}

function archive(target: Target, parent: string): string {
  const file = join(out, `ColiseumGrid-${values.label}-${target}.${TARGETS[target].archive}`);
  rmSync(file, { force: true });
  if (TARGETS[target].archive === 'zip') {
    // -X leaves out Unix owner and extra attributes.
    run('zip', ['-q', '-r', '-X', file, 'ColiseumGrid'], parent);
  } else {
    run('tar', ['--owner=0', '--group=0', '--numeric-owner', '-czf', file, 'ColiseumGrid'], parent);
  }
  return file;
}

const version = await resolveNodeVersion();
console.log(`Node ${version}, targets ${targets.join(', ')}`);
const app = stageApp();
for (const target of targets) {
  const parent = join(work, target);
  const bundle = join(parent, 'ColiseumGrid');
  cpSync(app, join(bundle, 'app'), { recursive: true });
  extractNode(target, await nodeArchive(version, TARGETS[target].nodeArchive(version)), version, join(bundle, 'node'));
  addLaunchers(target, bundle);
  assertNoSymlinks(bundle);
  const file = archive(target, parent);
  console.log(`${relative(process.cwd(), file)}: ${(statSync(file).size / 1024 / 1024).toFixed(1)} MiB`);
}
rmSync(work, { recursive: true, force: true });
