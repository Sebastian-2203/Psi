import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/es.json';
import { richTextDraftSchema } from '@/lib/rich-text';
import {
  RichTextView,
  richTextToText,
  textToRichText,
} from '@/modules/clinical-records/components/rich-text';
import type {
  NoteTypeDto,
  NoteWithAddendaDto,
  PlanDto,
  SessionDto,
} from '@/modules/clinical-records/components/types';
import { NoteEditor } from '@/modules/notes/components/note-editor';
import { NoteView } from '@/modules/notes/components/note-view';
import { PlanTab } from '@/modules/treatment/components/plan-tab';
import { PortalGoals } from '@/modules/treatment/components/portal-goals';
import { SessionsTab } from '@/modules/sessions/components/sessions-tab';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const refresh = vi.fn();
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace }),
  usePathname: () => '/patients/p1',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const wrap = (ui: ReactNode) => (
  <NextIntlClientProvider locale="es" messages={messages} timeZone="America/Bogota">
    {ui}
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const paragraph = (text: string) => ({
  version: 1 as const,
  blocks: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text }] }],
});
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const noteTypes: NoteTypeDto[] = [
  {
    id: ID(1),
    key: 'free_text',
    label: 'Texto libre',
    description: null,
    position: 1,
    isActive: true,
  },
];
const baseNote = {
  id: ID(10),
  noteTypeId: ID(1),
  therapySessionId: null,
  authorMembershipId: ID(99),
  authorName: 'Ana Ficticia',
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  patientId: ID(5),
  contentLocale: 'es' as const,
  contentHash: null,
};
const finalized: NoteWithAddendaDto = {
  ...baseNote,
  status: 'finalized',
  finalizedAt: '2026-11-10T11:00:00.000Z',
  addendumCount: 1,
  body: paragraph('Contenido ficticio finalizado.'),
  contentHash: 'a'.repeat(64),
  addenda: [
    {
      id: ID(11),
      reason: 'clarification',
      body: paragraph('Aclaración ficticia.'),
      contentLocale: 'es',
      authorMembershipId: ID(98),
      authorName: 'Luis Ficticio',
      contentHash: 'b'.repeat(64),
      createdAt: '2026-11-11T09:00:00.000Z',
    },
  ],
};
const draft: NoteWithAddendaDto = {
  ...baseNote,
  status: 'draft',
  finalizedAt: null,
  addendumCount: 0,
  body: paragraph('Borrador ficticio.'),
  addenda: [],
};
const ok = <T,>(data: T) => ({ ok: true as const, data });

describe('rich text editing format', () => {
  it('round-trips and always yields a schema-valid restricted AST', () => {
    const text =
      '# Título\n\nUn párrafo con **negrita** y _cursiva_.\n\n- uno\n- dos\n\n1. primero\n2. segundo';
    const ast = textToRichText(text);
    expect(richTextDraftSchema.safeParse(ast).success).toBe(true);
    expect(ast.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(richTextToText(ast)).toBe(text);
    expect(textToRichText('').blocks).toEqual([]);
  });

  it('cannot express HTML: markup is rendered as escaped text', () => {
    const ast = textToRichText('<img src=x onerror=alert(1)> <script>x</script>');
    const { container } = render(<RichTextView body={ast} />);
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.textContent).toContain('<script>x</script>');
  });
});

