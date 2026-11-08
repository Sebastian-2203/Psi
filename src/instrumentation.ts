/**
 * Next.js startup hook. Node.js-only work lives in ./instrumentation-node.ts (imported only for
 * the nodejs runtime, the documented pattern that keeps it out of the Edge bundle).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateServerEnvAtStartup } = await import('./instrumentation-node');
    await validateServerEnvAtStartup();
  }
}
