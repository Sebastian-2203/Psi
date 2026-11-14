import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ErrorState } from '@/components/shared/error-state';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { StaffDataRequests } from '@/modules/data-requests/components/staff-requests';
import { updateDataRequestAction } from '@/modules/data-requests/server/actions';
import { listDataRequests } from '@/modules/data-requests/server/queries';
import { evaluatePermission } from '@/server/authz';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'dataRequests.staff' });
  return { title: t('pageTitle') };
}

/** PAT-09. Owner: every request of the practice. Psychologist: requests of her care-team patients. */
export default async function DataRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, '/settings/data-requests');
  if (!ctx) return null;
  const t = await getTranslations('dataRequests.staff');
  const requests = await listDataRequests(ctx);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm font-semibold text-primary underline underline-offset-4"
        >
          {t('back')}
        </Link>
        <h1 className="mt-2">{t('pageTitle')}</h1>
        <p className="mt-1 text-muted-foreground">{t('pageDescription')}</p>
      </div>
      {requests.ok ? (
        <StaffDataRequests
          requests={requests.data}
          action={updateDataRequestAction}
          canManage={evaluatePermission(ctx, 'dsr.manage').allowed}
        />
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