describe('NoteView (finalized, locked)', () => {
  it('shows the locked stripe, the body and the addendum, with no way to edit the body', () => {
    render(
      wrap(
        <NoteView
          note={finalized}
          noteTypes={noteTypes}
          myMembershipId={ID(99)}
          addendumAction={vi.fn()}
          onChanged={vi.fn()}
        />,
      ),
    );
    expect(screen.getByTestId('note-locked-stripe').textContent).toContain('No editable');
    expect(screen.getByTestId('note-locked-stripe').textContent).toContain('Finalizada');
    expect(screen.getByTestId('note-body').textContent).toContain('Contenido ficticio finalizado.');
    expect(screen.getByTestId('addendum').textContent).toContain('Aclaración');
    expect(screen.getByTestId('addendum').textContent).toContain('Adenda');
    expect(screen.getByTestId('addendum').textContent).toContain('Luis Ficticio');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /finalizar|editar|guardar/i })).toBeNull();
  });

  it('requires addendum text, then sends reason, body and one stable idempotency key', async () => {
    const addendum = vi.fn().mockResolvedValue(ok({}));
    const onChanged = vi.fn();
    render(
      wrap(
        <NoteView
          note={finalized}
          noteTypes={noteTypes}
          myMembershipId={ID(99)}
          addendumAction={addendum}
          onChanged={onChanged}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agregar adenda' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar adenda' }));
    expect(await within(dialog).findByText('Este campo es obligatorio.')).toBeTruthy();
    expect(addendum).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Motivo de la adenda'), {
      target: { value: 'correction' },
    });
    fireEvent.change(within(dialog).getByLabelText('Texto de la adenda'), {
      target: { value: 'Corrección ficticia' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar adenda' }));
    await waitFor(() => expect(addendum).toHaveBeenCalledTimes(1));
    const sent = addendum.mock.calls[0]![0];
    expect(sent).toMatchObject({ noteId: finalized.id, reason: 'correction', contentLocale: 'es' });
    expect(sent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.body.blocks[0].children[0].text).toBe('Corrección ficticia');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe('NoteEditor (draft)', () => {
  const editorActions = () => ({
    update: vi
      .fn()
      .mockResolvedValue(ok({ noteId: draft.id, updatedAt: '2026-11-10T10:05:00.000Z' })),
    finalize: vi.fn().mockResolvedValue(ok({})),
    discard: vi.fn().mockResolvedValue(ok({})),
  });
  const mount = (actions: ReturnType<typeof editorActions>, onFinalized = vi.fn()) =>
    render(
      wrap(
        <NoteEditor
          note={draft}
          noteTypes={noteTypes}
          sessions={[] as SessionDto[]}
          actions={actions}
          onFinalized={onFinalized}
          onDiscarded={vi.fn()}
        />,
      ),
    );

  it('autosaves after typing, sending the concurrency token, and announces it politely', async () => {
    vi.useFakeTimers();
    const actions = editorActions();
    mount(actions);
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), {
      target: { value: 'Texto nuevo ficticio' },
    });
    expect(screen.getByTestId('save-indicator').textContent).toContain('Cambios sin guardar');
    expect(
      screen.getByTestId('save-indicator').querySelector('[aria-live="polite"]'),
    ).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(actions.update).toHaveBeenCalledTimes(1);
    expect(actions.update.mock.calls[0]![0]).toMatchObject({
      noteId: draft.id,
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(screen.getByTestId('save-indicator').textContent).toContain('Guardado a las');
    expect(actions.finalize).not.toHaveBeenCalled();
  });

  it('finalizing asks for confirmation first, saves pending changes, then finalizes', async () => {
    const actions = editorActions();
    const onFinalized = vi.fn();
    mount(actions, onFinalized);
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), {
      target: { value: 'Cambio último' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar nota' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('no se puede editar');
    expect(actions.finalize).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, finalizar nota' }));
    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
    expect(actions.update).toHaveBeenCalledTimes(1);
    expect(actions.finalize).toHaveBeenCalledWith({ noteId: draft.id });
    expect(actions.update.mock.invocationCallOrder[0]).toBeLessThan(
      actions.finalize.mock.invocationCallOrder[0]!,
    );
  });

  it('does not finalize when the pending save fails', async () => {
    const actions = editorActions();
    actions.update.mockResolvedValue({
      ok: false,
      error: { code: 'CONFLICT', messageKey: 'errors.conflict', requestId: 'r', retryable: false },
    });
    mount(actions);
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar nota' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, finalizar nota' }),
    );
    await waitFor(() => expect(actions.update).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('save-indicator').textContent).toContain('No se pudo guardar'),
    );
    expect(actions.finalize).not.toHaveBeenCalled();
  });
});

