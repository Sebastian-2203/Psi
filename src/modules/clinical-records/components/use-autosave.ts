'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave for draft editors (DESIGN_SYSTEM §6.4: indicator `aria-live="polite"`).
 * Saves are serialized (never two in flight: the optimistic-concurrency token of the caller moves
 * on each success). `flush()` saves pending changes now and resolves true when nothing is left
 * unsaved; use it before finalizing. Values are compared by identity: pass a new object per edit.
 */
export function useAutosave<T>({
  value,
  save,
  enabled = true,
  delayMs = 1500,
}: {
  value: T;
  save: (value: T) => Promise<ActionResult<unknown>>;
  enabled?: boolean;
  delayMs?: number;
}) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<ActionError | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const latest = useRef(value);
  const lastSaved = useRef(value);
  const inflight = useRef<Promise<boolean> | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
    latest.current = value;
  });

  const flush = useCallback(async (): Promise<boolean> => {
    while (inflight.current) await inflight.current;
    if (Object.is(latest.current, lastSaved.current)) return true;
    const snapshot = latest.current;
    setStatus('saving');
    const attempt = saveRef.current(snapshot).then(
      (result) => {
        if (result.ok) {
          lastSaved.current = snapshot;
          setError(null);
          setSavedAt(new Date());
          setStatus(Object.is(latest.current, snapshot) ? 'saved' : 'dirty');
          return true;
        }
        setError(result.error);
        setStatus('error');
        return false;
      },
      () => {
        setStatus('error');
        return false;
      },
    );
    inflight.current = attempt;
    const ok = await attempt;
    inflight.current = null;
    return ok;
  }, []);

  useEffect(() => {
    if (!enabled || Object.is(value, lastSaved.current)) return;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [value, enabled, delayMs, flush]);

  return { status, error, savedAt, flush };
}
