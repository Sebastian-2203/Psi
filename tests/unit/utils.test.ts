import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false, undefined, 'b')).toBe('a b');
  });

  it('resolves conflicting Tailwind classes, last wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
