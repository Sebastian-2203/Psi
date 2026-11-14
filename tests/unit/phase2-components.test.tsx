import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/es.json';
import {
  BodyEditor,
  emptyRun,
  toBody,
  type EditorBlock,
} from '@/modules/consents/components/body-editor';
import { ConsentBodyView } from '@/modules/consents/components/consent-body';
import { SignConsentList } from '@/modules/consents/components/sign-consent';
import type { SignableConsentDto } from '@/modules/consents/components/types';
import { consentBodySchema } from '@/modules/consents/schemas';
import { PermissionsChecklist } from '@/modules/guardians/components/permissions-checklist';
import type { GuardianRelationshipDto } from '@/modules/guardians/components/types';
import { CreatePatientForm } from '@/modules/patients/components/create-patient-form';
import { PatientList } from '@/modules/patients/components/patient-list';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const refresh = vi.fn();
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh, push }),
  usePathname: () => '/',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const wrap = (ui: ReactNode) => (
  <NextIntlClientProvider locale="es" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const HASH = 'a'.repeat(64);
const consent: SignableConsentDto = {
  patientId: '11111111-1111-4111-8111-111111111111',
  templateId: '22222222-2222-4222-8222-222222222222',
  templateKey: 'tratamiento',
  consentType: 'treatment_informed_consent',
  signerRequirement: 'patient',
  versionId: '33333333-3333-4333-8333-333333333333',
  locale: 'es',
  title: 'Consentimiento ficticio',
  body: {
    version: 1,
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ],
  },
  bodyHash: HASH,
  myStatus: null,
  myConsentRecordId: null,
};

describe('ConsentBodyView', () => {
  it('renders text as text, never as HTML', () => {
    const { container } = render(wrap(<ConsentBodyView body={consent.body} fallback="x" />));
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
  });

  it('shows the fallback for a body that is not valid against the AST schema', () => {
    render(
      wrap(
        <ConsentBodyView
          body={{ version: 1, blocks: [{ type: 'html', raw: '<b>x</b>' }] }}
          fallback="No disponible"
        />,
      ),
    );
    expect(screen.getByText('No disponible')).toBeTruthy();
  });
});

describe('consent body editor', () => {
  it('produces an AST that passes the shared schema and drops empty runs', () => {
    const blocks: EditorBlock[] = [
      { type: 'heading', level: 2, runs: [{ text: 'Título', bold: true, italic: false }] },
      {
        type: 'list',
        ordered: true,
        items: [[{ text: 'Uno', bold: false, italic: true }, emptyRun()]],
      },
    ];
    const body = toBody(blocks);
    expect(consentBodySchema.safeParse(body).success).toBe(true);
    expect(body.blocks[1]).toMatchObject({
      items: [[{ type: 'text', text: 'Uno', italic: true }]],
    });
  });

  it('adds blocks through the structured controls only', () => {
    const onChange = vi.fn();
    render(wrap(<BodyEditor blocks={[]} onChange={onChange} />));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar lista' }));
    expect(onChange).toHaveBeenCalledWith([
      { type: 'list', ordered: false, items: [[{ text: '', bold: false, italic: false }]] },
    ]);
  });
});

describe('SignConsentList', () => {
  it('requires the typed name and the checkbox, then sends bodyHash as textHash', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: { consentRecordId: 'r' } });
    render(wrap(<SignConsentList consents={[consent]} action={action} />));
    fireEvent.click(screen.getByRole('button', { name: 'Acepto' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getAllByText('Este campo es obligatorio.').length).toBe(2);

    fireEvent.change(screen.getByLabelText('Escribe tu nombre completo'), {
      target: { value: 'Ana Ficticia' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Acepto' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith({
      patientId: consent.patientId,
      versionId: consent.versionId,
      decision: 'accepted',
      typedName: 'Ana Ficticia',
      checkboxConfirmed: true,
      textHash: HASH,
    });
    expect(await screen.findByText(/registramos que aceptaste/i)).toBeTruthy();
  });

  it('does not offer to sign again once decided', () => {
    render(
      wrap(<SignConsentList consents={[{ ...consent, myStatus: 'accepted' }]} action={vi.fn()} />),
    );
    expect(screen.queryByRole('button', { name: 'Acepto' })).toBeNull();
    expect(screen.getByText(/ya registraste tu decisión/i)).toBeTruthy();
  });
});

const relationship: GuardianRelationshipDto = {
  patientGuardianId: '44444444-4444-4444-8444-444444444444',
  guardianId: '55555555-5555-4555-8555-555555555555',
  firstName: 'Marta',
  lastName: 'Ficticia',
  email: 'marta@example.test',
  relationship: 'mother',
  status: 'active',
  suspensionReason: null,
  isLegalRepresentative: true,
  legalBasis: 'parental_authority',
  legalBasisVerified: true,
  isPrimaryContact: true,
  validFrom: '2026-01-01',
  validUntil: null,
  hasPortalLogin: false,
  permissions: ['view_assignments'],
  caveat: { text: 'Nota interna ficticia', restrictSchedule: true },
};

