'use client';

import { Eye, EyeOff, Lock, PencilLine, Plus, Target } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { FormError, FormField, SelectField } from '@/components/shared/form-kit';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { ConfirmDialog } from '@/modules/clinical-records/components/confirm-dialog';
import { todayIso } from '@/modules/clinical-records/components/field-error';
import { RichTextView, isRichTextEmpty } from '@/modules/clinical-records/components/rich-text';
import { RichTextField } from '@/modules/clinical-records/components/rich-text-field';
import type {
  Action,
  GoalDto,
  GoalStatus,
  PlanDto,
  PlanStatus,
  PlanSummaryDto,
  RichText,
} from '@/modules/clinical-records/components/types';

const GOAL_STATUSES: GoalStatus[] = ['open', 'in_progress', 'achieved', 'discontinued'];
const EMPTY: RichText = { version: 1, blocks: [] };

type PlanFields = {
  summary: RichText;
  interventions?: RichText;
  frequency?: string;
  startDate: string;
  reviewDate?: string;
};

export type PlanActions = {
  create: Action<
    PlanFields & { recordId: string; goals: never[] },
    { planId: string; version: number }
  >;
  update: Action<{
    planId: string;
    summary?: RichText;
    interventions?: RichText | null;
    frequency?: string | null;
    startDate?: string;
    reviewDate?: string | null;
  }>;
  addGoal: Action<
    { planId: string; position: number; description: RichText; targetDate?: string },
    { goalId: string }
  >;
  activate: Action<{ planId: string }>;
  revise: Action<{ planId: string }, { planId: string }>;
  end: Action<{ planId: string; status: 'completed' | 'discontinued' }>;
  goalStatus: Action<{ goalId: string; status: GoalStatus }>;
  setGoalText: Action<{ goalId: string; patientFacingText: RichText | null }>;
  withdrawGoalText: Action<{ goalId: string }>;
  get: Action<{ planId: string }, PlanDto>;
};

