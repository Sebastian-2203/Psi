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
    | [unknown, { patterns?: { group: string[] }[] }]
    | undefined;
  return (rule?.[1]?.patterns ?? []).flatMap((p) => p.group);
}

describe('restricted DB import boundaries (eslint.config.mjs)', () => {
  it('a new server file may import neither module', async () => {
    const groups = await restrictedGroups('src/server/auth/some-new-file.ts');
    expect(groups).toContain('@/server/db/service-role');
    expect(groups).toContain('@/server/db/system');
    expect(groups).toContain('@/server/db/admin');
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

  it('recovery-codes may use the service role but not the system path', async () => {
    const groups = await restrictedGroups('src/server/auth/recovery-codes.ts');
    expect(groups).toContain('@/server/db/system');
    expect(groups).not.toContain('@/server/db/service-role');
  }, 30_000);
});
