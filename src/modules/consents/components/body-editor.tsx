'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { consentBodySchema } from '@/modules/consents/schemas';

export type Run = { text: string; bold: boolean; italic: boolean };
export type EditorBlock =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] };

export const emptyRun = (): Run => ({ text: '', bold: false, italic: false });

/** Editor state -> body AST (src/modules/consents/schemas). Empty runs are dropped. */
export function toBody(blocks: EditorBlock[]) {
  const clean = (runs: Run[]) =>
    runs
      .filter((r) => r.text.length > 0)
      .map((r) => ({
        type: 'text' as const,
        text: r.text,
        ...(r.bold ? { bold: true } : {}),
        ...(r.italic ? { italic: true } : {}),
      }));
  return {
    version: 1 as const,
    blocks: blocks.map((b) =>
      b.type === 'heading'
        ? { type: 'heading' as const, level: b.level, children: clean(b.runs) }
        : b.type === 'paragraph'
          ? { type: 'paragraph' as const, children: clean(b.runs) }
          : { type: 'list' as const, ordered: b.ordered, items: b.items.map(clean) },
    ),
  };
}

function RunsEditor({
  runs,
  onChange,
  label,
}: {
  runs: Run[];
  onChange: (next: Run[]) => void;
  label: string;
}) {
  const t = useTranslations('consents.editor');
  const set = (i: number, patch: Partial<Run>) =>
    onChange(runs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {runs.map((run, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`${label} ${i + 1}`}
            value={run.text}
            maxLength={2000}
            onChange={(e) => set(i, { text: e.target.value })}
            className="min-w-48 flex-1"
          />
          <label className="flex items-center gap-1.5 text-sm font-bold">
            <Checkbox checked={run.bold} onCheckedChange={(c) => set(i, { bold: c === true })} />
            {t('bold')}
          </label>
          <label className="flex items-center gap-1.5 text-sm italic">
            <Checkbox
              checked={run.italic}
              onCheckedChange={(c) => set(i, { italic: c === true })}
            />
            {t('italic')}
          </label>
          {runs.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('removeSegment')}
              onClick={() => onChange(runs.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="link"
        className="self-start text-sm"
        onClick={() => onChange([...runs, emptyRun()])}
      >
        <Plus aria-hidden />
        {t('addSegment')}
      </Button>
    </div>
  );
}

/**
 * Structured editor for the restricted consent body (heading / paragraph / list; bold + italic
 * text runs). It only produces the schema's AST: there is no HTML, link or script input anywhere.
 */
/** Stored body AST -> editor state (inverse of `toBody`). Unknown shapes yield one empty paragraph. */
export function fromBody(body: unknown): EditorBlock[] {
  const parsed = consentBodySchema.safeParse(body);
  const fallback: EditorBlock[] = [{ type: 'paragraph', runs: [emptyRun()] }];
  if (!parsed.success) return fallback;
  const runs = (
    children: { text: string; bold?: boolean | undefined; italic?: boolean | undefined }[],
  ): Run[] =>
    children.map((c) => ({ text: c.text, bold: c.bold === true, italic: c.italic === true }));
  return parsed.data.blocks.map((b): EditorBlock =>
    b.type === 'heading'
      ? { type: 'heading', level: b.level, runs: runs(b.children) }
      : b.type === 'paragraph'
        ? { type: 'paragraph', runs: runs(b.children) }
        : { type: 'list', ordered: b.ordered, items: b.items.map(runs) },
  );
}

export function BodyEditor({
  blocks,
  onChange,
}: {
  blocks: EditorBlock[];
  onChange: (next: EditorBlock[]) => void;
}) {
  const t = useTranslations('consents.editor');
  const update = (i: number, block: EditorBlock) =>
    onChange(blocks.map((b, j) => (j === i ? block : b)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, i) => (
        <fieldset key={i} className="flex flex-col gap-3 rounded-md border p-4">
          <legend className="px-1 text-sm font-bold">
            {t('block', { n: i + 1 })} · {t(`types.${block.type}`)}
          </legend>
          {block.type === 'heading' ? (
            <div className="flex items-center gap-2">
              <Label htmlFor={`level-${i}`}>{t('level')}</Label>
              <select
                id={`level-${i}`}
                value={block.level}
                onChange={(e) =>
                  update(i, { ...block, level: Number(e.target.value) as 1 | 2 | 3 })
                }
                className="h-(--control-h) rounded-md border border-input bg-card px-3"
              >
                {[1, 2, 3].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {block.type === 'list' ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={block.ordered}
                  onCheckedChange={(c) => update(i, { ...block, ordered: c === true })}
                />
                {t('ordered')}
              </label>
              {block.items.map((item, k) => (
                <div key={k} className="rounded-md bg-muted/40 p-3">
                  <RunsEditor
                    label={t('item', { n: k + 1 })}
                    runs={item}
                    onChange={(runs) =>
                      update(i, {
                        ...block,
                        items: block.items.map((it, m) => (m === k ? runs : it)),
                      })
                    }
                  />
                  {block.items.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update(i, { ...block, items: block.items.filter((_, m) => m !== k) })
                      }
                    >
                      <Trash2 aria-hidden />
                      {t('removeItem')}
                    </Button>
                  ) : null}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => update(i, { ...block, items: [...block.items, [emptyRun()]] })}
              >
                <Plus aria-hidden />
                {t('addItem')}
              </Button>
            </>
          ) : (
            <RunsEditor
              label={t('text')}
              runs={block.runs}
              onChange={(runs) => update(i, { ...block, runs })}
            />
          )}
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => move(i, -1)}
              disabled={i === 0}
            >
              <ArrowUp aria-hidden />
              {t('moveUp')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => move(i, 1)}
              disabled={i === blocks.length - 1}
            >
              <ArrowDown aria-hidden />
              {t('moveDown')}
            </Button>
            {blocks.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(blocks.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
                {t('removeBlock')}
              </Button>
            ) : null}
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...blocks, { type: 'heading', level: 2, runs: [emptyRun()] }])}
        >
          <Plus aria-hidden />
          {t('addHeading')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...blocks, { type: 'paragraph', runs: [emptyRun()] }])}
        >
          <Plus aria-hidden />
          {t('addParagraph')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange([...blocks, { type: 'list', ordered: false, items: [[emptyRun()]] }])
          }
        >
          <Plus aria-hidden />
          {t('addList')}
        </Button>
      </div>
    </div>
  );
}
