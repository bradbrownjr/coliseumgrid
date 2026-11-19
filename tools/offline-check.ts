// M9's acceptance check for hard rule 3, "Offline first": the built app makes no request off
// the local network. Usage: pnpm build, then `pnpm check:offline` (node tools/offline-check.ts).
//
// It has two parts.
//
// 1. Static: every absolute http(s) URL in packages/client/dist must have a host on a short,
//    explained allow-list. A template placeholder host (`http://${x}`) is skipped and listed
//    in the summary. Each entry is text in a library's error message, a namespace, or an
//    example, never something the page fetches.
// 2. Browser: it starts the real server (offline mode, a free port, a temporary data folder),
//    drives every screen in headless Chromium, and records every request the pages, the
//    workers, and the service worker make, plus every WebSocket. Any host that isn't this
//    machine fails the check. `data:` and `blob:` are fine. Push is online-only (docs/PLAN.md,
//    "Player view"), so a push request is not allowed here either: there is no exception.
//
// Offending requests are also aborted, and Chromium resolves no name but this machine's, so a
// failing run never reaches the network. Like print-check, it needs a Chromium
// (`pnpm --filter @coliseumgrid/core exec playwright install chromium` once). Exit code 1 if
// anything fails.

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'packages/client/dist');

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

// Static pass ------------------------------------------------------------------------------

/**
 * Hosts allowed to appear in the built client as text. None is a request: each is in a string a
 * library shows in an error message, in a code comment, or in a namespace name, and the last
 * two ("localhost", "192.168.1.20") belong to this app's address handling.
 */
const ALLOWED_TEXT: Record<string, string> = {
  'www.w3.org': 'XML namespace names (SVG, MathML, xlink, xml). They name a vocabulary and are never fetched.',
  'react.dev': 'Link text in React error messages, shown to a developer. Never fetched.',
  'mui.com': 'Link text in MUI error and warning messages. Never fetched.',
  'reactrouter.com': 'Link text in a React Router error message. Never fetched.',
  'github.com': 'Link text in a React Router warning that names a polyfill. Never fetched.',
  localhost: 'The base that React Router resolves a relative path against with `new URL`. Parsing only, never fetched.',
  '192.168.1.20': 'The example address in the pairing panel help text (PairingPanel).',
};

