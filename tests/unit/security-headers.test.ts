import { describe, expect, it } from 'vitest';
import {
  API_CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
  buildContentSecurityPolicy,
  generateNonce,
  staticSecurityHeaders,
} from '@/lib/security-headers';

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name as string, values.join(' ')];
    }),
  );
}

describe('security headers (P1-10)', () => {
  it('generates unpredictable base64 nonces of 128 bits', () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });

  it('document CSP: nonce + strict-dynamic scripts, no objects/framing, Supabase origin only', () => {
    const csp = directives(
      buildContentSecurityPolicy({
        nonce: 'abc123',
        supabaseUrl: 'https://project.supabase.co/some/path',
        development: false,
      }),
    );
    expect(csp.get('script-src')).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('frame-ancestors')).toBe("'none'");
    expect(csp.get('form-action')).toBe("'self'");
    expect(csp.get('img-src')).toBe("'self' data: blob: https://project.supabase.co");
    expect(csp.get('connect-src')).toBe("'self' https://project.supabase.co");
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('script-src')).not.toContain('unsafe-inline');
    expect(csp.get('script-src')).not.toContain('unsafe-eval');
    // Styles: elements need the nonce; only style ATTRIBUTES (React style props) are inline.
    expect(csp.get('style-src')).toBe("'self'");
    expect(csp.get('style-src-elem')).toBe("'self' 'nonce-abc123'");
    expect(csp.get('style-src-attr')).toBe("'unsafe-inline'");
    expect(csp.get('style-src-elem')).not.toContain('unsafe-inline');
  });

  it("allows 'unsafe-eval' only in development", () => {
    const dev = buildContentSecurityPolicy({
      nonce: 'n',
      supabaseUrl: 'http://127.0.0.1:54321',
      development: true,
    });
    expect(directives(dev).get('script-src')).toContain("'unsafe-eval'");
  });

  it('API CSP forbids everything', () => {
    expect(directives(API_CONTENT_SECURITY_POLICY).get('default-src')).toBe("'none'");
  });

  it('static headers; HSTS only in production', () => {
    const prod = new Map(staticSecurityHeaders(true).map((h) => [h.key, h.value]));
    expect(prod.get('X-Content-Type-Options')).toBe('nosniff');
    expect(prod.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(prod.get('Permissions-Policy')).toContain('camera=()');
    expect(prod.get('Strict-Transport-Security')).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
    const dev = staticSecurityHeaders(false).map((h) => h.key);
    expect(dev).not.toContain('Strict-Transport-Security');
    expect(REFERRER_POLICY).toEqual({
      documents: 'strict-origin-when-cross-origin',
      api: 'no-referrer',
    });
  });
});
