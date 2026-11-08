import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `server-only` throws outside React Server Components; tests import server modules directly.
  'server-only': fileURLToPath(new URL('./tests/fixtures/server-only-stub.ts', import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/authz/**/*.test.ts', 'src/**/*.test.ts'],
        },
      },
      {
        // Against the local Supabase stack; each file skips itself (with a message) when
        // DATABASE_URL / the stack is unavailable, so `pnpm test` stays green in plain CI.
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.tsx', 'src/**/*.test.tsx'],
        },
      },
    ],
  },
});
