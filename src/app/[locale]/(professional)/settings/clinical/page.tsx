import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ErrorState } from '@/components/shared/error-state';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { ConfigManager } from '@/modules/clinical-records/components/config-manager';
import {
  listClinicalConfigAction,
  upsertNoteTypeAction,
  upsertSectionDefinitionAction,
} from '@/modules/clinical-records/server/actions';
import { evaluatePermission } from '@/server/authz';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'clinical.config' });
  return { title: t('pageTitle') };
}

/** Owner-only. Every action re-checks `clinical.config.manage`; RLS is the boundary. */
export default async function ClinicalConfigPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, '/settings/clinical');
  if (!ctx) return null;
  const t = await getTranslations('clinical.config');
  const allowed = evaluatePermission(ctx, 'clinical.config.manage').allowed;
  const config = allowed ? await listClinicalConfigAction() : null;
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
      {allowed ? (
        config?.ok ? (
          <ConfigManager
            sections={config.data.sectionDefinitions}
            noteTypes={config.data.noteTypes}
            actions={{
              upsertSection: upsertSectionDefinitionAction,
              upsertNoteType: upsertNoteTypeAction,
            }}
          />
        ) : (
          <ErrorState />
        )
      ) : (
        <Card className="max-w-2xl">
          <p className="text-muted-foreground">{t('ownerOnly')}</p>
        </Card>
      )}
    </div>
  );
}
