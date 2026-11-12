import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// `node` runs every core test. `browser` re-runs the handle rules and the vulgarity filter in
// headless Chromium, which is what the client bundles (M2 acceptance check). Pattern Break
// does the same in packages/client.
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'node', include: ['test/**/*.test.ts'] },
      },
      {
        test: {
          name: 'browser',
          include: ['test/vulgarity.test.ts', 'test/handle.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: 'chromium', provider: playwright() }],
          },
        },
      },
    ],
  },
});
