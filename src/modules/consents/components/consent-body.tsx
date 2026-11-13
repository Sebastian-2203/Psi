import { Fragment, type ReactNode } from 'react';
import { consentBodySchema } from '@/modules/consents/schemas';

type Inline = { text: string; bold?: boolean; italic?: boolean };

function renderInlines(inlines: Inline[]): ReactNode {
  return inlines.map((run, i) => {
    let node: ReactNode = run.text;
    if (run.bold) node = <strong>{node}</strong>;
    if (run.italic) node = <em>{node}</em>;
    return <Fragment key={i}>{node}</Fragment>;
  });
}

/**
 * Renders the restricted consent AST as React elements. NEVER as HTML: text is a React child
 * (escaped); there are no links, images or scripts in the schema (non-negotiable rule 8). Bodies
 * that do not validate render nothing visible except a safe fallback.
 */
export function ConsentBodyView({
  body,
  fallback,
  className,
}: {
  body: unknown;
  fallback: string;
  className?: string;
}) {
  const parsed = consentBodySchema.safeParse(body);
  if (!parsed.success) return <p className="text-muted-foreground">{fallback}</p>;
  return (
    <div className={className ?? 'flex max-w-[72ch] flex-col gap-3'} data-testid="consent-body">
      {parsed.data.blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level + 1}` as 'h2' | 'h3' | 'h4';
            return (
              <Tag key={i} className="font-bold">
                {renderInlines(block.children)}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={i}>{renderInlines(block.children)}</p>;
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