describe('PermissionsChecklist', () => {
  it('sends only what is checked and blocks the schedule under a caveat', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: {} });
    render(wrap(<PermissionsChecklist relationship={relationship} action={action} />));
    const boxes = screen.getAllByRole('checkbox') as HTMLButtonElement[];
    expect(boxes).toHaveLength(10);
    expect(boxes.filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(
      screen.getByRole('checkbox', { name: 'Ver calendario de sesiones' }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Firmar consentimientos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar permisos' }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(action).toHaveBeenCalledWith({
      patientGuardianId: relationship.patientGuardianId,
      permissions: ['view_assignments', 'sign_consents'],
    });
  });

  it('is disabled until the relationship is verified', () => {
    render(
      wrap(
        <PermissionsChecklist
          relationship={{ ...relationship, status: 'pending_verification', permissions: [] }}
          action={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/Verifica la relación antes de dar permisos/)).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Firmar consentimientos' }).matches(':disabled'),
    ).toBe(true);
  });
});

describe('PatientList', () => {
  const mine = [
    {
      patientId: 'a',
      firstName: 'Ana',
      lastName: 'Ficticia',
      preferredName: null,
      status: 'active' as const,
      isMinor: false,
      updatedAt: 't',
      majorityInDays: null,
    },
  ];
  const noSearch = vi.fn();
  const directory = [
    {
      patientId: 'a',
      firstName: 'Ana',
      lastName: 'Ficticia',
      preferredName: null,
      status: 'active' as const,
      onMyCareTeam: true,
    },
    {
      patientId: 'b',
      firstName: 'Beto',
      lastName: 'Ficticio',
      preferredName: null,
      status: 'intake' as const,
      onMyCareTeam: false,
    },
  ];

  it('links only care-team rows; directory-only rows are plain text', () => {
    render(wrap(<PatientList mine={mine} directory={directory} canCreate search={noSearch} />));
    expect(screen.getByRole('link', { name: /Ana Ficticia/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Beto Ficticio/ })).toBeNull();
    expect(screen.getByText('Beto Ficticio')).toBeTruthy();
  });

  it('searches on the server (debounced) and renders the returned rows', async () => {
    const search = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        mine: [],
        directory: [{ ...directory[1], patientId: 'c', firstName: 'Cata', lastName: 'Ficticia' }],
      },
    });
    render(wrap(<PatientList mine={mine} directory={directory} canCreate search={search} />));
    fireEvent.change(screen.getByLabelText('Buscar paciente'), { target: { value: 'cata' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith({ search: 'cata' }));
    await waitFor(() => expect(screen.getByText('Cata Ficticia')).toBeTruthy());
    expect(screen.queryByText('Beto Ficticio')).toBeNull();
    expect(screen.queryByRole('link', { name: /Ana Ficticia/ })).toBeNull();
  });

  it('shows the empty state with the create action when there are no patients', () => {
    render(wrap(<PatientList mine={[]} directory={[]} canCreate search={noSearch} />));
    expect(screen.getByText('Aún no tienes pacientes')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Nuevo paciente/ }).length).toBeGreaterThan(0);
  });

  it('hides the create action without permission (owner only)', () => {
    render(
      wrap(<PatientList mine={[]} directory={directory} canCreate={false} search={noSearch} />),
    );
    expect(screen.queryByRole('link', { name: /Nuevo paciente/ })).toBeNull();
  });
});

describe('CreatePatientForm duplicate flow', () => {
  it('asks for confirmation and only then resubmits with confirmDuplicate', async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'PRECONDITION_FAILED',
          messageKey: 'patients.errors.possibleDuplicate',
          fieldErrors: { duplicate: ['name_dob'] },
          requestId: 'r',
          retryable: false,
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { patientId: 'new-id' } });
    render(wrap(<CreatePatientForm action={action} />));
    fireEvent.change(screen.getByLabelText('Nombres'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Apellidos'), { target: { value: 'Ficticia' } });
    fireEvent.change(screen.getByLabelText('Fecha de nacimiento'), {
      target: { value: '1990-05-14' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear paciente' }));
    expect(await screen.findByTestId('duplicate-warning')).toBeTruthy();
    expect(action.mock.calls[0]![0]).not.toHaveProperty('confirmDuplicate');
    fireEvent.click(screen.getByRole('button', { name: /crear de todos modos/i }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1]![0]).toMatchObject({ firstName: 'Ana', confirmDuplicate: true });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/patients/new-id'));
  });
});
