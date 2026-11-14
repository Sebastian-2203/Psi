import { z } from 'zod';
import { optionalText, uuidField } from '@/lib/validation';

/**
 * Data-subject request schemas (PAT-09, Q-14; API_CONTRACTS §8). `.strict()`; messages are keys of
 * `validation.*`. Only access and rectification are exposed. Legal deadlines are NOT modelled
 * here: `dueDate` is whatever the organization sets. [NEEDS LEGAL VERIFICATION]
 */

export const DSR_TYPES = ['access', 'rectification'] as const;
export const DSR_STATUSES = [
  'received',
  'in_review',
  'fulfilled',
  'partially_fulfilled',
  'rejected',
] as const;
export const DSR_FINAL_STATUSES = ['fulfilled', 'partially_fulfilled', 'rejected'] as const;

export const submitDataRequestSchema = z
  .object({
    requestType: z.enum(DSR_TYPES, 'choiceInvalid'),
    note: optionalText(1000),
  })
  .strict();
export type SubmitDataRequestInput = z.input<typeof submitDataRequestSchema>;

export const updateDataRequestSchema = z
  .object({
    requestId: uuidField,
    status: z.enum(DSR_STATUSES, 'choiceInvalid'),
    resolutionSummary: optionalText(2000, 3),
    /** `YYYY-MM-DD`, end of that day (UTC) is stored. Optional. */
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateInvalid')
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'dateInvalid')
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      !(DSR_FINAL_STATUSES as readonly string[]).includes(v.status) ||
      v.resolutionSummary !== undefined,
    { path: ['resolutionSummary'], message: 'fieldRequired' },
  );
export type UpdateDataRequestInput = z.input<typeof updateDataRequestSchema>;
