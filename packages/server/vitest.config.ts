import { defineConfig } from 'vitest/config';

// PINs and the host password are hashed with scrypt at the production cost (pin-hash.ts), so a
// test that signs in and makes several claims spends seconds hashing. With every package's tests
// running at once, that went past Vitest's 5 s default.
export default defineConfig({
  test: { testTimeout: 30_000 },
});
