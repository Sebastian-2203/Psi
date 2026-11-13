import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { TemplateManager } from '@/modules/consents/components/template-manager';
import {
  createConsentTemplateAction,
  publishConsentVersionAction,
  saveConsentVersionDraftAction,
} from '@/modules/consents/server/actions';
import { evaluatePermission } from '@/server/authz';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'consents.templates' });
  return { title: t('pageTitle') };
}

/** Owner-only. Every action re-checks `consent.template.manage`; RLS is the boundary. */
export default async function ConsentTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, '/settings/consents');
  if (!ctx) return null;
  const t = await getTranslations('consents.templates');
  const allowed = evaluatePermission(ctx, 'consent.template.manage').allowed;
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
        <TemplateManager
          actions={{
            createTemplate: createConsentTemplateAction,
            saveDraft: saveConsentVersionDraftAction,
            publish: publishConsentVersionAction,
          }}
        />
      ) : (
        <Card className="max-w-2xl">
          <p className="text-muted-foreground">{t('ownerOnly')}</p>
        </Card>
      )}
    </div>
  );
}
