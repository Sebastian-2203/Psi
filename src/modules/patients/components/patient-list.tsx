'use client';

import { Lock, Search, UserPlus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import type { ActionResult } from '@/modules/auth/schemas/result';
import { MajoritySoonBadge, MinorBadge, PatientStatusBadge } from './patient-status-badge';
import type { DirectoryEntryDto, PatientSummaryDto } from './types';

function displayName(p: { firstName: string; lastName: string; preferredName: string | null }) {
  return `${p.firstName} ${p.lastName}`;
}

export type SearchPatientsAction = (input: {
  search?: string;
}) => Promise<ActionResult<{ mine: PatientSummaryDto[]; directory: DirectoryEntryDto[] }>>;

/**
 * My patients (care-team rows, linked) + directory-only rows for people the viewer is NOT on the
 * care team of (name + status only, Q-03; no link, no detail). PAT-04: the search term goes to a
 * server action (name / document, RLS-bound; the term never enters the URL or the audit log).
 */
export function PatientList({
  mine,
  directory,
  canCreate,
  search,
}: {
  mine: PatientSummaryDto[];
  directory: DirectoryEntryDto[];
  canCreate: boolean;
  search: SearchPatientsAction;
}) {
  const t = useTranslations('patients');
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{
    q: string;
    mine: PatientSummaryDto[];
    directory: DirectoryEntryDto[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const q = query.trim();
  const searching = q !== '' && found?.q !== q && !failed;

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await search({ search: q });
      if (cancelled) return;
      if (result.ok) {
        setFailed(false);
        setFound({ q, ...result.data });
      } else setFailed(true);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, search]);

  const active = q && found?.q === q ? found : null;
  const myRows = q ? (active?.mine ?? []) : mine;
  const otherRows = (q ? (active?.directory ?? directory) : directory).filter(
    (p) => !p.onMyCareTeam,
  );
  const createButton = canCreate ? (
    <Button asChild>
      <Link href="/patients/new">
        <UserPlus aria-hidden />
        {t('create')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <Label htmlFor={searchId}>{t('searchLabel')}</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              maxLength={100}
              className="pl-10"
            />
          </div>
        </div>
        {createButton}
      </div>

      {failed ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {t('searchFailed')}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {searching ? t('searching') : ''}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>{t('myPatients')}</CardTitle>
        </CardHeader>
        {myRows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? (searching ? t('searching') : t('noResults')) : t('emptyTitle')}
            description={q ? undefined : t('emptyDescription')}
            action={q ? undefined : createButton}
          />
        ) : (
          <ul className="flex flex-col divide-y" data-testid="my-patients">
            {myRows.map((p) => (
              <li key={p.patientId}>
                <Link
                  href={`/patients/${p.patientId}`}
                  className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-3 hover:bg-accent"
                >
                  <span className="font-semibold">{displayName(p)}</span>
                  {p.preferredName ? (
                    <span className="text-sm text-muted-foreground">({p.preferredName})</span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-2">
                    <MinorBadge isMinor={p.isMinor} />
                    <MajoritySoonBadge days={p.majorityInDays} />
                    <PatientStatusBadge status={p.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {directory.some((p) => !p.onMyCareTeam) ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('directoryTitle')}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Lock className="size-4 shrink-0" aria-hidden />
              {t('directoryDescription')}
            </CardDescription>
          </CardHeader>
          {otherRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {searching ? t('searching') : t('noResults')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="directory-patients">
              {otherRows.map((p) => (
                <li
                  key={p.patientId}
                  className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3"
                >
                  <span className="font-semibold">{displayName(p)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <PatientStatusBadge status={p.status} />
                    <span className="text-xs text-muted-foreground">{t('notOnCareTeam')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
