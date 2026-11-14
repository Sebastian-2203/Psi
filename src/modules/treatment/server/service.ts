import 'server-only';
import type { z } from 'zod';
import type { RichText } from '@/lib/rich-text';
import {
  auditTarget,
  iso,
  notFound,
  runClinical,
  runPortal,
} from '@/modules/clinical-records/server/shared';
import type {
  addGoalSchema,
  createTreatmentPlanDraftSchema,
  endTreatmentPlanSchema,
  setPatientFacingGoalTextSchema,
  updateGoalStatusSchema,
  updateTreatmentPlanDraftSchema,
} from '@/modules/treatment/schemas';
import { recordAudit } from '@/server/audit';
import type { AuthzContext } from '@/server/authz';
import type { UserTransaction } from '@/server/db/server';
import type { Outcome } from '@/server/errors';

/**
 * Treatment plans (API_CONTRACTS §8.7). Lifecycle is DB-enforced (guard triggers):
 * draft (editable) -> active (content frozen; goal status only; previous active superseded)
 * -> completed | superseded | discontinued (frozen). Revisions = new draft version.
 */

type Out<S extends z.ZodType> = z.output<S>;
type PlanStatus = 'draft' | 'active' | 'completed' | 'superseded' | 'discontinued';
type GoalStatus = Out<typeof updateGoalStatusSchema>['status'];

export type GoalDto = {
  id: string;
  position: number;
  description: RichText;
  status: GoalStatus;
  targetDate: string | null;
  achievedAt: string | null;
  patientFacingText: RichText | null;
  patientFacingWithdrawnAt: string | null;
};
export type PlanDto = {
  id: string;
  patientId: string;
  recordId: string;
  version: number;
  status: PlanStatus;
  supersedesPlanId: string | null;
  summary: RichText;
  interventions: RichText | null;
  frequency: string | null;
  startDate: string;
  reviewDate: string | null;
  authorMembershipId: string;
  activatedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  goals: GoalDto[];
};
export type PlanSummaryDto = Omit<PlanDto, 'goals' | 'summary' | 'interventions'> & {
  goalCount: number;
};

async function planPatient(tx: UserTransaction, org: string, planId: string) {
  const [p] = await tx<{ patient_id: string; status: PlanStatus }[]>`
    select patient_id, status from public.treatment_plans where organization_id = ${org} and id = ${planId}`;
  return p ?? notFound();
}

export async function createTreatmentPlanDraft(
  ctx: AuthzContext,
  input: Out<typeof createTreatmentPlanDraftSchema>,
): Promise<Outcome<{ planId: string; version: number }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const [record] = await tx<{ patient_id: string }[]>`
      select patient_id from public.clinical_records where organization_id = ${org} and id = ${input.recordId}`;
    if (!record) return notFound();
    const [plan] = await tx<{ id: string; version: number }[]>`
      insert into public.treatment_plans (organization_id, clinical_record_id, patient_id, version, summary,
        interventions, frequency, start_date, review_date, author_membership_id)
      values (${org}, ${input.recordId}, ${record.patient_id}, 1, ${tx.json(input.summary as never)},
        ${input.interventions ? tx.json(input.interventions as never) : null}, ${input.frequency ?? null},
        ${input.startDate}::date, ${input.reviewDate ?? null}::date, app.my_membership_id(${org}::uuid))
      returning id, version`;
    if (!plan) return notFound();
    for (const [index, goal] of input.goals.entries()) {
      const [g] = await tx<{ id: string }[]>`
        insert into public.treatment_goals (organization_id, treatment_plan_id, patient_id, position, description, target_date)
        values (${org}, ${plan.id}, ${record.patient_id}, ${index}, ${tx.json(goal.description as never)},
          ${goal.targetDate ?? null}::date)
        returning id`;
      if (g && goal.patientFacingText) {
        await tx`
          insert into public.treatment_goal_patient_texts (organization_id, treatment_goal_id, patient_id,
            patient_facing_text, author_membership_id)
          values (${org}, ${g.id}, ${record.patient_id}, ${tx.json(goal.patientFacingText as never)},
            app.my_membership_id(${org}::uuid))`;
      }
    }
    await recordAudit(
      tx,
      'treatment_plan.created',
      { patient_id: record.patient_id, goal_count: input.goals.length },
      auditTarget(ctx, 'treatment_plan', plan.id),
    );
    return { planId: plan.id, version: plan.version };
  });
}

