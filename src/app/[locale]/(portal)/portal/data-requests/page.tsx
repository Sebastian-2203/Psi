import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ErrorState } from '@/components/shared/error-state';
import { PortalShell } from '@/components/shared/portal-shell';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { requirePortalAccess } from '@/modules/auth/server/guards';
import { PortalDataRequests } from '@/modules/data-requests/components/portal-requests';
import { submitDataRequestAction } from '@/modules/data-requests/server/actions';
import { listMyDataRequests } from '@/modules/data-requests/server/queries';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'dataRequests.portal' });
  return { title: t('pageTitle') };
}

/** PAT-09: patient or guardian (about her own data). Actions re-check the real capacity. */
export default async function PortalDataRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const access = await requirePortalAccess();
  if (!access.ok) return null;
  const t = await getTranslations('dataRequests.portal');
  const ctx = access.ctx;
  const requests =
    ctx.actingAs === 'patient' || ctx.actingAs === 'guardian'
      ? await listMyDataRequests(ctx)
      : null;
  return (
    <PortalShell mode="adult">
      <div className="flex flex-col gap-6">
        <Button asChild variant="link" className="self-start">
          <Link href="/portal">{t('back')}</Link>
        </Button>
        <div>
          <h1 className="font-display text-display">{t('pageTitle')}</h1>
          <p className="mt-1 max-w-[60ch] text-body-lg">{t('pageDescription')}</p>
        </div>
        {requests && requests.ok ? (
          <PortalDataRequests requests={requests.data} action={submitDataRequestAction} />
        ) : (
          <ErrorState />
        )}
      </div>
    </PortalShell>
  );
}
