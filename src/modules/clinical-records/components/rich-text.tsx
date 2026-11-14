import { Fragment, type ReactNode } from 'react';
import type { RichText } from './types';

type Run = RichText['blocks'][number] extends infer B
  ? B extends { children: infer C }
    ? C extends (infer R)[]
      ? R
      : never
    : never
  : never;

const MAX_RUN = 5000;

function runs(text: string): Run[] {
  const out: Run[] = [];
  // **bold** and _italic_ (at word boundaries). Anything else is literal text.
  const pattern = /\*\*([^*]+)\*\*|(?<![\w])_([^_]+)_(?![\w])/g;
  let last = 0;
  const push = (value: string, style: { bold?: true; italic?: true } = {}) => {
    for (let i = 0; i < value.length; i += MAX_RUN) {
      out.push({ type: 'text', text: value.slice(i, i + MAX_RUN), ...style });
    }
  };
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) push(text.slice(last, match.index));
    if (match[1]) push(match[1], { bold: true });
    else if (match[2]) push(match[2], { italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) push(text.slice(last));
  return out;
}

/**
 * Plain-text editing format -> restricted rich-text AST. Blank lines separate blocks; `#`..`###`
 * headings; `- ` bullets; `1. ` numbered items; `**bold**`, `_italic_`. No HTML, links or images
 * can be expressed (non-negotiable rule 8). Empty input gives an empty (draft) document.
 */
export function textToRichText(text: string): RichText {
  const blocks: RichText['blocks'] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const lines = chunk.split('\n').map((l) => l.trim());
    const heading = /^(#{1,3})\s+(.+)$/.exec(lines[0] ?? '');
    if (lines.length === 1 && heading) {
      blocks.push({
        type: 'heading',
        level: (heading[1] as string).length as 1 | 2 | 3,
        children: runs(heading[2] as string),
      });
    } else if (lines.every((l) => /^[-*]\s+\S/.test(l))) {
      blocks.push({
        type: 'list',
        ordered: false,
        items: lines.map((l) => runs(l.replace(/^[-*]\s+/, ''))),
      });
    } else if (lines.every((l) => /^\d+[.)]\s+\S/.test(l))) {
      blocks.push({
        type: 'list',
        ordered: true,
        items: lines.map((l) => runs(l.replace(/^\d+[.)]\s+/, ''))),
      });
    } else {
      blocks.push({ type: 'paragraph', children: runs(lines.join('\n')) });
    }
  }
  return { version: 1, blocks };
}

const inlineText = (children: Run[]) =>
  children.map((r) => (r.bold ? `**${r.text}**` : r.italic ? `_${r.text}_` : r.text)).join('');

/** Inverse of `textToRichText` (used to fill the editor from stored content). */
export function richTextToText(body: RichText | null | undefined): string {
  if (!body) return '';
  return body.blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `${'#'.repeat(b.level)} ${inlineText(b.children)}`;
        case 'paragraph':
          return inlineText(b.children);
        case 'list':
          return b.items
            .map((item, i) => `${b.ordered ? `${i + 1}.` : '-'} ${inlineText(item)}`)
            .join('\n');
      }
    })
    .join('\n\n');
}

export const isRichTextEmpty = (body: RichText | null | undefined) =>
  !body || body.blocks.length === 0;

function renderInlines(children: Run[]): ReactNode {
  return children.map((run, i) => {
    let node: ReactNode = run.text;
    if (run.bold) node = <strong>{node}</strong>;
    if (run.italic) node = <em>{node}</em>;
    return <Fragment key={i}>{node}</Fragment>;
  });
}

/**
 * Renders the restricted rich-text AST as React elements (escaped text; never HTML). `note`
 * typography at 72ch (DESIGN_SYSTEM §3 / §8): the reading area for clinical text.
 */
export function RichTextView({
  body,
  className,
  testId,
}: {
  body: RichText;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={className ?? 'flex max-w-[72ch] flex-col gap-3 text-note'} data-testid={testId}>
      {body.blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level + 3 > 6 ? 6 : block.level + 3}` as 'h4' | 'h5' | 'h6';
            return (
              <Tag key={i} className="font-bold">
                {renderInlines(block.children)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={i} className="whitespace-pre-line">
                {renderInlines(block.children)}
              </p>
            );
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} className={block.ordered ? 'list-decimal pl-6' : 'list-disc pl-6'}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInlines(item)}</li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
