/** ADR-021 recovery code format: 16 symbols of a 32-symbol alphabet (no I, O, 0, 1) = 80 bits. */
export const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_LENGTH = 16;
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/;

/** Accepts "abcd-efgh ..." input: strips spaces/dashes, uppercases. */
export function normalizeRecoveryCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}
