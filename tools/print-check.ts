// Checks name tag printing and the print dialog against a production build, in headless Chromium.
// Usage: pnpm build, then `pnpm print-check <output folder>` (node tools/print-check.ts <folder>)
//
// Not part of `pnpm check` or CI: it needs a Chromium (`pnpm --filter @coliseumgrid/core exec
// playwright install chromium` once) and poppler's `pdftoppm` and `pdfinfo`. It starts the real
// server on a free port with a temporary data folder, so it touches nothing of yours.
//
// window.print() can't run headless, so the page's copy is a counter. The script waits for the
// count, saves the page as a PDF with the CSS page size, reads each page's size with pdfinfo, and
// rasterizes the pages with pdftoppm into the output folder, where they are looked at. It then
// fires `afterprint` by hand, as Chrome does when the print window closes, and checks the
// dialog: Yes posts exactly the tags and versions that were printed, No and Escape keep the
// tags, the test tag asks nothing and never posts, and a tag queued again while the dialog was
// open (a PIN reset) survives Yes. Exit code 1 if anything fails.
//   - tags-<size>-<n>.png: the pages of each print job, one file per page.
//   - handles-16-wide-banner-<n>.png: 16-character handles with a wide picture.
//   - test-tag-1.png: the test tag, with its safe-edge line.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outArg = process.argv[2];
if (!outArg) {
  console.error('Usage: node tools/print-check.ts <output folder>');
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const root = new URL('..', import.meta.url).pathname;
// playwright is a dependency of packages/core only. Its page and request objects are used as
// they come, so they are typed `any` here rather than copying its types into tools/.
const require = createRequire(`${root}packages/core/package.json`);
const { chromium } = require('playwright') as { chromium: { launch: () => Promise<any> } };

for (const program of ['pdftoppm', 'pdfinfo']) {
  if (spawnSync(program, ['-v']).error) {
    console.error(`${program} is not installed (poppler-utils). The check rasterizes and measures the printed pages with it.`);
    process.exit(2);
  }
}

const freePort = (): Promise<number> =>
  new Promise((resolvePort) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), 'coliseumgrid-print-check-'));
const server = spawn('node', ['packages/server/src/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, COLISEUMGRID_MODE: 'offline' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (data) => process.stdout.write(`[server] ${data}`));
server.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));
const base = `http://127.0.0.1:${port}`;
for (let tries = 0; tries < 100; tries++) {
  try {
    if ((await fetch(`${base}/api/host/session`)).ok) break;
  } catch {
    // Not listening yet.
  }
  await new Promise((done) => setTimeout(done, 100));
}

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

