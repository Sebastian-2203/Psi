'use client';

import { Lock, Search, UserPlus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import { MinorBadge, PatientStatusBadge } from './patient-status-badge';
import type { DirectoryEntryDto, PatientSummaryDto } from './types';

function displayName(p: { firstName: string; lastName: string; preferredName: string | null }) {
  return `${p.firstName} ${p.lastName}`;
}

function matches(
  p: { firstName: string; lastName: string; preferredName: string | null },
  q: string,
) {
  const hay = `${p.firstName} ${p.lastName} ${p.preferredName ?? ''}`.toLowerCase();
  return hay.includes(q);
}

/**
 * My patients (care-team rows, linked) + directory-only rows for people the viewer is NOT on the
 * care team of (name + status only, Q-03; no link, no detail). Search is client-side over the
 * already-authorized rows.
 */
export function PatientList({
  mine,
  directory,
  canCreate,
}: {
  mine: PatientSummaryDto[];
  directory: DirectoryEntryDto[];
  canCreate: boolean;
}) {
  const t = useTranslations('patients');
  const searchId = useId();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const myRows = useMemo(() => mine.filter((p) => !q || matches(p, q)), [mine, q]);
  const otherRows = useMemo(
    () => directory.filter((p) => !p.onMyCareTeam && (!q || matches(p, q))),
    [directory, q],
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
              className="pl-10"
            />
          </div>
        </div>
        {createButton}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('myPatients')}</CardTitle>
        </CardHeader>
        {myRows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={mine.length === 0 ? t('emptyTitle') : t('noResults')}
            description={mine.length === 0 ? t('emptyDescription') : undefined}
            action={mine.length === 0 ? createButton : undefined}
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
            <p className="text-sm text-muted-foreground">{t('noResults')}</p>
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
