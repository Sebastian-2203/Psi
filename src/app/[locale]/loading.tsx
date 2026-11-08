import { CenteredPage } from '@/components/shared/centered-page';
import { LoadingState } from '@/components/shared/loading-state';

export default function LocaleLoading() {
  return (
    <CenteredPage className="max-w-lg">
      <LoadingState className="w-full" />
    </CenteredPage>
  );
}
