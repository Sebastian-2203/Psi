import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { REFERRER_POLICY, staticSecurityHeaders } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // SECURITY.md §14 P1-10: static headers on every response (incl. /_next assets). The nonce CSP
  // and Cache-Control for documents and /api are set per request in src/proxy.ts.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: staticSecurityHeaders(process.env.NODE_ENV === 'production'),
      },
      {
        source: '/((?!api/).*)',
        headers: [{ key: 'Referrer-Policy', value: REFERRER_POLICY.documents }],
      },
      { source: '/api/:path*', headers: [{ key: 'Referrer-Policy', value: REFERRER_POLICY.api }] },
    ];
  },
};

export default withNextIntl(nextConfig);
