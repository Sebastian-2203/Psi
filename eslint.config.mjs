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
  // Auth flows (workstream 1.3): pre-auth rate limits, invitation acceptance (create user),
  // MFA factor reset after a recovery code (ADR-021). PENDING orchestrator/security approval.
  'src/server/auth/**',
  'src/server/tenancy/**',
  'src/modules/platform/server/**',
  'tests/**',
];

// ADR-019 Option A: claim-setting and role switching are the security boundary and live ONLY in
// src/server/db. Elsewhere: no `sql.unsafe(...)` and no SQL text that switches role or sets
// request settings (`set [local] role`, `reset role`, `set_config`, `request.jwt`).
const RAW_IDENTITY_SQL =
  /\b(set\s+(local\s+|session\s+)?role|reset\s+role|set_config|request\.jwt)\b/i;
const DB_BOUNDARY_RULES = [
  {
    selector: "CallExpression[callee.property.name='unsafe']",
    message: 'sql.unsafe is forbidden outside src/server/db (ADR-019; parameterize instead).',
  },
  {
    selector: `TemplateElement[value.raw=${RAW_IDENTITY_SQL}]`,
    message: 'Role/claim-setting SQL is only allowed in src/server/db (ADR-019).',
  },
  {
    selector: `Literal[value=${RAW_IDENTITY_SQL}]`,
    message: 'Role/claim-setting SQL is only allowed in src/server/db (ADR-019).',
  },
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
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/db/**'],
    rules: { 'no-restricted-syntax': ['error', ...DB_BOUNDARY_RULES] },
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
