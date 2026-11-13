'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CheckField, FormError } from '@/components/shared/form-kit';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import type { SetPermissionsInput } from '@/modules/guardians/schemas';
import { PERMISSION_KEYS, type GuardianActions, type GuardianRelationshipDto } from './types';

/**
 * Explicit grants only (rule 5): nothing is checked by default; a checked box is a granted
 * permission. Minors' private reflections are never part of any permission.
 */
export function PermissionsChecklist({
  relationship,
  action,
}: {
  relationship: GuardianRelationshipDto;
  action: GuardianActions['setPermissions'];
}) {
  const t = useTranslations('guardians.permissions');
  const router = useRouter();
  const [granted, setGranted] = useState<string[]>(relationship.permissions);
  const [error, setError] = useState<ActionError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = relationship.status === 'suspended' || relationship.status === 'revoked';
  const unverified = relationship.status === 'pending_verification';
  const scheduleRestricted = relationship.caveat?.restrictSchedule === true;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await action({
      patientGuardianId: relationship.patientGuardianId,
      permissions: granted as SetPermissionsInput['permissions'],
    });
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else setError(result.error);
  }

  return (
    <fieldset
      className="flex flex-col gap-3 rounded-md border p-4"
      disabled={locked || unverified}
      data-testid={`permissions-${relationship.patientGuardianId}`}
    >
      <legend className="px-1 font-bold">{t('title')}</legend>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {unverified ? <Alert variant="info">{t('needsVerification')}</Alert> : null}
      {locked ? <Alert variant="warning">{t('locked')}</Alert> : null}
      <FormError error={error} />
      {saved ? <Alert variant="success">{t('saved')}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {PERMISSION_KEYS.map((key) => {
          const blocked = key === 'view_session_schedule' && scheduleRestricted;
          return (
            <CheckField
              key={key}
              label={t(`items.${key}.label`)}
              hint={blocked ? t('scheduleRestricted') : t(`items.${key}.hint`)}
              checked={granted.includes(key) && !blocked}
              disabled={blocked}
              onCheckedChange={(next) =>
                setGranted((g) => (next ? [...g, key] : g.filter((k) => k !== key)))
              }
            />
          );
        })}
      </div>
      <Button onClick={save} loading={busy} className="self-start">
        {t('save')}
      </Button>
    </fieldset>
  );
}