const PLAN_COLUMNS = {
  summary: 'summary',
  interventions: 'interventions',
  frequency: 'frequency',
  startDate: 'start_date',
  reviewDate: 'review_date',
} as const;

export async function updateTreatmentPlanDraft(
  ctx: AuthzContext,
  input: Out<typeof updateTreatmentPlanDraftSchema>,
): Promise<Outcome<{ planId: string }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const plan = await planPatient(tx, org, input.planId);
    const values: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(PLAN_COLUMNS)) {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values[column] =
        value !== null && (column === 'summary' || column === 'interventions')
          ? tx.json(value as never)
          : value;
    }
    const changed = Object.keys(values);
    if (changed.length > 0) {
      await tx`update public.treatment_plans set ${tx(values as Record<string, never>, ...changed)}
               where organization_id = ${org} and id = ${input.planId}`;
      await recordAudit(
        tx,
        'treatment_plan.updated',
        { patient_id: plan.patient_id, changed_fields: changed },
        auditTarget(ctx, 'treatment_plan', input.planId),
      );
    }
    return { planId: input.planId };
  });
}

export async function addGoal(
  ctx: AuthzContext,
  input: Out<typeof addGoalSchema>,
): Promise<Outcome<{ goalId: string }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const plan = await planPatient(tx, org, input.planId);
    const [g] = await tx<{ id: string }[]>`
      insert into public.treatment_goals (organization_id, treatment_plan_id, patient_id, position, description, target_date)
      values (${org}, ${input.planId}, ${plan.patient_id}, ${input.position}, ${tx.json(input.description as never)},
        ${input.targetDate ?? null}::date)
      returning id`;
    if (!g) return notFound();
    await recordAudit(
      tx,
      'treatment_goal.added',
      { patient_id: plan.patient_id, plan_id: input.planId },
      auditTarget(ctx, 'treatment_goal', g.id),
    );
    return { goalId: g.id };
  });
}

/** TPL-02: activation supersedes the current active plan in the same statement (trigger). */
export async function activateTreatmentPlan(
  ctx: AuthzContext,
  input: { planId: string },
): Promise<Outcome<{ planId: string; activatedAt: string }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const plan = await planPatient(tx, org, input.planId);
    const [row] = await tx<{ activated_at: Date }[]>`
      update public.treatment_plans set status = 'active'
      where organization_id = ${org} and id = ${input.planId} returning activated_at`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'treatment_plan.activated',
      { patient_id: plan.patient_id },
      auditTarget(ctx, 'treatment_plan', input.planId),
    );
    return { planId: input.planId, activatedAt: iso(row.activated_at) as string };
  });
}

/** New draft version copying summary, goals and patient texts (audited by the DB function). */
export async function reviseTreatmentPlan(
  ctx: AuthzContext,
  input: { planId: string },
): Promise<Outcome<{ planId: string }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const [row] = await tx<{ id: string }[]>`
      select app.revise_treatment_plan(${org}::uuid, ${input.planId}::uuid, ${ctx.requestId}) as id`;
    if (!row?.id) return notFound();
    return { planId: row.id };
  });
}

export async function endTreatmentPlan(
  ctx: AuthzContext,
  input: Out<typeof endTreatmentPlanSchema>,
): Promise<Outcome<{ planId: string; status: PlanStatus }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const plan = await planPatient(tx, org, input.planId);
    await tx`update public.treatment_plans set status = ${input.status}::public.plan_status
             where organization_id = ${org} and id = ${input.planId}`;
    await recordAudit(
      tx,
      'treatment_plan.status_changed',
      { patient_id: plan.patient_id, from_status: plan.status, to_status: input.status },
      auditTarget(ctx, 'treatment_plan', input.planId),
    );
    return { planId: input.planId, status: input.status };
  });
}

