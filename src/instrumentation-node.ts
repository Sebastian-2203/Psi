/**
 * Validates the server environment when the Node.js server boots, so a misconfiguration (e.g.
 * P1-21: TRUSTED_PROXY unset in production off Vercel) stops `next start` instead of failing on
 * the first request. The error lists variable NAMES only, never values.
 */
export async function validateServerEnvAtStartup(): Promise<void> {
  try {
    await import('@/server/env');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid server environment.');
    process.exit(1);
  }
}