if (!statSync(dist, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('packages/client/dist is missing. Run pnpm build first.');
  process.exit(2);
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const textFile = /\.(js|css|html|webmanifest|json|svg|txt|map)$/;
const urlPattern = /https?:\/\/([^\s/:"'`)<>\\?#]+)/g;
const foundHosts = new Map<string, string>();
// A host that is a template placeholder (`http://${x}`) is not a fixed host: its value is only
// known at run time, and the minifier renames the variable on every build, so no allow-list
// entry could key on it. The browser pass checks the real requests such a template makes. Each
// one is listed in the summary so a reviewer still sees it.
const skippedTemplates = new Set<string>();
let scanned = 0;
for (const file of walk(dist).filter((f) => textFile.test(f))) {
  scanned++;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(urlPattern)) {
    const host = match[1] ?? '';
    if (host.startsWith('${')) {
      const at = match.index ?? 0;
      const around = text.slice(Math.max(0, at - 20), at + match[0].length + 20).replace(/\s+/g, ' ');
      skippedTemplates.add(`${file.slice(dist.length + 1)}: ...${around}...`);
      continue;
    }
    if (!foundHosts.has(host)) foundHosts.set(host, file.slice(dist.length + 1));
  }
}
console.log(`static: ${scanned} built text files, ${foundHosts.size} distinct hosts in absolute URLs`);
console.log(`static: ${skippedTemplates.size} template host(s) skipped (a placeholder has no fixed value; the browser pass checks the requests it makes)`);
for (const template of skippedTemplates) console.log(`  skipped template: ${template}`);
for (const [host, file] of foundHosts) {
  const why = ALLOWED_TEXT[host];
  check(why !== undefined, `static: ${host} (first seen in ${file})${why ? ` is text only: ${why}` : ' is not on the allow-list. Remove the URL or explain it in ALLOWED_TEXT.'}`);
}

// Browser pass ---------------------------------------------------------------------------------

// playwright is a dependency of packages/core only. Its objects are used as they come, so they
// are typed `any` here, as in print-check.
const require = createRequire(`${root}packages/core/package.json`);
const { chromium } = require('playwright') as { chromium: { launch: (options: object) => Promise<any> } };

const freePort = (): Promise<number> =>
  new Promise((resolvePort) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), 'coliseumgrid-offline-check-'));
const server = spawn('node', ['packages/server/src/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, COLISEUMGRID_MODE: 'offline' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (data) => process.stdout.write(`[server] ${data}`));
server.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));

// Two names for this machine. The host laptop opens the app as 127.0.0.1 (the server then treats
// it as the host without a password). Tablets, TVs, and phones reach it by another name, which
// is how the server sees them, so they use LAN_NAME. Chromium maps it to 127.0.0.1, so it never
// leaves the machine.
const LAN_NAME = 'lan.test';
const ownHosts = new Set(['127.0.0.1', 'localhost', LAN_NAME]);
const local = `http://127.0.0.1:${port}`;
const lan = `http://${LAN_NAME}:${port}`;

// Up to a minute: the machine may be busy.
for (let tries = 0; tries < 600; tries++) {
  if (server.exitCode !== null) {
    console.error(`the server exited with code ${server.exitCode}`);
    process.exit(1);
  }
  try {
    if ((await fetch(`${local}/api/host/session`)).ok) break;
  } catch {
    // Not listening yet.
  }
  await new Promise((done) => setTimeout(done, 100));
}

interface Seen {
  kind: string;
  url: string;
}
const seen: Seen[] = [];
const routes: string[] = [];
const offNetwork: Seen[] = [];

/** Whether a URL stays on this machine. `data:` and `blob:` make no request; `about:` is the blank page. */
const staysHome = (url: string): boolean => {
  const parsed = new URL(url);
  if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return true;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
  return ownHosts.has(parsed.hostname) && parsed.port === String(port);
};
const record = (kind: string, url: string): void => {
  seen.push({ kind, url });
  if (!staysHome(url)) offNetwork.push({ kind, url });
};

const browser = await chromium.launch({
  // Every name but this machine's fails to resolve, so nothing can leave even if it is asked to.
  args: [`--host-resolver-rules=MAP ${LAN_NAME} 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`],
});

/** A browser context whose every request, worker, and WebSocket is recorded and, if off the machine, aborted. */
const open = async (baseURL: string, extra: object = {}): Promise<any> => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, baseURL, ...extra });
  // Browser-side code is given as strings: tools/ is type-checked without the DOM types.
  await context.addInitScript({ content: 'window.print = () => {};' });
  context.on('request', (request: any) => record(request.serviceWorker() ? 'service worker' : request.resourceType(), request.url()));
  context.on('serviceworker', (worker: any) => record('service worker script', worker.url()));
  context.on('page', (page: any) => {
    page.on('websocket', (socket: any) => record('websocket', socket.url()));
    page.on('worker', (worker: any) => record('worker script', worker.url()));
  });
  await context.route('**/*', (route: any) => (staysHome(route.request().url()) ? route.fallback() : route.abort()));
  await context.routeWebSocket(/.*/, (socket: any) => {
    if (staysHome(socket.url())) socket.connectToServer();
    else socket.close();
  });
  return context;
};

/**
 * Calls the API from inside a page, so the call uses the browser's cookies and its name for this
 * machine (Playwright's own request client doesn't know the LAN name). The page must already be
 * on the server's origin.
 */
const api = (page: any) => async (path: string, data?: object, method = data ? 'POST' : 'GET'): Promise<any> => {
  const result = await page.evaluate(
    `(async () => {
      const res = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: ${data ? "{ 'content-type': 'application/json' }" : '{}'}, ${data ? `body: ${JSON.stringify(JSON.stringify(data))}` : ''} });
      return { ok: res.ok, status: res.status, text: await res.text() };
    })()`,
  );
  if (!result.ok) throw new Error(`${method} ${path} ${result.status} ${result.text}`);
  return result.text === '' ? null : JSON.parse(result.text);
};

