'use client';

import { useSyncExternalStore } from 'react';
import { LoadingState } from '@/components/shared/loading-state';
import { AcceptInvitation } from './accept-invitation';
import { AcceptPortalInvitation } from './accept-portal-invitation';

type Props = {
  staff: React.ComponentProps<typeof AcceptInvitation>;
  portal: React.ComponentProps<typeof AcceptPortalInvitation>;
};

type Kind = 'staff' | 'portal';
let cachedKind: Kind | null = null;

/** Cached because the chosen child removes the fragment from the address bar. */
function readKind(): Kind {
  if (!cachedKind) {
    const hint = new URLSearchParams(window.location.hash.slice(1)).get('kind');
    cachedKind = hint === 'patient' || hint === 'guardian' ? 'portal' : 'staff';
  }
  return cachedKind;
}
const subscribe = () => () => {};

/**
 * Routes an invitation link to the staff or portal acceptance form from the `kind` fragment hint
 * (UI routing only: both previews are validated server-side and reject the other kind's tokens).
 * Reads the hash WITHOUT clearing it: the chosen child takes (and removes) the token afterwards.
 */
export function InvitationEntry({ staff, portal }: Props) {
  const kind = useSyncExternalStore(subscribe, readKind, () => null);
  if (!kind) return <LoadingState rows={2} />;
  return kind === 'portal' ? (
    <AcceptPortalInvitation {...portal} />
  ) : (
    <AcceptInvitation {...staff} />
  );
}
