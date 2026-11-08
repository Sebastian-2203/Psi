import 'server-only';
import { z } from 'zod';

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Service role bypasses RLS: only for the allowlisted admin client (ARCHITECTURE §4 rule 4).
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
  // VERIFY PER DEPLOYMENT. Unset: `vercel` when VERCEL=1, else `xff`.
  //   vercel -> x-vercel-forwarded-for (first entry), else x-real-ip (set by the Vercel edge)
  //   xff    -> X-Forwarded-For entry appended by the nearest of TRUSTED_PROXY_HOPS proxies
  //   none   -> no client IP (per-subject limits still apply)
  TRUSTED_PROXY: z.enum(['vercel', 'xff', 'none']).optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
  VERCEL: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    // Names only: never print values (they may be secrets).
    throw new Error(`Invalid or missing environment variables: ${fields}`);
  }
  return result.data;
}

/** Validated at module load; the process fails fast on misconfiguration. */
export const env = loadEnv();
