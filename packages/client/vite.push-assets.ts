// The two files the player page's push needs at the site root (docs/PLAN.md, "Player view",
// "Push"): the service worker and the web app manifest. Both must sit at the root and keep
// their names, so neither is a hashed asset: a worker's scope is its folder, and "/" is what
// covers /follow, and the browser compares the worker's bytes to know it changed.
//
// The worker is built on its own, as one classic script, because a service worker registered
// as a classic script can't import chunks, and the main build shares code between entries into
// chunks. The icons are public/icons (made by tools/make-icons.ts); Vite copies public/ to the
// root as-is (https://vite.dev/guide/assets#the-public-directory).

import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import { PALETTE } from './src/theme/palette.ts';

export const WORKER_FILE = 'push-worker.js';
export const MANIFEST_FILE = 'manifest.webmanifest';

/**
 * The manifest. Each color comes from the palette, the one source of the theme's colors
 * (docs/DESIGN.md, "Colors"), because a manifest has one color per field and no light and dark
 * variants:
 *   - theme_color is `primary.main`, crimson, which is the same in both modes.
 *   - background_color is the light `background.default`, the same color the icons sit on.
 * `display: standalone` is what makes iOS 16.4 and later install it as a Home Screen web app,
 * the only place iPhone push works
 * (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
 */
export function webManifest() {
  return {
    name: 'ColiseumGrid',
    short_name: 'ColiseumGrid',
    start_url: '/follow',
    scope: '/',
    display: 'standalone',
    theme_color: PALETTE.light.primary.main,
    background_color: PALETTE.light.background.default,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export function pushAssets(): Plugin {
  return {
    name: 'coliseumgrid-push-assets',

    // The dev server answers the manifest too, so the link doesn't get the page's HTML. It has
    // no worker: push needs HTTPS and the server's key, so try it on a production build.
    configureServer(server) {
      server.middlewares.use(`/${MANIFEST_FILE}`, (_request, response) => {
        response.setHeader('Content-Type', 'application/manifest+json');
        response.end(JSON.stringify(webManifest()));
      });
    },

    async generateBundle() {
      const built = await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        build: {
          write: false,
          target: 'es2022',
          lib: {
            entry: fileURLToPath(new URL('./src/worker/push-worker.ts', import.meta.url)),
            formats: ['iife'],
            name: 'ColiseumGridPushWorker',
            fileName: () => WORKER_FILE,
          },
        },
      });
      const chunk = (Array.isArray(built) ? built.flatMap((b) => b.output) : 'output' in built ? built.output : []).find(
        (file) => file.type === 'chunk',
      );
      if (!chunk) throw new Error('The push worker build made no file');
      this.emitFile({ type: 'asset', fileName: WORKER_FILE, source: chunk.code });
      this.emitFile({ type: 'asset', fileName: MANIFEST_FILE, source: JSON.stringify(webManifest(), null, 2) });
    },
  };
}
