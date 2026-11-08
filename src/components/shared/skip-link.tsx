import { useTranslations } from 'next-intl';

/** First focusable element; jumps to `#main-content` (DESIGN_SYSTEM §9). */
export function SkipLink() {
  const t = useTranslations('common');
  return (
    <a
      href="#main-content"
      className="sr-only z-[60] rounded-md bg-card px-4 py-3 font-bold text-primary underline shadow-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      {t('skipToContent')}
    </a>
  );
}
