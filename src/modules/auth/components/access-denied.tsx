import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CenteredPage } from '@/components/shared/centered-page';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { Card } from '@/components/ui/card';
import { SignOutButton } from './sign-out-button';

/** Neutral access-denied screen (no detail about why, no other tenant's data). */
export function AccessDenied({
  reason,
  signOutAction,
}: {
  reason: 'no_access' | 'select_organization';
  signOutAction: () => Promise<void>;
}) {
  const t = useTranslations('auth.accessDenied');
  return (
    <CenteredPage header={<LocaleSwitcher />} className="max-w-md">
      <Card className="w-full" data-testid="access-denied">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
        <h1>{t('title')}</h1>
        <p className="text-muted-foreground">
          {reason === 'select_organization' ? t('selectOrganization') : t('body')}
        </p>
        <SignOutButton action={signOutAction} label={t('signOut')} />
      </Card>
    </CenteredPage>
  );
}
