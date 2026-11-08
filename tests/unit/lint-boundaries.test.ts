import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// P1-04: per-file allowlists for src/server/db/system (app_server) and src/server/db/service-role
// (service-role key). Asserts the RESOLVED config per file (flat config replaces rule options).
const eslint = new ESLint();

async function restrictedGroups(file: string): Promise<string[]> {
  const config = (await eslint.calculateConfigForFile(file)) as {
    rules?: Record<string, unknown>;
  };
  const rule = config.rules?.['no-restricted-imports'] as
    [unknown, { patterns?: { group: string[] }[] }] | undefined;
  return (rule?.[1]?.patterns ?? []).flatMap((p) => p.group);
}

describe('restricted DB import boundaries (eslint.config.mjs)', () => {
  it('a new server file may import neither module', async () => {
    const groups = await restrictedGroups('src/server/auth/some-new-file.ts');
    expect(groups).toContain('@/server/db/service-role');
    expect(groups).toContain('@/server/db/system');
    const moduleFile = await restrictedGroups('src/modules/platform/server/actions.ts');
    expect(moduleFile).toContain('@/server/db/service-role');
  }, 30_000);

  it('system-only importers may not import the service role', async () => {
    for (const file of ['src/server/audit/writer.ts', 'src/server/auth/rate-limit.ts']) {
      const groups = await restrictedGroups(file);
      expect(groups).toContain('@/server/db/service-role');
      expect(groups).not.toContain('@/server/db/system');
    }
  }, 30_000);

  it('the branding service may use the service role but not the system path (P1-16/18)', async () => {
    const groups = await restrictedGroups('src/modules/branding/server/service.ts');
    expect(groups).toContain('@/server/db/system');
    expect(groups).not.toContain('@/server/db/service-role');
    const actions = await restrictedGroups('src/modules/branding/server/actions.ts');
    expect(actions).toContain('@/server/db/service-role');
  }, 30_000);

  it('recovery-codes may use the service role but not the system path', async () => {
    const groups = await restrictedGroups('src/server/auth/recovery-codes.ts');
    expect(groups).toContain('@/server/db/system');
    expect(groups).not.toContain('@/server/db/service-role');
  }, 30_000);
});

// P1-20: dynamic import()/require() of the restricted modules and reading the service-role key.
// import/no-cycle resolves files on disk and crashes on virtual ones; it is unrelated here.
const linter = new ESLint({ overrideConfig: { rules: { 'import/no-cycle': 'off' } } });

async function messages(file: string, code: string): Promise<string[]> {
  const [result] = await linter.lintText(code, { filePath: file });
  return (result?.messages ?? []).map((m) => m.message);
}

describe('P1-20: dynamic imports and the service-role key (eslint.config.mjs)', () => {
  const dynamic = [
    "export const a = () => import('@/server/db/service-role');",
    "export const a = () => import('../db/system');",
    'export const a = (x: string) => import(`../db/${x}`);',
    'export const a = (x: string) => import(x);',
  ];

  it('forbids dynamic import of the restricted modules, even in allowlisted files', async () => {
    for (const file of [
      'src/server/auth/some-new-file.ts',
      'src/server/auth/recovery-codes.ts',
      'src/modules/branding/server/service.ts',
    ]) {
      for (const code of dynamic) {
        const found = await messages(file, code);
        expect(
          found.some((m) => m.includes('P1-20')),
          `${file}: ${code}`,
        ).toBe(true);
      }
    }
  }, 60_000);

  it('only service-role.ts may read SUPABASE_SERVICE_ROLE_KEY', async () => {
    const reads = [
      "import { env } from '@/server/env';\nexport const k = env.SUPABASE_SERVICE_ROLE_KEY;",
      "export const k = process.env['SUPABASE_SERVICE_ROLE_KEY'];",
      "import { env } from '@/server/env';\nexport const { SUPABASE_SERVICE_ROLE_KEY: k } = env;",
    ];
    for (const file of [
      'src/server/auth/invitations.ts',
      'src/server/db/system.ts',
      'src/modules/branding/server/service.ts',
    ]) {
      for (const code of reads) {
        const found = await messages(file, code);
        expect(
          found.some((m) => m.includes('SUPABASE_SERVICE_ROLE_KEY')),
          `${file}`,
        ).toBe(true);
      }
    }
    const allowed = await messages(
      'src/server/db/service-role.ts',
      "import { env } from '@/server/env';\nexport const k = env.SUPABASE_SERVICE_ROLE_KEY;",
    );
    expect(allowed.some((m) => m.includes('SUPABASE_SERVICE_ROLE_KEY'))).toBe(false);
  }, 60_000);
});
