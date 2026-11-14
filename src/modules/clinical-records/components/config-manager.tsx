'use client';

import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CheckField,
  FormError,
  FormField,
  SelectField,
  TextAreaField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import { useServerFieldError } from './field-error';
import type { Action, NoteTypeDto, SectionDefinitionDto } from './types';

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
const AUDIENCES = ['any', 'adult', 'minor'] as const;

export type ConfigActions = {
  upsertSection: Action<
    {
      id?: string;
      key: string;
      title: string;
      description?: string;
      audience: SectionDefinitionDto['audience'];
      isRequired: boolean;
      position: number;
      isActive: boolean;
    },
    { id: string }
  >;
  upsertNoteType: Action<
    {
      id?: string;
      key: string;
      label: string;
      description?: string;
      position: number;
      isActive: boolean;
    },
    { id: string }
  >;
};

type Kind = 'section' | 'noteType';
type Editing = { kind: Kind; item: SectionDefinitionDto | NoteTypeDto | null };

function ConfigDialog({
  editing,
  actions,
  nextPosition,
  onClose,
}: {
  editing: Editing;
  actions: ConfigActions;
  nextPosition: number;
  onClose: () => void;
}) {
  const t = useTranslations('clinical.config');
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const router = useRouter();
  const { kind, item } = editing;
  const section = kind === 'section' ? (item as SectionDefinitionDto | null) : null;
  const noteType = kind === 'noteType' ? (item as NoteTypeDto | null) : null;
  const [key, setKey] = useState(item?.key ?? '');
  const [title, setTitle] = useState(section?.title ?? noteType?.label ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [audience, setAudience] = useState<SectionDefinitionDto['audience']>(
    section?.audience ?? 'any',
  );
  const [required, setRequired] = useState(section?.isRequired ?? false);
  const [position, setPosition] = useState(String(item?.position ?? nextPosition));
  const [active, setActive] = useState(item?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const serverError = useServerFieldError(error);

  async function submit() {
    const next: Record<string, string | undefined> = {};
    if (!KEY_PATTERN.test(key)) next.key = v('choiceInvalid');
    if (title.trim() === '') next.title = v('fieldRequired');
    const pos = Number(position);
    if (!Number.isInteger(pos) || pos < 0 || pos > 999) next.position = v('choiceInvalid');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setError(null);
    setBusy(true);
    const common = {
      ...(item ? { id: item.id } : {}),
      key,
      ...(description.trim() ? { description: description.trim() } : {}),
      position: pos,
      isActive: active,
    };
    const result =
      kind === 'section'
        ? await actions.upsertSection({
            ...common,
            title: title.trim(),
            audience,
            isRequired: required,
          })
        : await actions.upsertNoteType({ ...common, label: title.trim() });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              kind === 'section'
                ? item
                  ? 'sectionEdit'
                  : 'sectionAdd'
                : item
                  ? 'typeEdit'
                  : 'typeAdd',
            )}
          </DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <FormField
          label={t('key')}
          hint={t('keyHint')}
          value={key}
          disabled={item !== null}
          maxLength={48}
          onChange={(e) => setKey(e.target.value)}
          error={errors.key ?? serverError('key')}
        />
        <FormField
          label={kind === 'section' ? t('sectionTitle') : t('typeLabel')}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title ?? serverError('title') ?? serverError('label')}
        />
        <TextAreaField
          label={t('description')}
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
        {kind === 'section' ? (
          <>
            <SelectField
              label={t('audience')}
              value={audience}
              onChange={(e) => setAudience(e.target.value as SectionDefinitionDto['audience'])}
            >
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {t(`audiences.${a}`)}
                </option>
              ))}
            </SelectField>
            <CheckField label={t('required')} checked={required} onCheckedChange={setRequired} />
          </>
        ) : null}
        <FormField
          label={t('position')}
          type="number"
          min={0}
          max={999}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          error={errors.position}
        />
        <CheckField
          label={t('active')}
          hint={t('activeHint')}
          checked={active}
          onCheckedChange={setActive}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Settings -> clinical configuration (owner): the section catalogue of the clinical record and
 * the note types. The content is the practice's own [NEEDS PSYCHOLOGIST INPUT]; nothing here is
 * clinical advice. Deactivating hides an entry from new use without deleting history.
 */
export function ConfigManager({
  sections,
  noteTypes,
  actions,
}: {
  sections: SectionDefinitionDto[];
  noteTypes: NoteTypeDto[];
  actions: ConfigActions;
}) {
  const t = useTranslations('clinical.config');
  const [editing, setEditing] = useState<Editing | null>(null);

  const list = (kind: Kind, items: (SectionDefinitionDto | NoteTypeDto)[], title: string) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {t(kind === 'section' ? 'sectionsDescription' : 'typesDescription')}
        </CardDescription>
      </CardHeader>
      <ul className="flex flex-col divide-y" data-testid={`config-${kind}`}>
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">
                {kind === 'section'
                  ? (it as SectionDefinitionDto).title
                  : (it as NoteTypeDto).label}
              </span>
              <span className="text-sm text-muted-foreground">{it.key}</span>
            </div>
            {kind === 'section' ? (
              <Badge variant="neutral">
                {t(`audiences.${(it as SectionDefinitionDto).audience}`)}
              </Badge>
            ) : null}
            {kind === 'section' && (it as SectionDefinitionDto).isRequired ? (
              <Badge variant="brand">{t('requiredBadge')}</Badge>
            ) : null}
            {!it.isActive ? <Badge variant="outline">{t('inactiveBadge')}</Badge> : null}
            <Button variant="outline" size="sm" onClick={() => setEditing({ kind, item: it })}>
              <Pencil aria-hidden />
              {t('edit')}
            </Button>
          </li>
        ))}
      </ul>
      <Button
        className="self-start"
        variant="outline"
        onClick={() => setEditing({ kind, item: null })}
      >
        <Plus aria-hidden />
        {t(kind === 'section' ? 'sectionAdd' : 'typeAdd')}
      </Button>
    </Card>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {list('section', sections, t('sectionsTitle'))}
      {list('noteType', noteTypes, t('typesTitle'))}
      {editing ? (
        <ConfigDialog
          key={`${editing.kind}-${editing.item?.id ?? 'new'}`}
          editing={editing}
          actions={actions}
          nextPosition={
            ((editing.kind === 'section' ? sections : noteTypes).reduce(
              (m, i) => Math.max(m, i.position),
              0,
            ) || 0) + 10
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
