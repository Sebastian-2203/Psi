'use client';

import { useTranslations } from 'next-intl';
import { useState, type ComponentProps } from 'react';
import { TextAreaField } from '@/components/shared/form-kit';
import { richTextToText, textToRichText } from './rich-text';
import type { RichText } from './types';

/**
 * Controlled rich-text input backed by the restricted AST. The textarea holds the plain editing
 * format (see `textToRichText`); every change reports the parsed AST. Remount (`key`) to reset.
 */
export function RichTextField({
  label,
  value,
  onChange,
  error,
  hint,
  showFormatHint = true,
  rows = 8,
  ...rest
}: Omit<ComponentProps<typeof TextAreaField>, 'value' | 'onChange' | 'hint'> & {
  value: RichText | null | undefined;
  onChange: (next: RichText) => void;
  hint?: string;
  showFormatHint?: boolean;
}) {
  const t = useTranslations('clinical.editor');
  const [text, setText] = useState(() => richTextToText(value));
  return (
    <TextAreaField
      label={label}
      hint={hint ?? (showFormatHint ? t('formatHint') : undefined)}
      error={error}
      rows={rows}
      className="min-h-32 w-full max-w-[72ch] rounded-md border border-input bg-card px-3 py-2 text-note"
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(textToRichText(e.target.value));
      }}
    />
  );
}
