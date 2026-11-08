import { Shapes } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import { EmptyState } from '@/components/shared/empty-state';
import { PortalShell, type PortalMode } from '@/components/shared/portal-shell';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

/**
 * DEV-ONLY preview of the portal mode via `?mode=child|adult`.
 * TODO(patient-profile): derive the mode from the patient profile (adolescents -> child) and delete this.
 * Disabled in production unless PORTAL_MODE_PREVIEW=1 (used by e2e/screenshots).
 */
export const dynamic = 'force-dynamic';

const previewEnabled =
  process.env.NODE_ENV !== 'production' || process.env.PORTAL_MODE_PREVIEW === '1';

export default async function PortalHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const { mode: rawMode } = await searchParams;
  const mode: PortalMode = previewEnabled && rawMode === 'child' ? 'child' : 'adult';
  const t = await getTranslations('shell.portal');
  const copy = mode === 'child' ? 'child' : 'adult';

  return (
    <PortalShell
      mode={mode}
      devSwitcher={
        previewEnabled ? (
          <div
            className="mb-6 flex flex-wrap items-center gap-2 text-sm"
            data-testid="dev-mode-switcher"
          >
            <span className="text-muted-foreground">{t('devModeLabel')}</span>
            <Button asChild size="sm" variant={mode === 'adult' ? 'default' : 'outline'}>
              <Link href={{ pathname: '/portal', query: { mode: 'adult' } }}>{t('modeAdult')}</Link>
            </Button>
            <Button asChild size="sm" variant={mode === 'child' ? 'default' : 'outline'}>
              <Link href={{ pathname: '/portal', query: { mode: 'child' } }}>{t('modeChild')}</Link>
            </Button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h1 className="font-display text-display">{t(`${copy}.welcomeTitle`)}</h1>
          <p className="max-w-[60ch] text-body-lg">{t(`${copy}.welcomeBody`)}</p>
        </section>
        <Card>
          <CardHeader>
            <CardTitle>{t(`${copy}.activitiesTitle`)}</CardTitle>
          </CardHeader>
          <EmptyState icon={Shapes} title={t(`${copy}.activitiesEmpty`)} />
        </Card>
      </div>
    </PortalShell>
  );
}
