'use client';

import { useId, type ChangeEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Hex text input + native colour picker bound to the same value. The text input is the source of
 * truth (typed values are validated on submit); the picker only mirrors a valid hex.
 */
export function ColorField({
  label,
  pickerLabel,
  hint,
  error,
  suggestion,
  onUseSuggestion,
  value,
  onChange,
  onBlur,
  name,
  inputRef,
  optional = false,
  fallbackPicker = '#d94a43',
  children,
}: {
  label: string;
  pickerLabel: string;
  hint?: string;
  error?: ReactNode;
  /** Nearest passing shade offered by the contrast guard. */
  suggestion?: string | null;
  onUseSuggestion?: (hex: string) => void;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  optional?: boolean;
  fallbackPicker?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('branding.fields');
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground"> {t('optional')}</span>
        ) : null}
      </Label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          aria-label={pickerLabel}
          value={HEX6.test(value) ? value.toLowerCase() : fallbackPicker}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value.toLowerCase())}
          className="size-(--control-h) shrink-0 cursor-pointer rounded-md border border-input bg-card p-1"
        />
        <Input
          id={id}
          name={name}
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          placeholder="#RRGGBB"
          className="max-w-40 font-mono"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <div
          id={errorId}
          className="flex flex-col items-start gap-2 text-sm font-semibold text-destructive"
        >
          <p>{error}</p>
          {suggestion && onUseSuggestion ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onUseSuggestion(suggestion)}
            >
              <span
                aria-hidden
                className="inline-block size-4 rounded-sm border"
                style={{ backgroundColor: suggestion }}
              />
              {t('useSuggestion', { color: suggestion })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
