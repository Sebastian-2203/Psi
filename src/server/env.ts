import 'server-only';
import { z } from 'zod';

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Service role bypasses RLS. Read ONLY in src/server/db/service-role.ts (lint rule, P1-20;
  // ARCHITECTURE §4 rule 4).
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // App login role via the pooler (ADR-019).
  DATABASE_URL: z.string().min(1),
  APP_BASE_DOMAIN: z.string().min(1),
  // Transactional mail (invitations, MFA-reset notices). LOCAL/TEST ONLY: Mailpit HTTP send API
  // of the Supabase CLI stack. Production provider pending (SECURITY.md §3.1 SMTP, new subprocessor).
  MAIL_DEV_HTTP_URL: z.url().optional(),
  MAIL_FROM: z.email().default('no-reply@example.test'),
  // P1-02: HMAC-SHA256 key for the session activity cookie (src/lib/session-activity.ts).
  // >= 32 chars of randomness; rotate = every session idles out once.
  SESSION_ACTIVITY_SECRET: z.string().min(32),
  // P1-03: which proxy headers carry the client IP (src/server/auth/request-meta.ts).
  // VERIFY PER DEPLOYMENT. Unset: `vercel` when VERCEL=1; in production off Vercel startup FAILS
  // (P1-21: an explicit choice is required); in development/test `xff`.
  //   vercel -> x-vercel-forwarded-for (first entry), else x-real-ip (set by the Vercel edge)
  //   xff    -> X-Forwarded-For entry appended by the nearest of TRUSTED_PROXY_HOPS proxies
  //   none   -> no client IP (per-subject limits still apply)
  TRUSTED_PROXY: z.enum(['vercel', 'xff', 'none']).optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
  VERCEL: z.string().optional(),
  // PAT-06: care-team notice window (days) before a minor reaches the age of majority.
  MAJORITY_NOTICE_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Set by Next.js; `phase-production-build` while `next build` collects page data.
  NEXT_PHASE: z.string().optional(),
});

export const TRUSTED_PROXY_REQUIRED_MESSAGE =
  'TRUSTED_PROXY must be set (vercel | xff | none) when NODE_ENV=production outside Vercel ' +
  '(SECURITY.md §14 P1-03/P1-21): pick the mode that matches the proxy in front of the app.';

const refinedEnvSchema = serverEnvSchema.superRefine((value, ctx) => {
  // P1-21: no silent `xff` default in production off Vercel. Not enforced during `next build`
  // (build machines have no deployment topology); enforced when the server loads the env.
  if (
    value.NODE_ENV === 'production' &&
    value.VERCEL !== '1' &&
    value.TRUSTED_PROXY === undefined &&
    value.NEXT_PHASE !== 'phase-production-build'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUSTED_PROXY'],
      message: TRUSTED_PROXY_REQUIRED_MESSAGE,
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Pure (unit tested): validates a process.env-like object. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = refinedEnvSchema.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ');
    // Names only: never print values (they may be secrets). Custom messages carry no values.
    const notes = result.error.issues
      .filter((i) => i.code === 'custom')
      .map((i) => ` ${i.message}`)
      .join('');
    throw new Error(`Invalid or missing environment variables: ${fields}.${notes}`);
  }
  return result.data;
}

/** Validated at module load (and at server startup via src/instrumentation.ts); fails fast. */
export const env = parseServerEnv(process.env);
