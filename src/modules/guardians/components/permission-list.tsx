import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Plain-language list of what a guardian can see/do (portal, patient-facing wording). Only the
 * granted permissions are listed; anything not listed is NOT available to the guardian.
 */
export function PermissionList({ permissions, label }: { permissions: string[]; label: string }) {
  const t = useTranslations('guardians.permissions.portal');
  const known = permissions.filter((p) => t.has(p as never));
  if (known.length === 0) return <p className="text-muted-foreground">{t('none')}</p>;
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {known.map((p) => (
        <li key={p} className="flex items-start gap-2">
          <Check className="mt-1 size-4 shrink-0 text-success" aria-hidden />
          <span>{t(p as never)}</span>
        </li>
      ))}
    </ul>
  );
}
