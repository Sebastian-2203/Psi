import { getTranslations } from 'next-intl/server';
import { ErrorState } from '@/components/shared/error-state';
import { PortalDocuments } from '@/modules/documents/components/portal-documents';
import { issuePortalDocumentUrlAction } from '@/modules/documents/server/actions';
import { listMySharedDocuments } from '@/modules/documents/server/service';
import { PortalSessions } from '@/modules/sessions/components/portal-sessions';
import { listMyUpcomingSessions } from '@/modules/sessions/server/service';
import { PortalGoals } from '@/modules/treatment/components/portal-goals';
import { listMyGoals } from '@/modules/treatment/server/service';
import type { AuthzContext } from '@/server/authz';

/**
 * Portal sections of Phase 3 (PRT-05/06/07). Each projection is a SECURITY DEFINER function that
 * re-checks identity, status and guardian permissions in the database; the `can*` flags only decide
 * which sections to ask for (guardians: the explicit permission of the selected relationship).
 * What is shown: patient-facing goal wording, session date/time/status/modality, shared documents.
 * Never notes, plans, diagnoses or any professional documentation.
 */
export async function PortalClinicalSections({
  ctx,
  patientId,
  canGoals,
  canSessions,
  canDocuments,
}: {
  ctx: AuthzContext;
  /** Guardian: the selected relationship's patient. Patient: undefined (herself). */
  patientId?: string;
  canGoals: boolean;
  canSessions: boolean;
  canDocuments: boolean;
}) {
  const t = await getTranslations('clinical.portal');
  const [goals, sessions, documents] = await Promise.all([
    canGoals ? listMyGoals(ctx, patientId) : null,
    canSessions ? listMyUpcomingSessions(ctx, patientId) : null,
    canDocuments ? listMySharedDocuments(ctx, patientId) : null,
  ]);
  return (
    <>
      {goals ? (
        <section aria-labelledby="portal-goals-title" className="flex flex-col gap-3">
          <h2 id="portal-goals-title" className="font-display text-h2">
            {t('goals.title')}
          </h2>
          <p className="text-muted-foreground">{t('goals.intro')}</p>
          {goals.ok ? <PortalGoals goals={goals.data} /> : <ErrorState />}
        </section>
      ) : null}
      {sessions ? (
        <section aria-labelledby="portal-sessions-title" className="flex flex-col gap-3">
          <h2 id="portal-sessions-title" className="font-display text-h2">
            {t('sessions.title')}
          </h2>
          {sessions.ok ? <PortalSessions sessions={sessions.data} /> : <ErrorState />}
        </section>
      ) : null}
      {documents ? (
        <section aria-labelledby="portal-documents-title" className="flex flex-col gap-3">
          <h2 id="portal-documents-title" className="font-display text-h2">
            {t('documents.title')}
          </h2>
          {documents.ok ? (
            <PortalDocuments
              documents={documents.data}
              patientId={patientId}
              openAction={issuePortalDocumentUrlAction}
            />
          ) : (
            <ErrorState />
          )}
        </section>
      ) : null}
    </>
  );
}