describe('portal goals', () => {
  it('renders only the patient-facing wording and the status', () => {
    render(
      wrap(
        <PortalGoals
          goals={[
            { goalId: ID(20), patientFacingText: paragraph('Dormir mejor'), status: 'in_progress' },
          ]}
        />,
      ),
    );
    const list = screen.getByTestId('portal-goals');
    expect(list.textContent).toContain('Dormir mejor');
    expect(list.textContent).toContain('En curso');
  });

  it('shows an empty state without goals', () => {
    render(wrap(<PortalGoals goals={[]} />));
    expect(screen.getByText('Por ahora no hay objetivos para mostrar.')).toBeTruthy();
  });
});

describe('SessionsTab', () => {
  const session = (over: Partial<SessionDto>): SessionDto => ({
    id: ID(30),
    patientId: ID(5),
    psychologistMembershipId: ID(99),
    treatmentPlanId: null,
    start: '2026-11-07T15:00:00.000Z',
    end: '2026-11-07T15:50:00.000Z',
    status: 'held',
    modality: 'in_person',
    cancelledReason: null,
    locationOrLink: null,
    noteState: 'none',
    updatedAt: '2026-11-07T16:00:00.000Z',
    ...over,
  });

  it('lists only my held sessions without a finalized note as pending and opens the notes tab', () => {
    render(
      wrap(
        <SessionsTab
          patientId={ID(5)}
          myMembershipId={ID(99)}
          plans={[]}
          loadFailed={false}
          actions={{ record: vi.fn(), update: vi.fn() }}
          sessions={[
            session({ id: ID(30) }),
            session({ id: ID(31), noteState: 'finalized' }),
            session({ id: ID(32), psychologistMembershipId: ID(98) }),
            session({ id: ID(33), status: 'scheduled' }),
          ]}
        />,
      ),
    );
    const pending = screen.getByTestId('pending-note-sessions');
    expect(within(pending).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(within(pending).getByRole('button', { name: 'Escribir nota' }));
    expect(replace).toHaveBeenCalledWith(`/patients/p1?tab=notes&session=${ID(30)}`);
  });
});

describe('PlanTab', () => {
  const plan = (status: PlanDto['status']): PlanDto => ({
    id: ID(40),
    patientId: ID(5),
    recordId: ID(6),
    version: 1,
    status,
    supersedesPlanId: null,
    summary: paragraph('Resumen ficticio'),
    interventions: null,
    frequency: null,
    startDate: '2026-11-01',
    reviewDate: null,
    authorMembershipId: ID(99),
    activatedAt: null,
    endedAt: null,
    updatedAt: '2026-11-01T10:00:00.000Z',
    goals: [
      {
        id: ID(41),
        position: 0,
        description: paragraph('Redacción clínica ficticia'),
        status: 'open',
        targetDate: null,
        achievedAt: null,
        patientFacingText: paragraph('Texto para ti'),
        patientFacingWithdrawnAt: null,
      },
    ],
  });
  const actions = () => ({
    create: vi.fn(),
    update: vi.fn(),
    addGoal: vi.fn(),
    activate: vi.fn(),
    revise: vi.fn(),
    end: vi.fn(),
    goalStatus: vi.fn(),
    setGoalText: vi.fn(),
    withdrawGoalText: vi.fn(),
    get: vi.fn(),
  });

  it('shows the clinical goal and the patient-facing text apart, editable only in a draft', () => {
    const { rerender } = render(
      wrap(
        <PlanTab
          recordId={ID(6)}
          recordClosed={false}
          plans={[]}
          current={plan('draft')}
          loadFailed={false}
          actions={actions()}
        />,
      ),
    );
    expect(screen.getByText('Redacción clínica ficticia')).toBeTruthy();
    expect(screen.getByTestId('goal-patient-text').textContent).toContain('Texto para ti');
    expect(screen.getByRole('button', { name: 'Editar texto para el paciente' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activar plan' })).toBeTruthy();

    rerender(
      wrap(
        <PlanTab
          recordId={ID(6)}
          recordClosed={false}
          plans={[]}
          current={plan('active')}
          loadFailed={false}
          actions={actions()}
        />,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Editar texto para el paciente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activar plan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revisar (nueva versión)' })).toBeTruthy();
  });
});
