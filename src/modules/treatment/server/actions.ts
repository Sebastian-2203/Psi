'use server';

import {
  addGoalSchema,
  createTreatmentPlanDraftSchema,
  endTreatmentPlanSchema,
  goalIdSchema,
  patientIdSchema,
  planIdSchema,
  portalPatientSchema,
  setPatientFacingGoalTextSchema,
  updateGoalStatusSchema,
  updateTreatmentPlanDraftSchema,
  type AddGoalInput,
  type CreateTreatmentPlanDraftInput,
  type EndTreatmentPlanInput,
  type GoalIdInput,
  type PlanIdInput,
  type PortalPatientInput,
  type SetPatientFacingGoalTextInput,
  type UpdateGoalStatusInput,
  type UpdateTreatmentPlanDraftInput,
} from '@/modules/treatment/schemas';
import { runAction } from '@/server/actions/run';
import {
  activateTreatmentPlan,
  addGoal,
  createTreatmentPlanDraft,
  endTreatmentPlan,
  getTreatmentPlan,
  listMyGoals,
  listTreatmentPlans,
  reviseTreatmentPlan,
  setPatientFacingGoalText,
  updateGoalStatus,
  updateTreatmentPlanDraft,
  withdrawPatientFacingGoalText,
} from './service';

/** Treatment plan actions (API_CONTRACTS §8.7). */

export async function createTreatmentPlanDraftAction(input: CreateTreatmentPlanDraftInput) {
  return runAction(createTreatmentPlanDraftSchema, input, (ctx, d) =>
    createTreatmentPlanDraft(ctx, d),
  );
}
export async function updateTreatmentPlanDraftAction(input: UpdateTreatmentPlanDraftInput) {
  return runAction(updateTreatmentPlanDraftSchema, input, (ctx, d) =>
    updateTreatmentPlanDraft(ctx, d),
  );
}
export async function addGoalAction(input: AddGoalInput) {
  return runAction(addGoalSchema, input, (ctx, d) => addGoal(ctx, d));
}
export async function activateTreatmentPlanAction(input: PlanIdInput) {
  return runAction(planIdSchema, input, (ctx, d) => activateTreatmentPlan(ctx, d));
}
export async function reviseTreatmentPlanAction(input: PlanIdInput) {
  return runAction(planIdSchema, input, (ctx, d) => reviseTreatmentPlan(ctx, d));
}
export async function endTreatmentPlanAction(input: EndTreatmentPlanInput) {
  return runAction(endTreatmentPlanSchema, input, (ctx, d) => endTreatmentPlan(ctx, d));
}
export async function updateGoalStatusAction(input: UpdateGoalStatusInput) {
  return runAction(updateGoalStatusSchema, input, (ctx, d) => updateGoalStatus(ctx, d));
}
export async function setPatientFacingGoalTextAction(input: SetPatientFacingGoalTextInput) {
  return runAction(setPatientFacingGoalTextSchema, input, (ctx, d) =>
    setPatientFacingGoalText(ctx, d),
  );
}
export async function withdrawPatientFacingGoalTextAction(input: GoalIdInput) {
  return runAction(goalIdSchema, input, (ctx, d) => withdrawPatientFacingGoalText(ctx, d));
}
export async function getTreatmentPlanAction(input: PlanIdInput) {
  return runAction(planIdSchema, input, (ctx, d) => getTreatmentPlan(ctx, d.planId));
}
export async function listTreatmentPlansAction(input: { patientId: string }) {
  return runAction(patientIdSchema, input, (ctx, d) => listTreatmentPlans(ctx, d.patientId));
}
export async function listMyGoalsAction(input: PortalPatientInput) {
  return runAction(portalPatientSchema, input, (ctx, d) => listMyGoals(ctx, d.patientId));
}
