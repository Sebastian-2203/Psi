import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { Link } from '@/i18n/navigation';
import { CreateInvitationForm } from '@/modules/auth';
import { createInvitationAction } from '@/modules/auth/server/actions';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { listStaffInvitations, STAFF_INVITATION_TTL_HOURS } from '@/server/auth/invitations';
import { evaluatePermission } from '@/server/authz';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.settings' });
  return { title: t('title') };
}

/** Minimal settings placeholder: staff invitations (owner only) + link to recovery codes. */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, '/settings');
  if (!ctx) return null;
  const t = await getTranslations('auth.settings');
  const tb = await getTranslations('branding');
  const tcn = await getTranslations('consents.templates');
  const tdr = await getTranslations('dataRequests.settingsCard');
  const tcc = await getTranslations('clinical.config');
  const format = await getFormatter();
  const canBrand = evaluatePermission(ctx, 'org.branding.manage').allowed;
  const canTemplates = evaluatePermission(ctx, 'consent.template.manage').allowed;
  const canClinicalConfig = evaluatePermission(ctx, 'clinical.config.manage').allowed;
  const canInvite = evaluatePermission(ctx, 'org.invitations.manage').allowed;
  const invitations = canInvite ? await listStaffInvitations(ctx) : null;
  const statusLabel = {
    pending: t('statusPending'),
    accepted: t('statusAccepted'),
    revoked: t('statusRevoked'),
    expired: t('statusExpired'),
  } as const;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('inviteTitle')}</CardTitle>
          {canInvite ? (
            <CardDescription>
              {t('inviteDescription', { hours: STAFF_INVITATION_TTL_HOURS })}
            </CardDescription>
          ) : null}
        </CardHeader>
        {canInvite ? (
          <CreateInvitationForm action={createInvitationAction} />
        ) : (
          <p className="text-muted-foreground">{t('ownerOnly')}</p>
        )}
      </Card>
      {invitations?.ok ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>{t('listTitle')}</CardTitle>
          </CardHeader>
          {invitations.data.length === 0 ? (
            <p className="text-muted-foreground">{t('listEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="invitation-list">
              {invitations.data.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="font-semibold break-all">{inv.email}</span>
                  <Badge variant="neutral">{statusLabel[inv.status]}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {t('expires', {
                      date: format.dateTime(new Date(inv.expiresAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{tb('title')}</CardTitle>
          <CardDescription>{tb('cardDescription')}</CardDescription>
        </CardHeader>
        {canBrand ? (
          <Link
            href="/settings/branding"
            className="font-semibold text-primary underline underline-offset-4"
          >
            {tb('open')}
          </Link>
        ) : (
          <p className="text-muted-foreground">{tb('ownerOnly')}</p>
        )}
      </Card>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{tcn('cardTitle')}</CardTitle>
          <CardDescription>{tcn('cardDescription')}</CardDescription>
        </CardHeader>
        {canTemplates ? (
          <Link
            href="/settings/consents"
            className="font-semibold text-primary underline underline-offset-4"
          >
            {tcn('open')}
          </Link>
        ) : (
          <p className="text-muted-foreground">{tcn('ownerOnly')}</p>
        )}
      </Card>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{tcc('cardTitle')}</CardTitle>
          <CardDescription>{tcc('cardDescription')}</CardDescription>
        </CardHeader>
        {canClinicalConfig ? (
          <Link
            href="/settings/clinical"
            className="font-semibold text-primary underline underline-offset-4"
          >
            {tcc('open')}
          </Link>
        ) : (
          <p className="text-muted-foreground">{tcc('ownerOnly')}</p>
        )}
      </Card>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{tdr('cardTitle')}</CardTitle>
          <CardDescription>{tdr('cardDescription')}</CardDescription>
        </CardHeader>
        <Link
          href="/settings/data-requests"
          className="font-semibold text-primary underline underline-offset-4"
        >
          {tdr('open')}
        </Link>
      </Card>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('security')}</CardTitle>
        </CardHeader>
        <Link
          href="/mfa/recovery-codes"
          className="font-semibold text-primary underline underline-offset-4"
        >
          {t('securityLink')}
        </Link>
      </Card>
    </div>
  );
}
