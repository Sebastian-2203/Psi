import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Plain form posting to the sign-out server action (works without JavaScript). */
export function SignOutButton({
  action,
  label,
  variant = 'outline',
}: {
  action: () => Promise<void>;
  label: string;
  variant?: 'outline' | 'ghost' | 'link';
}) {
  return (
    <form action={action}>
      <Button type="submit" variant={variant}>
        <LogOut aria-hidden />
        {label}
      </Button>
    </form>
  );
}