interface QueuedTag {
  playerId: number;
  handle: string;
  pin: string | null;
  version: number;
}
type Printed = { playerId: number; version: number }[];
const byPlayer = (list: Printed): Printed => [...list].sort((a, b) => a.playerId - b.playerId);
const sameList = (a: Printed, b: Printed): boolean => JSON.stringify(byPlayer(a)) === JSON.stringify(byPlayer(b));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, baseURL: base });
  // Browser-side code is given as strings: tools/ is type-checked without the DOM types.
  await context.addInitScript({ content: 'window.__prints = 0; window.print = () => { window.__prints += 1; };' });
  // The laptop itself is the host offline, so these calls need no sign-in.
  const api = context.request;
  const call = async (path: string, data?: object, method = 'POST'): Promise<any> => {
    const res = await api.fetch(path, { method, ...(data && { data }) });
    if (!res.ok()) throw new Error(`${method} ${path} ${res.status()} ${await res.text()}`);
    return res.status() === 204 ? null : res.json();
  };
  const queue = async (): Promise<QueuedTag[]> => (await call('/api/tags', undefined, 'GET')).tags;
  const pairs = (tags: QueuedTag[]): Printed => tags.map(({ playerId, version }) => ({ playerId, version }));

  await call('/api/event', { name: 'Spring Showdown', game: 'Fighting game' }, 'PUT');

  // Pictures: a square mark and a wide banner, drawn by the browser.
  const draw = async (width: number, height: number, file: string): Promise<void> => {
    const sheet = await browser.newPage({ viewport: { width, height } });
    await sheet.setContent(
      `<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/><rect x="${width * 0.04}" y="${height * 0.04}" width="${width * 0.92}" height="${height * 0.92}" fill="none" stroke="#000" stroke-width="${Math.max(height / 25, 2)}"/><path d="M${width * 0.5} ${height * 0.15} L${width * 0.8} ${height * 0.85} L${width * 0.2} ${height * 0.85} Z" fill="#000"/></svg></body>`,
    );
    await sheet.screenshot({ path: file });
    await sheet.close();
  };
  const square = join(out, 'graphic-square.png');
  const wide = join(out, 'graphic-wide.png');
  await draw(400, 400, square);
  await draw(900, 300, wide);
  writeFileSync(join(out, 'not-a-picture.txt'), 'hello');

  const page = await context.newPage();
  // Every post to /api/tags/printed, in order, as the page sent it.
  const printedCalls: Printed[] = [];
  page.on('request', (request: any) => {
    if (request.url().endsWith('/api/tags/printed')) printedCalls.push(JSON.parse(request.postData()).tags);
  });
  await page.goto('/host');
  await page.getByRole('heading', { name: 'Name tags' }).waitFor();

  check(await page.getByRole('button', { name: 'Print 0 new tags' }).isDisabled(), 'Print 0 new tags is off');
  await page.locator('input[type=file]').setInputFiles(join(out, 'not-a-picture.txt'));
  await page.getByText('Use a PNG, JPEG, or WebP picture.').waitFor();
  check(true, 'a text file is refused with words');
  await page.locator('input[type=file]').setInputFiles(square);
  await page.getByAltText('The event picture').waitFor();
  check(await page.getByRole('button', { name: 'Remove' }).isVisible(), 'the square picture uploaded, and Remove shows');

  const pdfInfo = (file: string): [number, number][] => {
    const result = spawnSync('pdfinfo', ['-f', '1', '-l', '99', file], { encoding: 'utf8' });
    return [...result.stdout.matchAll(/Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/g)].map((m) => [(Number(m[2]) * 25.4) / 72, (Number(m[3]) * 25.4) / 72]);
  };

  const pickSize = async (preset: { pick?: RegExp; custom?: [number, number] }): Promise<void> => {
    await page.getByLabel('Label size').click();
    if (preset.pick) await page.getByRole('option', { name: preset.pick }).click();
    else if (preset.custom) {
      await page.getByRole('option', { name: 'Custom size' }).click();
      await page.getByLabel('Width (mm)').fill(String(preset.custom[0]));
      await page.getByLabel('Height (mm)').fill(String(preset.custom[1]));
    }
  };

  /** Clicks a print button, waits for the page's one window.print(), and checks and rasterizes the pages. */
  const print = async (button: any, label: string, pageMm: [number, number], pages: number): Promise<void> => {
    await page.evaluate('window.__prints = 0');
    await button.click();
    await page.waitForFunction('window.__prints === 1', null, { timeout: 15000 });
    // Give any second window.print() a moment to show up.
    await page.waitForTimeout(300);
    check((await page.evaluate('window.__prints')) === 1, `${label}: the print window opened once`);
    const fits = await page.evaluate("[...document.querySelectorAll('[data-handle]')].map((el) => ({ text: el.textContent, pt: el.dataset.pt }))");
    const pdf = join(out, `${label}.pdf`);
    await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const sizes = pdfInfo(pdf);
    check(sizes.length === pages, `${label}: ${sizes.length} pdf pages, expected ${pages}`);
    check(
      sizes.every(([w, h]) => Math.abs((w ?? 0) - pageMm[0]) <= 0.5 && Math.abs((h ?? 0) - pageMm[1]) <= 0.5),
      `${label}: every page is ${pageMm.join(' x ')} mm (got ${sizes.map((s) => s.map((n) => n.toFixed(2)).join('x')).join(', ')})`,
    );
    spawnSync('pdftoppm', ['-png', '-r', '150', pdf, join(out, label)]);
    console.log(`  fitted: ${JSON.stringify(fits)}`);
  };
  /** Chrome fires afterprint when the print window closes, printed or not. */
  const afterPrint = (): Promise<void> => page.evaluate("void window.dispatchEvent(new Event('afterprint'))");
  const dialogGone = (): Promise<void> => page.getByRole('dialog').waitFor({ state: 'detached' });
  const printButton = (count: number) => page.getByRole('button', { name: `Print ${count} new ${count === 1 ? 'tag' : 'tags'}` });

  // Each label size: print three new tags, then Yes sends exactly those tags and versions. --------
  const presets = [
    { name: 'preset-62x100', pick: /62 x 100 mm/, page: [62, 100] as [number, number] },
    { name: 'preset-2-1-4x4', pick: /2-1\/4 x 4 in/, page: [58.76, 101.6] as [number, number] },
    { name: 'custom-50x90', custom: [50, 90] as [number, number], page: [50, 90] as [number, number] },
    { name: 'custom-90x50-not-turned', custom: [90, 50] as [number, number], page: [90, 50] as [number, number] },
  ];
  let n = 0;
  for (const preset of presets) {
    await pickSize(preset);
    for (const handle of [`Zap${n}`, `Kai${n}`, `Blaze${n}`]) await call('/api/players', { handle });
    n++;
    await printButton(3).waitFor();
    const before = pairs(await queue());
    const callsBefore = printedCalls.length;
    await print(printButton(3), `tags-${preset.name}`, preset.page, 3);
    await afterPrint();
    await page.getByRole('heading', { name: 'Did all 3 tags print?' }).waitFor();
    await page.getByRole('button', { name: 'Yes' }).click();
    await dialogGone();
    check(printedCalls.length === callsBefore + 1 && sameList(printedCalls.at(-1) ?? [], before), `${preset.name}: Yes posts exactly the printed tags and versions`);
    await printButton(0).waitFor();
    check((await queue()).length === 0, `${preset.name}: the queue is empty after Yes`);
  }

  // Long handles with the wide banner. --------------------------------------------------------
  await pickSize(presets[0]!);
  for (const handle of ['MWMWMWMWMWMWMWMW', 'Jean-Luc_Picard_', 'Quentin_Tarantin']) await call('/api/players', { handle });
  await page.locator('input[type=file]').setInputFiles(wide);
  await page.waitForFunction(`document.querySelector('img[alt="The event picture"]')?.naturalWidth === 900`);
  await printButton(3).waitFor();
  const kept = pairs(await queue());
  let callsBefore = printedCalls.length;
  await print(printButton(3), 'handles-16-wide-banner', [62, 100], 3);
  await afterPrint();
  await page.getByRole('heading', { name: 'Did all 3 tags print?' }).waitFor();
  await page.getByRole('button', { name: 'No, keep them' }).click();
  await dialogGone();
  check(printedCalls.length === callsBefore && sameList(pairs(await queue()), kept), 'No, keep them posts nothing and keeps the tags');
  check(await printButton(3).isEnabled(), 'No, keep them leaves the button on');

  // Escape is a No. ------------------------------------------------------------------------------
  await print(printButton(3), 'tags-escape', [62, 100], 3);
  await afterPrint();
  await page.getByRole('heading', { name: 'Did all 3 tags print?' }).waitFor();
  await page.keyboard.press('Escape');
  await dialogGone();
  check(printedCalls.length === callsBefore && sameList(pairs(await queue()), kept), 'Escape posts nothing and keeps the tags');

  // The test tag asks nothing and never posts. -----------------------------------------------------
  await print(page.getByRole('button', { name: 'Print a test tag' }), 'test-tag', [62, 100], 1);
  await afterPrint();
  await page.waitForTimeout(500);
  check((await page.getByRole('dialog').count()) === 0, 'the test tag asks nothing');
  check(printedCalls.length === callsBefore, 'the test tag never calls /api/tags/printed');
  check(await printButton(3).isEnabled(), 'the test tag leaves the print list alone');

  // The reprint snackbar follows the tag's PIN. ----------------------------------------------------
  const reprint = (handle: string) => page.getByRole('row', { name: new RegExp(handle) }).getByRole('button', { name: 'Print tag' }).click();
  await reprint('Quentin_Tarantin');
  await page.getByText('Added to the print list.', { exact: true }).waitFor();
  check(true, 'a reprint with a PIN waiting says only "Added to the print list."');
  await reprint('Zap0');
  await page.getByText('Added to the print list. Reprints have no PIN.', { exact: true }).waitFor();
  check(true, 'a reprint with no PIN says "Reprints have no PIN."');

  // A PIN reset while the dialog is open: Yes must keep the new tag. ----------------------------------
  const asked = await queue();
  check(asked.length === 4, `four tags are queued before the race (got ${asked.length})`);
  callsBefore = printedCalls.length;
  await print(printButton(asked.length), 'tags-race', [62, 100], asked.length);
  await afterPrint();
  await page.getByRole('heading', { name: `Did all ${asked.length} tags print?` }).waitFor();
  const target = asked.find((tag) => tag.handle === 'Quentin_Tarantin')!;
  const { pin: newPin } = await call(`/api/players/${target.playerId}/reset-pin`);
  await page.getByRole('button', { name: 'Yes' }).click();
  await dialogGone();
  check(printedCalls.length === callsBefore + 1 && sameList(printedCalls.at(-1) ?? [], pairs(asked)), 'Yes posts the versions that were printed, not the queue as it is now');
  const left = await queue();
  check(left.length === 1 && left[0]?.playerId === target.playerId && left[0]?.pin === newPin && left[0].version > target.version, 'the reset tag stays queued with its new PIN');
  await printButton(1).waitFor();
  check(true, 'the panel counts the one tag that stays');

  await context.close();
  await browser.close();
} catch (error) {
  console.error(error);
  failures.push(String(error));
  await browser.close();
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(failures.length ? `FAILED: ${failures.length}` : 'ALL PASSED');
  console.log(`pages: ${out}`);
  process.exitCode = failures.length ? 1 : 0;
}
