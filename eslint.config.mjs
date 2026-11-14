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
  group: ['@/server/db/system', '**/db/system'],
  message:
    'src/server/db/system may only be imported from SYSTEM_DB_IMPORTERS (eslint.config.mjs).',
};
const SYSTEM_DB_IMPORTERS = [
  'src/server/audit/writer.ts', // system/denied-attempt audit writer (§6.4 row 6)
  'src/server/auth/rate-limit.ts', // pre-auth limiter (ADR-020)
  'src/server/auth/invitations.ts', // invitation peek/accept (SECURITY.md §3.8)
  'src/server/tenancy/host.ts', // host -> org, public branding (ADR-010/017);
];

// 2. src/server/db/service-role.ts — Supabase Auth admin API + `branding` bucket writes with the
//    SERVICE-ROLE key.
const SERVICE_ROLE_PATTERN = {
  group: ['@/server/db/service-role', '**/db/service-role'],
  message:
    'The service-role client may only be imported from SERVICE_ROLE_IMPORTERS (eslint.config.mjs).',
};
const SERVICE_ROLE_IMPORTERS = [
  'src/server/auth/invitations.ts', // create invited user + compensation delete
  'src/server/auth/recovery-codes.ts', // MFA factor reset after a recovery code (ADR-021)
  'src/modules/branding/server/service.ts', // logo upload/removal after the RLS owner check (P1-16/18)
  'src/modules/documents/server/service.ts', // clinical upload + signed URLs after the RLS check (Phase 3)
];

// P1-20: the static-import allowlists above are only meaningful if the modules cannot be reached
// another way. Dynamic `import()` / `require()` of either restricted module is forbidden
// EVERYWHERE outside src/server/db (allowlisted files use static imports), and only
// service-role.ts may read the service-role key from `env`/`process.env`.
// esquery regexes cannot contain `/`, so `.` stands for the path separator.
const RESTRICTED_MODULE = '/db.(system|service-role)(.ts)?$/';
const DYNAMIC_IMPORT_RULES = [
  {
    selector: `ImportExpression[source.value=${RESTRICTED_MODULE}]`,
    message: 'Dynamic import of src/server/db/{system,service-role} is forbidden (P1-20).',
  },
  {
    // Template-literal specifiers that touch a `db` path segment.
    selector: 'ImportExpression > TemplateLiteral[quasis.0.value.raw=/(^|[^a-z])db([^a-z]|$)/]',
    message: 'Dynamic import of src/server/db/{system,service-role} is forbidden (P1-20).',
  },
  {
    // Specifiers computed from variables/calls cannot be checked: forbidden.
    selector: "ImportExpression[source.type!='Literal'][source.type!='TemplateLiteral']",
    message: 'Dynamic import() needs a literal or template-literal specifier (P1-20).',
  },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${RESTRICTED_MODULE}]`,
    message: 'require() of src/server/db/{system,service-role} is forbidden (P1-20).',
  },
];
const SERVICE_ROLE_KEY_MESSAGE =
  'SUPABASE_SERVICE_ROLE_KEY may only be read in src/server/db/service-role.ts (P1-20).';
const SERVICE_ROLE_KEY_RULES = [
  {
    selector: "MemberExpression[property.name='SUPABASE_SERVICE_ROLE_KEY']",
    message: SERVICE_ROLE_KEY_MESSAGE,
  },
  {
    selector: "MemberExpression[property.value='SUPABASE_SERVICE_ROLE_KEY']",
    message: SERVICE_ROLE_KEY_MESSAGE,
  },
  {
    selector: "ObjectPattern > Property[key.name='SUPABASE_SERVICE_ROLE_KEY']",
    message: SERVICE_ROLE_KEY_MESSAGE,
  },
  {
    selector: "ObjectPattern > Property[key.value='SUPABASE_SERVICE_ROLE_KEY']",
    message: SERVICE_ROLE_KEY_MESSAGE,
  },
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
    rules: {
      'no-restricted-syntax': [
        'error',
        ...DB_BOUNDARY_RULES,
        ...DYNAMIC_IMPORT_RULES,
        ...SERVICE_ROLE_KEY_RULES,
      ],
    },
  },
  {
    // Inside src/server/db only service-role.ts may read the key.
    files: ['src/server/db/**/*.{ts,tsx}'],
    ignores: ['src/server/db/service-role.ts'],
    rules: { 'no-restricted-syntax': ['error', ...SERVICE_ROLE_KEY_RULES] },
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
