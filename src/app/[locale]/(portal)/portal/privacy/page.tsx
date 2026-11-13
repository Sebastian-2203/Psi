import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ErrorState } from '@/components/shared/error-state';
import { PortalShell } from '@/components/shared/portal-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { requirePortalAccess } from '@/modules/auth/server/guards';
import { PrivacyView } from '@/modules/patients/components/privacy-view';
import { getPrivacyViewAction } from '@/modules/patients/server/actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'portal.privacy' });
  return { title: t('title') };
}

/** GRD-07. Patient only (the action re-checks `portal.privacy.read`); guardians never see this page. */
export default async function PortalPrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const access = await requirePortalAccess();
  if (!access.ok) return null;
  const t = await getTranslations('portal.privacy');
  const patient = access.ctx.actingAs === 'patient';
  const result = patient ? await getPrivacyViewAction() : null;
  const mode = result?.ok && result.data.length > 0 ? 'child' : 'adult';

  return (
    <PortalShell mode={mode}>
      <div className="flex flex-col gap-6">
        <Button asChild variant="link" className="self-start">
          <Link href="/portal">{t('back')}</Link>
        </Button>
        {!patient ? (
          <Card>
            <p>{t('patientsOnly')}</p>
          </Card>
        ) : result && result.ok ? (
          <PrivacyView entries={result.data} />
        ) : (
          <ErrorState />
        )}
      </div>
    </PortalShell>
  );
}
