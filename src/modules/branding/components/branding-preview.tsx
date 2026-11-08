'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { PracticeName } from '@/components/shared/practice-name';
import { Button } from '@/components/ui/button';
import type { BrandTokens } from '@/styles/branding';

type PreviewContext = 'professional' | 'portal-adult' | 'portal-child';
const CONTEXTS: {
  context: PreviewContext;
  labelKey: 'professional' | 'portalAdult' | 'portalChild';
}[] = [
  { context: 'professional', labelKey: 'professional' },
  { context: 'portal-adult', labelKey: 'portalAdult' },
  { context: 'portal-child', labelKey: 'portalChild' },
];

/**
 * Live preview of the draft branding in each design context. The resolved tokens are applied as
 * custom properties through the `style` prop (CSSOM, so it works under a nonce-based CSP) on an
 * element that carries `data-context`, i.e. the same cascade the real pages get from
 * <ThemeVariables>, with the draft winning over the context defaults.
 */
export function BrandingPreview({
  tokens,
  displayName,
  logoUrl,
}: {
  tokens: BrandTokens;
  displayName: string;
  logoUrl: string | null;
}) {
  const t = useTranslations('branding.preview');
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="branding-preview">
      {CONTEXTS.map(({ context, labelKey }) => (
        <section
          key={context}
          aria-labelledby={`preview-${context}`}
          className="flex flex-col gap-2"
        >
          <h3 id={`preview-${context}`} className="text-sm font-bold text-muted-foreground">
            {t(labelKey)}
          </h3>
          <div
            data-context={context}
            data-testid={`preview-${context}`}
            style={tokens as CSSProperties}
            className="flex flex-col gap-4 overflow-hidden rounded-lg border bg-background p-4 text-foreground"
          >
            <PracticeName name={displayName || ' '} logoUrl={logoUrl} />
            <p className="text-sm">{t('sample')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" tabIndex={-1}>
                {t('primaryButton')}
              </Button>
              <span className="text-sm font-semibold text-primary underline underline-offset-4">
                {t('link')}
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                {t('tag')}
              </span>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
