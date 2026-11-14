// Makes the Home Screen icons in packages/client/public/icons from assets/logo/icon.svg.
// Usage: node tools/make-icons.ts (run by hand when the logo or the palette changes, then commit the PNGs)
//
// The SVG has a transparent background, and iOS fills transparency with black on a Home Screen
// icon, so each PNG gets a solid `background.default` (light) behind the mark. The page draws
// the SVG in Chromium, which the repo already has through Playwright (packages/core).
//   - icon-192.png and icon-512.png: purpose "any", the mark at 80% of the square.
//   - icon-maskable-512.png: purpose "maskable". The safe zone is a circle of 40% of the width
//     in radius (https://www.w3.org/TR/appmanifest/#icon-masks), and the mark's corners are 1.28
//     times its half-width from the center, so the mark is drawn at 60%.
//   - apple-touch-icon.png: 180 by 180, the size iOS asks for
//     (https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PALETTE } from '../packages/client/src/theme/palette.ts';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}packages/client/public/icons/`;
const svg = readFileSync(`${root}assets/logo/icon.svg`, 'utf8');
const background = PALETTE.light.background.default;

interface Icon {
  file: string;
  size: number;
  /** The mark's size as a share of the square. */
  mark: number;
}

const ICONS: Icon[] = [
  { file: 'icon-192.png', size: 192, mark: 0.8 },
  { file: 'icon-512.png', size: 512, mark: 0.8 },
  { file: 'icon-maskable-512.png', size: 512, mark: 0.6 },
  { file: 'apple-touch-icon.png', size: 180, mark: 0.8 },
];

// playwright is a dependency of packages/core only.
const require = createRequire(`${root}packages/core/package.json`);
const { chromium } = require('playwright') as { chromium: { launch: () => Promise<any> } };

const browser = await chromium.launch();
mkdirSync(out, { recursive: true });
for (const icon of ICONS) {
  const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(
    `<body style="margin:0;background:${background};display:grid;place-items:center;width:${icon.size}px;height:${icon.size}px">` +
      `<img src="${url}" style="width:${icon.size * icon.mark}px;height:${icon.size * icon.mark}px"></body>`,
  );
  writeFileSync(`${out}${icon.file}`, await page.screenshot({ type: 'png' }));
  await page.close();
  console.log(`wrote ${icon.file}`);
}
await browser.close();
