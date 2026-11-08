'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DesignContext = 'professional' | 'portal-adult' | 'portal-child' | 'platform';

const PortalContainerContext = createContext<HTMLElement | null>(null);

/** Container for Radix portals so dialogs/menus inherit the active design context's tokens. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}

/**
 * Applies `data-context` (DESIGN_SYSTEM §2) and makes overlays render inside it, so a dialog opened
 * from the child portal keeps child tokens (radius, primary, targets).
 */
export function ContextScope({
  context,
  className,
  children,
}: {
  context: DesignContext;
  className?: string;
  children: ReactNode;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  return (
    <div
      ref={setElement}
      data-context={context}
      className={cn('min-h-dvh bg-background text-foreground', className)}
    >
      <PortalContainerContext.Provider value={element}>{children}</PortalContainerContext.Provider>
    </div>
  );
}