export async function updateGoalStatus(
  ctx: AuthzContext,
  input: Out<typeof updateGoalStatusSchema>,
): Promise<Outcome<{ goalId: string; status: GoalStatus; achievedAt: string | null }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const [current] = await tx<{ patient_id: string; status: GoalStatus }[]>`
      select patient_id, status from public.treatment_goals where organization_id = ${org} and id = ${input.goalId}`;
    if (!current) return notFound();
    const [row] = await tx<{ achieved_at: Date | null }[]>`
      update public.treatment_goals set status = ${input.status}::public.goal_status
      where organization_id = ${org} and id = ${input.goalId} returning achieved_at`;
    if (!row) return notFound();
    if (current.status !== input.status) {
      await recordAudit(
        tx,
        'treatment_goal.status_changed',
        { patient_id: current.patient_id, from_status: current.status, to_status: input.status },
        auditTarget(ctx, 'treatment_goal', input.goalId),
      );
    }
    return { goalId: input.goalId, status: input.status, achievedAt: iso(row.achieved_at) };
  });
}

/** TPL-03: set / clear (draft plan) the wording the patient sees. */
export async function setPatientFacingGoalText(
  ctx: AuthzContext,
  input: Out<typeof setPatientFacingGoalTextSchema>,
): Promise<Outcome<{ goalId: string }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const [goal] = await tx<{ patient_id: string }[]>`
      select patient_id from public.treatment_goals where organization_id = ${org} and id = ${input.goalId}`;
    if (!goal) return notFound();
    if (input.patientFacingText === null) {
      await tx`delete from public.treatment_goal_patient_texts
               where organization_id = ${org} and treatment_goal_id = ${input.goalId}`;
    } else {
      await tx`
        insert into public.treatment_goal_patient_texts (organization_id, treatment_goal_id, patient_id,
          patient_facing_text, author_membership_id)
        values (${org}, ${input.goalId}, ${goal.patient_id}, ${tx.json(input.patientFacingText as never)},
          app.my_membership_id(${org}::uuid))
        on conflict (treatment_goal_id) do update set patient_facing_text = excluded.patient_facing_text`;
    }
    await recordAudit(
      tx,
      'treatment_goal.patient_text_set',
      { patient_id: goal.patient_id, action: input.patientFacingText === null ? 'cleared' : 'set' },
      auditTarget(ctx, 'treatment_goal', input.goalId),
    );
    return { goalId: input.goalId };
  });
}

