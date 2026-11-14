import { z } from 'zod';

/**
 * Restricted rich-text AST for clinical / therapeutic free text (DATABASE.md §1 rule 6,
 * non-negotiable rule 8): paragraphs, headings and lists of plain text runs with bold/italic.
 * No HTML, links, images or scripts. Stored as one jsonb per field (ADR-015); the DB checks
 * `jsonb_typeof = 'object'` and non-empty `blocks` where content is required (finalize).
 * Clinical text is never auto-translated; `content_locale` records the authoring language.
 */
const inline = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1).max(5000),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
  })
  .strict();
const inlines = z.array(inline).min(1).max(200);

const block = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('heading'),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      children: inlines,
    })
    .strict(),
  z.object({ type: z.literal('paragraph'), children: inlines }).strict(),
  z
    .object({
      type: z.literal('list'),
      ordered: z.boolean(),
      items: z.array(inlines).min(1).max(100),
    })
    .strict(),
]);

const MAX_JSON = 150_000;

/** Draft content: may be empty (autosave of a blank draft). */
export const richTextDraftSchema = z
  .object({ version: z.literal(1), blocks: z.array(block).max(500) })
  .strict()
  .refine((body) => JSON.stringify(body).length <= MAX_JSON, 'fieldTooLong');

/** Content that must say something (finalized entries, addenda, closure summary, goals). */
export const richTextSchema = z
  .object({ version: z.literal(1), blocks: z.array(block).min(1, 'fieldRequired').max(500) })
  .strict()
  .refine((body) => JSON.stringify(body).length <= MAX_JSON, 'fieldTooLong');

export type RichText = z.output<typeof richTextDraftSchema>;
