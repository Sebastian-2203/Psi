import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ErrorState } from '@/components/shared/error-state';
import { getRouteLocale } from '@/i18n/route-locale';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { PatientList } from '@/modules/patients/components/patient-list';
import { listDirectory, listMyPatients } from '@/modules/patients/server/queries';
import { evaluatePermission } from '@/server/authz';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'patients' });
  return { title: t('title') };
}

/**
 * Care-team rows come from RLS; the directory (name + status only, Q-03) adds the rows the viewer
 * is NOT on the care team of. A staff member without the psychologist role (owner only) has no
 * "my patients" (FORBIDDEN) and still sees the directory.
 */
export default async function PatientsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, '/patients');
  if (!ctx) return null;
  const t = await getTranslations('patients');
  const [mine, directory] = await Promise.all([
    listMyPatients(ctx, { limit: 100 }),
    listDirectory(ctx),
  ]);
  const mineFailed = !mine.ok && mine.error.code !== 'FORBIDDEN';
  const failed = mineFailed || !directory.ok;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>
      {failed ? (
        <ErrorState title={t('loadErrorTitle')} description={t('loadErrorDescription')} />
      ) : (
        <PatientList
          mine={mine.ok ? mine.data : []}
          directory={directory.ok ? directory.data : []}
          canCreate={evaluatePermission(ctx, 'patient.create').allowed}
        />
      )}
    </div>
  );
}
