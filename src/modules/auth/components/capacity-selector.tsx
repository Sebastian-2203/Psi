'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormError } from '@/components/shared/form-kit';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';

export type CapacityOption = { organizationId: string; actingAs: 'patient' | 'guardian' };

/** Shown only when the signed-in person holds more than one portal capacity in this practice. */
export function CapacitySelector({
  current,
  options,
  action,
}: {
  current: CapacityOption['actingAs'];
  options: CapacityOption[];
  action: (input: {
    organizationId: string | null;
    actingAs: 'staff' | 'patient' | 'guardian' | 'platform_admin';
  }) => Promise<ActionResult<{ href: string }>>;
}) {
  const t = useTranslations('portal.capacity');
  const router = useRouter();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(option: CapacityOption) {
    setBusy(option.actingAs);
    setError(null);
    const result = await action(option);
    setBusy(null);
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <section aria-labelledby="capacity-title" className="rounded-lg border bg-card p-4">
      <h2 id="capacity-title" className="text-h3 font-bold">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      <FormError error={error} />
      <div role="group" aria-labelledby="capacity-title" className="mt-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o.actingAs}
            variant={o.actingAs === current ? 'default' : 'outline'}
            aria-pressed={o.actingAs === current}
            loading={busy === o.actingAs}
            onClick={() => (o.actingAs === current ? undefined : choose(o))}
          >
            {t(o.actingAs)}
          </Button>
        ))}
      </div>
    </section>
  );
}
