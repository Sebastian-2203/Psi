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