function PlanFormDialog({
  recordId,
  plan,
  actions,
  onClose,
  onDone,
}: {
  recordId: string;
  plan: PlanDto | null;
  actions: PlanActions;
  onClose: () => void;
  onDone: (planId: string) => void;
}) {
  const t = useTranslations('clinical.plan.form');
  const tc = useTranslations('common');
  const [summary, setSummary] = useState<RichText>(plan?.summary ?? EMPTY);
  const [interventions, setInterventions] = useState<RichText>(plan?.interventions ?? EMPTY);
  const [frequency, setFrequency] = useState(plan?.frequency ?? '');
  const [start, setStart] = useState(plan?.startDate ?? todayIso());
  const [review, setReview] = useState(plan?.reviewDate ?? '');
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const result = plan
      ? await actions.update({
          planId: plan.id,
          summary,
          interventions: isRichTextEmpty(interventions) ? null : interventions,
          frequency: frequency.trim() === '' ? null : frequency.trim(),
          startDate: start,
          reviewDate: review === '' ? null : review,
        })
      : await actions.create({
          recordId,
          summary,
          ...(isRichTextEmpty(interventions) ? {} : { interventions }),
          ...(frequency.trim() ? { frequency: frequency.trim() } : {}),
          startDate: start,
          ...(review ? { reviewDate: review } : {}),
          goals: [],
        });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(plan ? plan.id : (result.data as { planId: string }).planId);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? t('editTitle') : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <RichTextField label={t('summary')} value={summary} onChange={setSummary} rows={6} />
        <RichTextField
          label={t('interventions')}
          value={interventions}
          onChange={setInterventions}
          rows={5}
        />
        <FormField
          label={t('frequency')}
          value={frequency}
          maxLength={200}
          onChange={(e) => setFrequency(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('startDate')}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <FormField
            label={t('reviewDate')}
            type="date"
            value={review}
            onChange={(e) => setReview(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {plan ? t('save') : t('create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoalDialog({
  plan,
  actions,
  onClose,
  onDone,
}: {
  plan: PlanDto;
  actions: PlanActions;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('clinical.plan.goal');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const [description, setDescription] = useState<RichText>(EMPTY);
  const [target, setTarget] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (isRichTextEmpty(description)) {
      setFieldError(tv('fieldRequired'));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    const result = await actions.addGoal({
      planId: plan.id,
      position: Math.min(plan.goals.length, 99),
      description,
      ...(target ? { targetDate: target } : {}),
    });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('clinicalHint')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <RichTextField
          label={t('description')}
          value={description}
          onChange={setDescription}
          error={fieldError}
          rows={5}
        />
        <FormField
          label={t('targetDate')}
          type="date"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('addSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PatientTextDialog({
  goal,
  actions,
  onClose,
  onDone,
}: {
  goal: GoalDto;
  actions: PlanActions;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('clinical.plan.goal');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const [text, setText] = useState<RichText>(goal.patientFacingText ?? EMPTY);
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (isRichTextEmpty(text)) {
      setFieldError(tv('fieldRequired'));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    const result = await actions.setGoalText({ goalId: goal.id, patientFacingText: text });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('patientTextTitle')}</DialogTitle>
          <DialogDescription>{t('patientTextDescription')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <RichTextField
          label={t('patientText')}
          value={text}
          onChange={setText}
          error={fieldError}
          rows={4}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('patientTextSave')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_BADGE: Record<PlanStatus, 'warning' | 'success' | 'neutral' | 'info'> = {
  draft: 'warning',
  active: 'success',
  completed: 'neutral',
  superseded: 'neutral',
  discontinued: 'neutral',
};

/**
 * Plan de tratamiento tab (TPL-01..03): versions, draft -> active -> revise/end, goals, and the
 * separate patient-facing goal wording (the only goal text that ever reaches the portal). All text
 * is psychologist-authored; the system suggests no goals or interventions.
 */
export function PlanTab({
  recordId,
  recordClosed,
  plans,
  current,
  loadFailed,
  actions,
}: {
  recordId: string;
  recordClosed: boolean;
  plans: PlanSummaryDto[];
  current: PlanDto | null;
  loadFailed: boolean;
  actions: PlanActions;
}) {
  const t = useTranslations('clinical.plan');
  const format = useFormatter();
  const router = useRouter();
  const [override, setOverride] = useState<PlanDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingGoal, setAddingGoal] = useState(false);
  const [textGoal, setTextGoal] = useState<GoalDto | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const plan = override ?? current;
  const readOnly = recordClosed;

  async function load(planId: string) {
    const result = await actions.get({ planId });
    if (result.ok) setOverride(result.data);
    else setError(result.error);
    router.refresh();
  }
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00`), { dateStyle: 'medium' });

  if (loadFailed) {
    return (
      <Alert variant="error">
        <AlertDescription>{t('loadFailed')}</AlertDescription>
      </Alert>
    );
  }

  const createDialog = editing ? (
    <PlanFormDialog
      key={plan?.id ?? 'new'}
      recordId={recordId}
      plan={plan && plan.status === 'draft' ? plan : null}
      actions={actions}
      onClose={() => setEditing(false)}
      onDone={(id) => {
        setEditing(false);
        void load(id);
      }}
    />
  ) : null;

  if (!plan) {
    return (
      <Card>
        <EmptyState
          icon={Target}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            !readOnly ? (
              <Button onClick={() => setEditing(true)}>
                <Plus aria-hidden />
                {t('create')}
              </Button>
            ) : undefined
          }
        />
        {createDialog}
      </Card>
    );
  }

  const isDraft = plan.status === 'draft';
  const isActive = plan.status === 'active';

  return (
    <div className="flex flex-col gap-4">
      {plans.length > 1 ? (
        <nav aria-label={t('versions')} className="flex flex-wrap gap-2">
          {plans.map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={p.id === plan.id ? 'default' : 'outline'}
              aria-current={p.id === plan.id ? 'true' : undefined}
              onClick={() => void load(p.id)}
            >
              {t('version', { n: p.version })} · {t(`statuses.${p.status}`)}
            </Button>
          ))}
        </nav>
      ) : null}

      <Card data-testid="treatment-plan">
        <CardHeader>
          <CardTitle>{t('title', { n: plan.version })}</CardTitle>
          <CardDescription>
            {t('dates', {
              start: day(plan.startDate),
              review: plan.reviewDate ? day(plan.reviewDate) : t('noReview'),
            })}
            {plan.frequency ? ` · ${plan.frequency}` : ''}
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGE[plan.status]}>
            {isDraft ? <PencilLine aria-hidden /> : <Lock aria-hidden />}
            {t(`statuses.${plan.status}`)}
          </Badge>
          {!readOnly && isDraft ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
              <ConfirmDialog
                trigger={<Button size="sm">{t('activate')}</Button>}
                title={t('activateTitle')}
                description={t('activateDescription')}
                confirmLabel={t('activateConfirm')}
                action={() => actions.activate({ planId: plan.id })}
                onDone={() => void load(plan.id)}
              />
            </>
          ) : null}
          {!readOnly &&
          !isDraft &&
          !isActive &&
          !plans.some((p) => p.status === 'draft' || p.status === 'active') ? (
            <Button size="sm" onClick={() => setEditing(true)}>
              <Plus aria-hidden />
              {t('create')}
            </Button>
          ) : null}
          {!readOnly && isActive ? (
            <>
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm">
                    {t('revise')}
                  </Button>
                }
                title={t('reviseTitle')}
                description={t('reviseDescription')}
                confirmLabel={t('reviseConfirm')}
                action={async () => {
                  const result = await actions.revise({ planId: plan.id });
                  if (result.ok) await load(result.data.planId);
                  return result;
                }}
                onDone={() => undefined}
              />
              <ReasonDialog
                trigger={
                  <Button variant="destructive" size="sm">
                    {t('end')}
                  </Button>
                }
                title={t('endTitle')}
                description={t('endDescription')}
                confirmLabel={t('endConfirm')}
                destructive
                reasonLabel={t('endOutcome')}
                options={[
                  { value: 'completed', label: t('statuses.completed') },
                  { value: 'discontinued', label: t('statuses.discontinued') },
                ]}
                action={(status) =>
                  actions.end({ planId: plan.id, status: status as 'completed' | 'discontinued' })
                }
                onDone={() => void load(plan.id)}
              />
            </>
          ) : null}
        </div>
        <FormError error={error} />
        <div>
          <h4>{t('summary')}</h4>
          {isRichTextEmpty(plan.summary) ? (
            <p className="text-muted-foreground">{t('summaryEmpty')}</p>
          ) : (
            <RichTextView body={plan.summary} />
          )}
        </div>
        {plan.interventions && !isRichTextEmpty(plan.interventions) ? (
          <div>
            <h4>{t('interventions')}</h4>
            <RichTextView body={plan.interventions} />
          </div>
        ) : null}
      </Card>

      <section aria-labelledby="goals-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="goals-title">{t('goals', { count: plan.goals.length })}</h3>
          {!readOnly && isDraft ? (
            <Button variant="outline" size="sm" onClick={() => setAddingGoal(true)}>
              <Plus aria-hidden />
              {t('goal.add')}
            </Button>
          ) : null}
        </div>
        {plan.goals.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">{t('goalsEmpty')}</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="goals-list">
            {plan.goals.map((g) => (
              <li key={g.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <RichTextView body={g.description} />
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {g.targetDate ? (
                    <span>{t('goal.target', { date: day(g.targetDate) })}</span>
                  ) : null}
                  {isActive && !readOnly ? (
                    <GoalStatusSelect
                      goal={g}
                      actions={actions}
                      onChanged={() => void load(plan.id)}
                    />
                  ) : (
                    <Badge variant="neutral">{t(`goal.statuses.${g.status}`)}</Badge>
                  )}
                </div>
                <div
                  className="flex flex-col gap-2 rounded-md bg-muted p-3"
                  data-testid="goal-patient-text"
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {g.patientFacingText && !g.patientFacingWithdrawnAt ? (
                      <Eye className="size-4" aria-hidden />
                    ) : (
                      <EyeOff className="size-4" aria-hidden />
                    )}
                    {t('goal.patientVisible')}
                  </span>
                  {g.patientFacingText && !g.patientFacingWithdrawnAt ? (
                    <RichTextView body={g.patientFacingText} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {g.patientFacingWithdrawnAt
                        ? t('goal.patientWithdrawn')
                        : t('goal.patientNone')}
                    </p>
                  )}
                  {!readOnly && isDraft ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => setTextGoal(g)}
                    >
                      {g.patientFacingText ? t('goal.patientEdit') : t('goal.patientAdd')}
                    </Button>
                  ) : null}
                  {!readOnly && isActive && g.patientFacingText && !g.patientFacingWithdrawnAt ? (
                    <ConfirmDialog
                      trigger={
                        <Button variant="destructive" size="sm" className="self-start">
                          {t('goal.withdraw')}
                        </Button>
                      }
                      title={t('goal.withdrawTitle')}
                      description={t('goal.withdrawDescription')}
                      confirmLabel={t('goal.withdrawConfirm')}
                      destructive
                      action={() => actions.withdrawGoalText({ goalId: g.id })}
                      onDone={() => void load(plan.id)}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {createDialog}
      {addingGoal ? (
        <GoalDialog
          plan={plan}
          actions={actions}
          onClose={() => setAddingGoal(false)}
          onDone={() => {
            setAddingGoal(false);
            void load(plan.id);
          }}
        />
      ) : null}
      {textGoal ? (
        <PatientTextDialog
          goal={textGoal}
          actions={actions}
          onClose={() => setTextGoal(null)}
          onDone={() => {
            setTextGoal(null);
            void load(plan.id);
          }}
        />
      ) : null}
    </div>
  );
}

function GoalStatusSelect({
  goal,
  actions,
  onChanged,
}: {
  goal: GoalDto;
  actions: PlanActions;
  onChanged: () => void;
}) {
  const t = useTranslations('clinical.plan.goal');
  const [error, setError] = useState<ActionError | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <SelectField
        label={t('status')}
        value={goal.status}
        onChange={async (e) => {
          setError(null);
          const result = await actions.goalStatus({
            goalId: goal.id,
            status: e.target.value as GoalStatus,
          });
          if (result.ok) onChanged();
          else setError(result.error);
        }}
      >
        {GOAL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`statuses.${s}`)}
          </option>
        ))}
      </SelectField>
      <FormError error={error} />
    </div>
  );
}
