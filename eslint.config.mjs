import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Importers of the service-role client (ARCHITECTURE §4 rule 4). Extend only with architect approval.
const ADMIN_PATTERN = {
  group: ['@/server/db/admin', '**/db/admin'],
  message: 'The service-role client may only be imported from the allowlist (eslint.config.mjs).',
};

const ADMIN_DB_ALLOWLIST = [
  'src/server/db/admin.ts',
  // System audit writer for denied attempts (ARCHITECTURE §6.4 row 6). PENDING architect approval.
  'src/server/audit/**',
  'src/server/tenancy/**',
  'src/modules/platform/server/**',
  'tests/**',
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      'react/no-danger': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'import/no-cycle': 'error',
    },
  },
  {
    // Everything except the allowlist may not import the service-role client.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ADMIN_DB_ALLOWLIST,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [ADMIN_PATTERN],
        },
      ],
    },
  },
  {
    // Client code must never reach server-only modules (§4 rule 2).
    files: [
      'src/**/components/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/lib/**/*.{ts,tsx}',
      'src/**/schemas/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server', '@/server/*', '**/server/**'],
              message: 'Client-reachable code may not import server-only modules.',
            },
            {
              group: ['@/modules/*/server', '@/modules/*/server/*'],
              message: 'Client-reachable code may not import module server code.',
            },
            ADMIN_PATTERN,
          ],
        },
      ],
    },
  },
]);
