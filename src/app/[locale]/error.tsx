'use client';

import { useTranslations } from 'next-intl';
import { CenteredPage } from '@/components/shared/centered-page';
import { ErrorState } from '@/components/shared/error-state';
import { Button } from '@/components/ui/button';

export default function LocaleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');
  return (
    <CenteredPage className="max-w-lg">
      <ErrorState
        className="w-full"
        action={
          <div>
            <Button onClick={reset}>{t('retry')}</Button>
          </div>
        }
      />
    </CenteredPage>
  );
}
