import { Shapes, ShieldCheck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { PortalShell, type PortalMode } from '@/components/shared/portal-shell';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { isPortalPreviewEnabled } from '@/lib/portal-preview';
import { CapacitySelector } from '@/modules/auth';
import { selectCapacityAction } from '@/modules/auth/server/actions';
import { requirePortalAccess } from '@/modules/auth/server/guards';
import { SignConsentList } from '@/modules/consents/components/sign-consent';
import { signConsentAction } from '@/modules/consents/server/actions';
import { listSignableConsents } from '@/modules/consents/server/queries';
import { PortalClinicalSections } from '@/modules/documents/panels/portal-clinical-sections';
import { PermissionList } from '@/modules/guardians/components/permission-list';
import { getMyRelationships } from '@/modules/guardians/server/queries';
import { getMyPortalMode } from '@/modules/patients/server/queries';

export const dynamic = 'force-dynamic';

const previewEnabled = isPortalPreviewEnabled();

/**
 * Portal home. Patient: own signable consents. Guardian: ONLY what the explicit permissions of the
 * selected relationship allow (consents need `sign_consents`, activities need `view_assignments`).
 * Mode: the patient's stored portal mode (`app.my_portal_mode`): child and adolescent render
 * `portal-child`, adult `portal-adult`. Without a session only the dev-only static preview renders.
 */
export default async function PortalHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string | string[]; patient?: string | string[] }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const query = await searchParams;
  const access = await requirePortalAccess();
  const t = await getTranslations('shell.portal');

  if (!access.ok) {
    // Layout only lets this through for the dev-only static preview (no data at all).
    const mode: PortalMode = previewEnabled && query.mode === 'child' ? 'child' : 'adult';
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
                <Link href={{ pathname: '/portal', query: { mode: 'adult' } }}>
                  {t('modeAdult')}
                </Link>
              </Button>
              <Button asChild size="sm" variant={mode === 'child' ? 'default' : 'outline'}>
                <Link href={{ pathname: '/portal', query: { mode: 'child' } }}>
                  {t('modeChild')}
                </Link>
              </Button>
            </div>
          ) : null
        }
      >
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h1 className="font-display text-display">{t(`${mode}.welcomeTitle`)}</h1>
            <p className="max-w-[60ch] text-body-lg">{t(`${mode}.welcomeBody`)}</p>
          </section>
          <Card>
            <CardHeader>
              <CardTitle>{t(`${mode}.activitiesTitle`)}</CardTitle>
            </CardHeader>
            <EmptyState icon={Shapes} title={t(`${mode}.activitiesEmpty`)} />
          </Card>
        </div>
      </PortalShell>
    );
  }

  const ctx = access.ctx;
  const tp = await getTranslations('portal');
  const isGuardian = ctx.actingAs === 'guardian';

  const capacities = ctx.availableCapacities.filter(
    (c): c is { organizationId: string; actingAs: 'patient' | 'guardian' } =>
      c.organizationId === ctx.organizationId &&
      (c.actingAs === 'patient' || c.actingAs === 'guardian'),
  );

  // Guardian: effective relationships only; the selected patient drives everything below.
  let relationship: { patientId: string; displayName: string; permissions: string[] } | null = null;
  let others: { patientId: string; displayName: string }[] = [];
  let loadFailed = false;
  if (isGuardian) {
    const mine = await getMyRelationships(ctx);
    if (!mine.ok) loadFailed = true;
    else {
      const effective = mine.data.filter((r) => r.effective);
      const wanted = typeof query.patient === 'string' ? query.patient : undefined;
      const chosen = effective.find((r) => r.patientId === wanted) ?? effective[0];
      if (chosen) {
        relationship = {
          patientId: chosen.patientId,
          displayName: chosen.patientDisplayName ?? '',
          permissions: chosen.permissions,
        };
      }
      others = effective
        .filter((r) => r.patientId !== chosen?.patientId)
        .map((r) => ({ patientId: r.patientId, displayName: r.patientDisplayName ?? '' }));
    }
  }

  // Stored experience mode (patient herself / a guardian of an effective relationship); adolescents
  // render the child design context. If the read fails we fall back to the adult context.
  const storedMode =
    !isGuardian || relationship
      ? await getMyPortalMode(ctx, isGuardian ? relationship?.patientId : undefined)
      : null;
  const mode: PortalMode =
    !isGuardian && previewEnabled && query.mode === 'child'
      ? 'child'
      : storedMode?.ok && storedMode.data !== 'adult'
        ? 'child'
        : 'adult';

  const canSign = isGuardian
    ? (relationship?.permissions.includes('sign_consents') ?? false)
    : true;
  const canSeeActivities = isGuardian
    ? (relationship?.permissions.includes('view_assignments') ?? false)
    : true;
  const signable =
    canSign && (!isGuardian || relationship)
      ? await listSignableConsents(ctx, isGuardian ? relationship?.patientId : undefined)
      : null;
  const copy = mode === 'child' ? 'child' : 'adult';
  const has = (permission: string) =>
    !isGuardian || (relationship?.permissions.includes(permission) ?? false);
  const clinicalVisible = !isGuardian || relationship !== null;

  return (
    <PortalShell mode={mode}>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h1 className="font-display text-display">
            {isGuardian ? tp('guardian.welcomeTitle') : t(`${copy}.welcomeTitle`)}
          </h1>
          <p className="max-w-[60ch] text-body-lg">
            {isGuardian ? tp('guardian.welcomeBody') : t(`${copy}.welcomeBody`)}
          </p>
        </section>

        {capacities.length > 1 ? (
          <CapacitySelector
            current={ctx.actingAs as 'patient' | 'guardian'}
            options={capacities}
            action={selectCapacityAction}
          />
        ) : null}

        {isGuardian && loadFailed ? <ErrorState /> : null}
        {isGuardian && !loadFailed && !relationship ? (
          <Card>
            <EmptyState
              icon={ShieldCheck}
              title={tp('guardian.noAccessTitle')}
              description={tp('guardian.noAccessDescription')}
            />
          </Card>
        ) : null}

        {isGuardian && relationship ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  {tp('guardian.forPatient', { name: relationship.displayName })}
                </CardTitle>
                <CardDescription>{tp('guardian.permissionsIntro')}</CardDescription>
              </CardHeader>
              <PermissionList
                permissions={relationship.permissions}
                label={tp('guardian.permissionsIntro')}
              />
              {others.length > 0 ? (
                <nav aria-label={tp('guardian.switchPatient')} className="flex flex-wrap gap-2">
                  {others.map((o) => (
                    <Button key={o.patientId} asChild variant="outline" size="sm">
                      <Link href={{ pathname: '/portal', query: { patient: o.patientId } }}>
                        {o.displayName}
                      </Link>
                    </Button>
                  ))}
                </nav>
              ) : null}
            </Card>
          </>
        ) : null}

        {canSign && (!isGuardian || relationship) ? (
          <section aria-labelledby="consents-title" className="flex flex-col gap-4">
            <h2 id="consents-title" className="font-display text-h2">
              {tp('consents.title')}
            </h2>
            {signable && !signable.ok ? (
              <ErrorState />
            ) : signable && signable.data.length > 0 ? (
              <SignConsentList consents={signable.data} action={signConsentAction} />
            ) : (
              <Card>
                <EmptyState icon={ShieldCheck} title={tp('consents.empty')} />
              </Card>
            )}
          </section>
        ) : null}

        {canSeeActivities && (!isGuardian || relationship) ? (
          <Card>
            <CardHeader>
              <CardTitle>{t(`${copy}.activitiesTitle`)}</CardTitle>
            </CardHeader>
            <EmptyState icon={Shapes} title={t(`${copy}.activitiesEmpty`)} />
          </Card>
        ) : null}

        {clinicalVisible ? (
          <PortalClinicalSections
            ctx={ctx}
            patientId={isGuardian ? relationship?.patientId : undefined}
            canGoals={has('view_patient_facing_goals')}
            canSessions={has('view_session_schedule')}
            canDocuments={has('view_shared_documents')}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{tp('dataRequests.cardTitle')}</CardTitle>
            <CardDescription>{tp('dataRequests.cardDescription')}</CardDescription>
          </CardHeader>
          <Button asChild variant="outline" className="self-start">
            <Link href="/portal/data-requests">{tp('dataRequests.open')}</Link>
          </Button>
        </Card>

        {!isGuardian ? (
          <Card>
            <CardHeader>
              <CardTitle>{tp('privacy.cardTitle')}</CardTitle>
              <CardDescription>{tp('privacy.cardDescription')}</CardDescription>
            </CardHeader>
            <Button asChild variant="outline" className="self-start">
              <Link href="/portal/privacy">{tp('privacy.open')}</Link>
            </Button>
          </Card>
        ) : null}
      </div>
    </PortalShell>
  );
}
