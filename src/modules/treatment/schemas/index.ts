import { z } from 'zod';
import { richTextDraftSchema, richTextSchema } from '@/lib/rich-text';
import { isoDateField, optionalText, uuidField } from '@/lib/validation';

/**
 * Treatment plans (API_CONTRACTS §8.7, TPL-01..03). Everything is written by the psychologist;
 * the system never suggests goals or interventions. Patient-facing goal wording is a separate
 * field (and table) — the clinical description never reaches the portal.
 */

export const GOAL_STATUSES = ['open', 'in_progress', 'achieved', 'discontinued'] as const;

const goalInput = z
  .object({
    description: richTextSchema,
    targetDate: isoDateField.optional(),
    patientFacingText: richTextSchema.optional(),
  })
  .strict();

export const createTreatmentPlanDraftSchema = z
  .object({
    recordId: uuidField,
    summary: richTextDraftSchema,
    interventions: richTextDraftSchema.optional(),
    frequency: optionalText(200),
    startDate: isoDateField,
    reviewDate: isoDateField.optional(),
    goals: z.array(goalInput).max(50).default([]),
  })
  .strict()
  .refine((v) => !v.reviewDate || v.reviewDate >= v.startDate, {
    message: 'dateInvalid',
    path: ['reviewDate'],
  });
export type CreateTreatmentPlanDraftInput = z.input<typeof createTreatmentPlanDraftSchema>;

export const updateTreatmentPlanDraftSchema = z
  .object({
    planId: uuidField,
    summary: richTextDraftSchema.optional(),
    interventions: richTextDraftSchema.nullable().optional(),
    frequency: z.string().trim().max(200, 'fieldTooLong').nullable().optional(),
    startDate: isoDateField.optional(),
    reviewDate: isoDateField.nullable().optional(),
  })
  .strict();
export type UpdateTreatmentPlanDraftInput = z.input<typeof updateTreatmentPlanDraftSchema>;

export const planIdSchema = z.object({ planId: uuidField }).strict();
export type PlanIdInput = z.input<typeof planIdSchema>;

export const endTreatmentPlanSchema = z
  .object({ planId: uuidField, status: z.enum(['completed', 'discontinued'], 'choiceInvalid') })
  .strict();
export type EndTreatmentPlanInput = z.input<typeof endTreatmentPlanSchema>;

export const addGoalSchema = z
  .object({
    planId: uuidField,
    position: z.number().int().min(0).max(99).default(0),
    description: richTextSchema,
    targetDate: isoDateField.optional(),
  })
  .strict();
export type AddGoalInput = z.input<typeof addGoalSchema>;

export const updateGoalStatusSchema = z
  .object({ goalId: uuidField, status: z.enum(GOAL_STATUSES, 'choiceInvalid') })
  .strict();
export type UpdateGoalStatusInput = z.input<typeof updateGoalStatusSchema>;

/** Draft plans only; `null` removes the patient-facing wording. */
export const setPatientFacingGoalTextSchema = z
  .object({ goalId: uuidField, patientFacingText: richTextSchema.nullable() })
  .strict();
export type SetPatientFacingGoalTextInput = z.input<typeof setPatientFacingGoalTextSchema>;

export const goalIdSchema = z.object({ goalId: uuidField }).strict();
export type GoalIdInput = z.input<typeof goalIdSchema>;

export const patientIdSchema = z.object({ patientId: uuidField }).strict();
export const portalPatientSchema = z.object({ patientId: uuidField.optional() }).strict();
export type PortalPatientInput = z.input<typeof portalPatientSchema>;