/** Active plan: hide a patient-facing text from the portal (one-time, irreversible). */
export async function withdrawPatientFacingGoalText(
  ctx: AuthzContext,
  input: { goalId: string },
): Promise<Outcome<{ goalId: string }>> {
  return runClinical(ctx, 'clinical.plan.write', async (tx, org) => {
    const [row] = await tx<{ patient_id: string }[]>`
      update public.treatment_goal_patient_texts set withdrawn_at = now()
      where organization_id = ${org} and treatment_goal_id = ${input.goalId} and withdrawn_at is null
      returning patient_id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'treatment_goal.patient_text_set',
      { patient_id: row.patient_id, action: 'withdrawn' },
      auditTarget(ctx, 'treatment_goal', input.goalId),
    );
    return { goalId: input.goalId };
  });
}

type PlanRow = {
  id: string;
  patient_id: string;
  clinical_record_id: string;
  version: number;
  status: PlanStatus;
  supersedes_plan_id: string | null;
  summary: RichText;
  interventions: RichText | null;
  frequency: string | null;
  start_date: string;
  review_date: string | null;
  author_membership_id: string;
  activated_at: Date | null;
  ended_at: Date | null;
  updated_at: Date;
  goal_count: number;
};
const PLAN_SELECT = (tx: UserTransaction) => tx`
  p.id, p.patient_id, p.clinical_record_id, p.version, p.status, p.supersedes_plan_id, p.summary, p.interventions,
  p.frequency, p.start_date::text, p.review_date::text, p.author_membership_id, p.activated_at, p.ended_at, p.updated_at,
  (select count(*)::int from public.treatment_goals g where g.organization_id = p.organization_id
     and g.treatment_plan_id = p.id) as goal_count`;
const toSummary = (p: PlanRow): PlanSummaryDto => ({
  id: p.id,
  patientId: p.patient_id,
  recordId: p.clinical_record_id,
  version: p.version,
  status: p.status,
  supersedesPlanId: p.supersedes_plan_id,
  frequency: p.frequency,
  startDate: p.start_date,
  reviewDate: p.review_date,
  authorMembershipId: p.author_membership_id,
  activatedAt: iso(p.activated_at),
  endedAt: iso(p.ended_at),
  updatedAt: iso(p.updated_at) as string,
  goalCount: p.goal_count,
});

export async function getTreatmentPlan(
  ctx: AuthzContext,
  planId: string,
): Promise<Outcome<PlanDto>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const [p] = await tx<PlanRow[]>`select ${PLAN_SELECT(tx)} from public.treatment_plans p
                                    where p.organization_id = ${org} and p.id = ${planId}`;
    if (!p) return notFound();
    const goals = await tx<
      {
        id: string;
        position: number;
        description: RichText;
        status: GoalStatus;
        target_date: string | null;
        achieved_at: Date | null;
        patient_facing_text: RichText | null;
        withdrawn_at: Date | null;
      }[]
    >`select g.id, g.position, g.description, g.status, g.target_date::text, g.achieved_at,
             t.patient_facing_text, t.withdrawn_at
      from public.treatment_goals g
      left join public.treatment_goal_patient_texts t
        on t.organization_id = g.organization_id and t.treatment_goal_id = g.id
      where g.organization_id = ${org} and g.treatment_plan_id = ${planId}
      order by g.position, g.created_at`;
    await recordAudit(
      tx,
      'treatment_plan.viewed',
      { patient_id: p.patient_id },
      auditTarget(ctx, 'treatment_plan', planId),
    );
    const { goalCount, ...summary } = toSummary(p);
    void goalCount;
    return {
      ...summary,
      summary: p.summary,
      interventions: p.interventions,
      goals: goals.map((g) => ({
        id: g.id,
        position: g.position,
        description: g.description,
        status: g.status,
        targetDate: g.target_date,
        achievedAt: iso(g.achieved_at),
        patientFacingText: g.patient_facing_text,
        patientFacingWithdrawnAt: iso(g.withdrawn_at),
      })),
    };
  });
}

/** TPL-02: every version, newest first (no content; open one with getTreatmentPlan). */
export async function listTreatmentPlans(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<PlanSummaryDto[]>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const [visible] =
      await tx`select app.can_read_clinical(${org}::uuid, ${patientId}::uuid) as ok`;
    if (!visible?.ok) return notFound();
    const rows = await tx<PlanRow[]>`select ${PLAN_SELECT(tx)} from public.treatment_plans p
                                     where p.organization_id = ${org} and p.patient_id = ${patientId}
                                     order by p.version desc`;
    await recordAudit(
      tx,
      'treatment_plan.viewed',
      { patient_id: patientId },
      auditTarget(ctx, 'patient', patientId),
    );
    return rows.map(toSummary);
  });
}

export type PortalGoalDto = { goalId: string; patientFacingText: RichText; status: GoalStatus };

/** Portal "My objectives": patient-facing wording + status of the active plan only. */
export async function listMyGoals(
  ctx: AuthzContext,
  patientId?: string,
): Promise<Outcome<PortalGoalDto[]>> {
  return runPortal(ctx, 'portal.goals.read', patientId, async (tx, org, patient) => {
    const rows = await tx<{ goal_id: string; patient_facing_text: RichText; status: GoalStatus }[]>`
      select goal_id, patient_facing_text, status from app.portal_patient_goals(${org}::uuid, ${patient}::uuid)`;
    return rows.map((r) => ({
      goalId: r.goal_id,
      patientFacingText: r.patient_facing_text,
      status: r.status,
    }));
  });
}
