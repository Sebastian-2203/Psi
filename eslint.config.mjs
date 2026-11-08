import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Restricted DB/Auth paths (ARCHITECTURE §4 rule 4, §6.4; SECURITY.md §14 P1-04). PER-FILE
// allowlists (never folder globs): a new importer is a reviewed one-line change here.
// Extend only with architect approval + security review.
//
// 1. src/server/db/system.ts — app_server system functions (no table privileges; only the
//    granted `app.*` system functions). No service-role key.
const SYSTEM_DB_PATTERN = {
  group: ['@/server/db/system', '**/db/system', '@/server/db/admin', '**/db/admin'],
  message:
    'src/server/db/system (and the deprecated db/admin shim) may only be imported from SYSTEM_DB_IMPORTERS (eslint.config.mjs).',
};
const SYSTEM_DB_IMPORTERS = [
  'src/server/audit/writer.ts', // system/denied-attempt audit writer (§6.4 row 6)
  'src/server/auth/rate-limit.ts', // pre-auth limiter (ADR-020)
  'src/server/auth/invitations.ts', // invitation peek/accept (SECURITY.md §3.8)
  'src/server/tenancy/host.ts', // host -> org, public branding (ADR-010/017); via db/admin shim
];

// 2. src/server/db/service-role.ts — Supabase Auth admin API with the SERVICE-ROLE key.
const SERVICE_ROLE_PATTERN = {
  group: ['@/server/db/service-role', '**/db/service-role'],
  message:
    'The service-role client may only be imported from SERVICE_ROLE_IMPORTERS (eslint.config.mjs).',
};
const SERVICE_ROLE_IMPORTERS = [
  'src/server/auth/invitations.ts', // create invited user + compensation delete
  'src/server/auth/recovery-codes.ts', // MFA factor reset after a recovery code (ADR-021)
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

/**
 * One `no-restricted-imports` entry per file group (flat config REPLACES rule options of
 * earlier blocks, so the restricted patterns are combined per group instead of stacked):
 * - every src file outside both allowlists: neither module;
 * - files in exactly one allowlist: only the other module is forbidden;
 * - src/server/db/** (the modules themselves): unrestricted.
 */
function restrictedDbImports() {
  const only = (list, other) => list.filter((f) => !other.includes(f));
  const rule = (patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });
  return [
    {
      files: ['src/**/*.{ts,tsx}'],
      ignores: [...SYSTEM_DB_IMPORTERS, ...SERVICE_ROLE_IMPORTERS, 'src/server/db/**'],
      rules: rule([SYSTEM_DB_PATTERN, SERVICE_ROLE_PATTERN]),
    },
    {
      files: only(SYSTEM_DB_IMPORTERS, SERVICE_ROLE_IMPORTERS),
      rules: rule([SERVICE_ROLE_PATTERN]),
    },
    {
      files: only(SERVICE_ROLE_IMPORTERS, SYSTEM_DB_IMPORTERS),
      rules: rule([SYSTEM_DB_PATTERN]),
    },
  ];
}

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
  ...restrictedDbImports(),
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
            SYSTEM_DB_PATTERN,
            SERVICE_ROLE_PATTERN,
          ],
        },
      ],
    },
  },
]);
