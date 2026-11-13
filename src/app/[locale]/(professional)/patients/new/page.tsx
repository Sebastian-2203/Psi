import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { CreatePatientForm } from '@/modules/patients/components/create-patient-form';
import { createPatientAction } from '@/modules/patients/server/actions';
import { evaluatePermission } from '@/server/authz';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'patients' });
  return { title: t('create') };
}

export default async function NewPatientPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, '/patients/new');
  if (!ctx) return null;
  const t = await getTranslations('patients');
  const allowed = evaluatePermission(ctx, 'patient.create').allowed;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/patients"
          className="text-sm font-semibold text-primary underline underline-offset-4"
        >
          {t('back')}
        </Link>
        <h1 className="mt-2">{t('create')}</h1>
        <p className="mt-1 text-muted-foreground">{t('createDescription')}</p>
      </div>
      {allowed ? (
        <Card>
          <CreatePatientForm action={createPatientAction} />
        </Card>
      ) : (
        <Card>
          <p className="text-muted-foreground">{t('createForbidden')}</p>
        </Card>
      )}
    </div>
  );
}