/** A page on the server's origin with nothing on it, for API calls. */
const blank = async (context: any, base: string): Promise<any> => {
  const page = await context.newPage();
  await page.goto(`${base}/api/health`);
  return page;
};

/** Visits a route and waits for it to settle, so lazily loaded fonts and icons are requested. */
const visit = async (page: any, base: string, path: string, ready: () => Promise<unknown>): Promise<void> => {
  await page.goto(`${base}${path}`);
  await ready();
  await page.evaluate('document.fonts.ready');
  await page.waitForLoadState('networkidle');
  routes.push(`${base === local ? '127.0.0.1' : LAN_NAME}${path}`);
};

try {
  // The laptop is the host: no sign-in, and it can set the first-run password. ---------------
  const laptop = await open(local);
  const laptopPage = await laptop.newPage();
  await laptopPage.goto(`${local}/api/health`);
  const asLaptop = api(laptopPage);
  const password = 'offline-check-password';

  // The laptop is already the host, so on a fresh server /host shows the first-run password panel
  // only when the server says the laptop can set one up; either way, the screen is visited.
  await laptopPage.goto(`${local}/host`);
  await laptopPage.waitForLoadState('networkidle');
  routes.push(`127.0.0.1/host (first visit, before a password: ${(await laptopPage.getByText('Choose a host password').count()) ? 'password panel' : 'host screen'})`);
  await asLaptop('/api/host/setup', { password });

  // The join page, signed out. -----------------------------------------------------------------
  const lanContext = await open(lan);
  const lanPage = await lanContext.newPage();
  await visit(lanPage, lan, '/', () => lanPage.getByLabel(/code/i).first().waitFor());
  // Routes behind a gate send an unpaired browser to the join page.
  await visit(lanPage, lan, '/display', () => lanPage.getByLabel(/code/i).first().waitFor());
  await visit(lanPage, lan, '/signup', () => lanPage.getByLabel(/code/i).first().waitFor());
  await visit(lanPage, lan, '/no-such-page', () => lanPage.getByLabel(/code/i).first().waitFor());
  // The phone page with nobody signed in: the follow flow.
  await visit(lanPage, lan, '/follow', () => lanPage.getByLabel('Handle').waitFor());

  // The host screen, from another device: the sign-in panel, then the screen. ----------------------
  const hostContext = await open(lan);
  const hostPage = await hostContext.newPage();
  await visit(hostPage, lan, '/host', () => hostPage.getByLabel('Host password').waitFor());
  await hostPage.getByLabel('Host password').fill(password);
  await hostPage.getByRole('button', { name: 'Sign in' }).click();
  await hostPage.getByRole('heading', { name: 'Name and game' }).first().waitFor({ timeout: 15000 }).catch(() => hostPage.getByRole('textbox').first().waitFor());
  await hostPage.waitForLoadState('networkidle');
  const asHost = api(hostPage);

  // The laptop's own view of /host. ---------------------------------------------------------------
  await visit(laptopPage, local, '/host', () => laptopPage.getByRole('textbox').first().waitFor());

  // Pairing: the panel makes a code, and the real API pairs a Display and a Sign-up screen. ---------
  const pairingButton = hostPage.getByRole('button', { name: 'Add a sign-up tablet' });
  await pairingButton.waitFor();
  await pairingButton.click();
  await hostPage.getByLabel('Address for other screens').waitFor().catch(() => undefined);
  await hostPage.getByRole('button', { name: 'Add a TV' }).click();
  await hostPage.waitForLoadState('networkidle');
  routes.push(`${LAN_NAME}/host (pairing panel, QR codes)`);

  const pair = async (role: 'display' | 'signup'): Promise<any> => {
    const context = await open(lan);
    const { code } = await asHost('/api/pairing/codes', { role });
    await api(await blank(context, lan))('/api/devices/join', { code });
    return context;
  };
  const displayContext = await pair('display');
  const signupContext = await pair('signup');
  const displayPage = await displayContext.newPage();
  const signupPage = await signupContext.newPage();

  // The join page with a code in the address joins at once. ------------------------------------------
  const joinContext = await open(lan);
  const joinPage = await joinContext.newPage();
  const { code: urlCode } = await asHost('/api/pairing/codes', { role: 'display' });
  await joinPage.goto(`${lan}/?code=${urlCode}`);
  await joinPage.waitForURL(`${lan}/display`);
  await joinPage.waitForLoadState('networkidle');
  routes.push(`${LAN_NAME}/?code= (joins, then /display)`);
  await joinContext.close();

  // The event, and the sign-up screen. ----------------------------------------------------------------
  await asHost('/api/event', { name: 'Offline Check Cup', game: 'Fighting game' }, 'PUT');
  await visit(displayPage, lan, '/display', () => displayPage.waitForLoadState('networkidle'));
  await visit(signupPage, lan, '/signup', () => signupPage.getByLabel('Handle').waitFor());

  // One sign-up through the screen: handle, PIN, done. -------------------------------------------------
  await signupPage.getByLabel('Handle').fill('ZapCheck');
  await signupPage.getByRole('button', { name: 'Next' }).click();
  await signupPage.getByRole('button', { name: 'Keep' }).click();
  await signupPage.getByRole('button', { name: 'Keep' }).waitFor({ state: 'detached' });
  await signupPage.waitForLoadState('networkidle');
  routes.push(`${LAN_NAME}/signup (handle, PIN, done)`);

  // The same handle again: the "is it you" and PIN-claim steps. -------------------------------------------
  await signupPage.reload();
  await signupPage.getByLabel('Handle').fill('ZapCheck');
  await signupPage.getByRole('button', { name: 'Next' }).click();
  await signupPage.getByRole('button', { name: "It's me" }).click();
  await signupPage.getByRole('button', { name: 'Delete last number' }).waitFor();
  await signupPage.waitForLoadState('networkidle');
  routes.push(`${LAN_NAME}/signup (taken handle, PIN keypad)`);

  // Players for the bracket, signed up through the real API. --------------------------------------------
  const handles = ['KaiCheck', 'BlazeCheck', 'NovaCheck', 'RexCheck', 'IvyCheck'];
  const signedUp: { id: number; handle: string }[] = [];
  for (const [i, handle] of handles.entries()) {
    const answer = await api(signupPage)('/api/signup', { handle, pin: `${1000 + i * 7}` });
    signedUp.push(answer.player);
  }
  const { players } = await asHost('/api/players');
  const ids: number[] = players.map((p: { id: number }) => p.id);

  // The setup wizard, through the screen: name and game, how to play, start. -----------------------------
  await hostPage.reload();
  await hostPage.getByRole('textbox').first().waitFor();
  await hostPage.waitForLoadState('networkidle');
  await hostPage.getByRole('button', { name: 'Next' }).click();
  await hostPage.waitForLoadState('networkidle');
  await hostPage.getByRole('button', { name: 'Next' }).click();
  await hostPage.waitForLoadState('networkidle');
  routes.push(`${LAN_NAME}/host (wizard: name, how to play, start)`);
  await hostPage.getByRole('button', { name: 'Start' }).click();
  await hostPage.waitForLoadState('networkidle');
  await hostPage.getByRole('heading', { name: 'Name tags' }).waitFor();
  routes.push(`${LAN_NAME}/host (a started bracket)`);

  // Name tags: the panel, the print button, and the test tag. ---------------------------------------------
  // window.print() is a stub here, so the page's own `afterprint` is fired by hand, as Chrome does.
  const afterPrint = (): Promise<void> => hostPage.evaluate("void window.dispatchEvent(new Event('afterprint'))");
  await hostPage.getByRole('button', { name: /^Print \d+ new tags?$/ }).click();
  await afterPrint();
  await hostPage.getByRole('button', { name: 'Yes' }).click();
  await hostPage.getByRole('dialog').waitFor({ state: 'detached' });
  await hostPage.getByRole('button', { name: 'Print a test tag' }).click();
  await afterPrint();
  await hostPage.waitForLoadState('networkidle');
  routes.push(`${LAN_NAME}/host (name tags, print, test tag)`);

  // The Display and the phone with a bracket running. -----------------------------------------------------
  const phoneContext = await open(lan, { viewport: { width: 390, height: 800 } });
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(`${lan}/api/health`);
  await api(phonePage)('/api/phone/follow', { handle: signedUp[0]!.handle, pin: '1000' });
  await visit(phonePage, lan, '/follow', () => phonePage.waitForLoadState('networkidle'));
  await visit(displayPage, lan, '/display', () => displayPage.waitForLoadState('networkidle'));

  // Play the bracket to its end so the finished screens load too. -----------------------------------------
  for (let guard = 0; guard < 30; guard++) {
    const { bracket } = await asHost('/api/bracket');
    if (!bracket || bracket.finished) break;
    // Only a match on a station can be recorded.
    const match = bracket.stations.map((st: any) => st.match).find((m: any) => m && m.slots.every((sl: any) => sl.player));
    if (!match) break;
    const slot = match.slots.find((s: any) => s.player);
    await asHost('/api/bracket/results', { matchId: match.id, winnerId: slot.player.id });
  }
  await displayPage.reload();
  await displayPage.waitForLoadState('networkidle');
  await phonePage.reload();
  await phonePage.waitForLoadState('networkidle');
  await hostPage.reload();
  await hostPage.waitForLoadState('networkidle');
  routes.push(`${LAN_NAME}/display, /follow, /host (a finished bracket)`);

  // Groups (heats), the other way to play. -------------------------------------------------------------------
  await asHost('/api/bracket', undefined, 'DELETE');
  await asHost('/api/heats', { stations: 2, races: 1, rounds: 1, points: [4, 3, 2, 1], playerIds: ids });
  for (const page of [displayPage, phonePage, hostPage]) {
    await page.reload();
    await page.waitForLoadState('networkidle');
  }
  routes.push(`${LAN_NAME}/display, /follow, /host (groups)`);

  // The player page, signed out, with a follow code in the address. ---------------------------------------------
  await visit(lanPage, lan, '/follow?code=000000', () => lanPage.waitForLoadState('networkidle'));

  // Every route in the client's router has been visited. -------------------------------------------------------------
  for (const context of [laptop, lanContext, hostContext, displayContext, signupContext, phoneContext]) await context.close();
} catch (error) {
  console.error(error);
  failures.push(String(error));
} finally {
  await browser.close().catch(() => undefined);
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}

// Summary ----------------------------------------------------------------------------------------------------------
const byKind = new Map<string, number>();
for (const { kind } of seen) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
console.log('');
console.log(`routes visited (${routes.length}):`);
for (const route of routes) console.log(`  ${route}`);
console.log(`requests seen: ${seen.length} (${[...byKind].map(([kind, n]) => `${kind} ${n}`).join(', ')})`);
console.log(`hosts seen: ${[...new Set(seen.filter((s) => !/^(data|blob|about):/.test(s.url)).map((s) => new URL(s.url).host))].join(', ')}`);
check(seen.length > 0, 'the browser made requests to record');
check(offNetwork.length === 0, `no request left this machine${offNetwork.length ? `: ${[...new Set(offNetwork.map((s) => `${s.kind} ${s.url}`))].join('; ')}` : ''}`);
check(!seen.some((s) => new URL(s.url).pathname === '/push-worker.js'), 'the push worker was never requested');
check(!seen.some((s) => s.kind.includes('service worker')), 'no service worker ran (offline mode over plain HTTP offers no push)');
console.log(failures.length ? `FAILED: ${failures.length}` : 'ALL PASSED');
process.exitCode = failures.length ? 1 : 0;
