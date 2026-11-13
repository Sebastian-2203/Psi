import { describe, expect, it } from 'vitest';
import {
  consentBodySchema,
  recordConsentSchema,
  signConsentSchema,
} from '@/modules/consents/schemas';
import {
  createGuardianSchema,
  setPermissionsSchema,
  suspendRelationshipSchema,
} from '@/modules/guardians/schemas';
import {
  changePatientStatusSchema,
  createPatientSchema,
  updatePatientSchema,
} from '@/modules/patients/schemas';

const id = '3b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

describe('patient schemas', () => {
  it('normalises optional blanks and rejects unknown keys, future dates and orphan document numbers', () => {
    const ok = createPatientSchema.parse({
      firstName: ' Ana ',
      lastName: 'Ficticia',
      dateOfBirth: '1990-01-01',
      email: '',
      phone: '',
      preferredName: '  ',
    });
    expect(ok).toMatchObject({
      firstName: 'Ana',
      email: undefined,
      phone: undefined,
      preferredName: undefined,
    });
    expect(createPatientSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(
      createPatientSchema.safeParse({ firstName: 'A', lastName: 'B', dateOfBirth: '2999-01-01' })
        .success,
    ).toBe(false);
    expect(
      createPatientSchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        dateOfBirth: '1990-01-01',
        documentNumber: 'ABC123',
      }).success,
    ).toBe(false);
  });

  it('update needs at least one field; clearing uses null; status cannot go back to intake', () => {
    expect(updatePatientSchema.safeParse({ patientId: id, expectedUpdatedAt: 'x' }).success).toBe(
      false,
    );
    const parsed = updatePatientSchema.parse({
      patientId: id,
      expectedUpdatedAt: 'x',
      phone: null,
      sex: '',
    });
    expect(parsed.phone).toBeNull();
    expect(parsed.sex).toBeNull();
    expect(changePatientStatusSchema.safeParse({ patientId: id, status: 'intake' }).success).toBe(
      false,
    );
    expect(
      changePatientStatusSchema.safeParse({ patientId: id, status: 'active', reason: 'x' }).success,
    ).toBe(false);
  });
});

describe('guardian schemas', () => {
  it('a legal representative needs a legal basis; age_of_majority is not a user suspension reason', () => {
    const base = { patientId: id, firstName: 'G', lastName: 'F', relationship: 'mother' as const };
    expect(createGuardianSchema.safeParse({ ...base, isLegalRepresentative: true }).success).toBe(
      false,
    );
    expect(
      createGuardianSchema.safeParse({
        ...base,
        isLegalRepresentative: true,
        legalBasis: 'court_order',
      }).success,
    ).toBe(true);
    expect(
      suspendRelationshipSchema.safeParse({ patientGuardianId: id, reason: 'age_of_majority' })
        .success,
    ).toBe(false);
    expect(
      setPermissionsSchema.safeParse({ patientGuardianId: id, permissions: ['view_diagnosis'] })
        .success,
    ).toBe(false);
    expect(setPermissionsSchema.safeParse({ patientGuardianId: id, permissions: [] }).success).toBe(
      true,
    );
  });
});

describe('consent schemas', () => {
  it('the body is a restricted AST: no html, no unknown inline attributes', () => {
    const text = { type: 'text', text: 'Texto ficticio' };
    expect(
      consentBodySchema.safeParse({ version: 1, blocks: [{ type: 'paragraph', children: [text] }] })
        .success,
    ).toBe(true);
    expect(
      consentBodySchema.safeParse({ version: 1, blocks: [{ type: 'html', html: '<b>x</b>' }] })
        .success,
    ).toBe(false);
    expect(
      consentBodySchema.safeParse({
        version: 1,
        blocks: [{ type: 'paragraph', children: [{ ...text, href: 'javascript:alert(1)' }] }],
      }).success,
    ).toBe(false);
  });

  it('signing needs the typed name, the checkbox and a sha256 hex; recording needs a guardian link iff guardian', () => {
    const sign = {
      patientId: id,
      versionId: id,
      decision: 'accepted',
      typedName: 'Ana Ficticia',
      checkboxConfirmed: true,
      textHash: 'a'.repeat(64),
    };
    expect(signConsentSchema.safeParse(sign).success).toBe(true);
    expect(signConsentSchema.safeParse({ ...sign, checkboxConfirmed: false }).success).toBe(false);
    expect(signConsentSchema.safeParse({ ...sign, textHash: 'zz' }).success).toBe(false);
    const rec = {
      patientId: id,
      versionId: id,
      signerType: 'guardian',
      method: 'verbal_recorded',
      decision: 'accepted',
      decidedAt: '2026-11-13T10:00:00Z',
    };
    expect(recordConsentSchema.safeParse(rec).success).toBe(false);
    expect(recordConsentSchema.safeParse({ ...rec, patientGuardianId: id }).success).toBe(true);
    expect(
      recordConsentSchema.safeParse({ ...rec, signerType: 'patient', method: 'paper_scan' })
        .success,
    ).toBe(false);
  });
});
