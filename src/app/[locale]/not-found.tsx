import { Compass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CenteredPage } from '@/components/shared/centered-page';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export default function LocaleNotFound() {
  const t = useTranslations('errors');
  return (
    <CenteredPage className="max-w-lg">
      <Card className="w-full">
        <EmptyState
          icon={Compass}
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
          action={
            <Button asChild>
              <Link href="/">{t('backHome')}</Link>
            </Button>
          }
        />
      </Card>
    </CenteredPage>
  );
}
