import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { BrandingSettings } from '@/modules/branding';
import {
  removeLogoAction,
  updateBrandingAction,
  uploadLogoAction,
} from '@/modules/branding/server/actions';
import { getBrandingSettings } from '@/modules/branding/server/queries';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { evaluatePermission } from '@/server/authz';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'branding' });
  return { title: t('title') };
}

/** Owner-only (organization_owner, aal2). Every action re-checks `org.branding.manage`; RLS is the boundary. */
export default async function BrandingSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, '/settings/branding');
  if (!ctx) return null;
  const t = await getTranslations('branding');
  const allowed = evaluatePermission(ctx, 'org.branding.manage').allowed;
  const settings = allowed ? await getBrandingSettings(ctx) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm font-semibold text-primary underline underline-offset-4"
        >
          {t('back')}
        </Link>
        <h1 className="mt-2">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>
      {settings?.ok ? (
        <BrandingSettings
          initial={{
            displayName: settings.data.displayName,
            brandColor: settings.data.brandColor,
            functionalColor: settings.data.functionalColor,
            secondaryColor: settings.data.secondaryColor,
            logoUrl: settings.data.logoUrl,
            updatedAt: settings.data.updatedAt,
          }}
          updateAction={updateBrandingAction}
          uploadLogoAction={uploadLogoAction}
          removeLogoAction={removeLogoAction}
        />
      ) : (
        <Card className="max-w-2xl">
          <p className="text-muted-foreground">{allowed ? t('loadError') : t('ownerOnly')}</p>
        </Card>
      )}
    </div>
  );
}
