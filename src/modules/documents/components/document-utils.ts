export const DOCUMENT_TYPES = [
  'referral',
  'report',
  'external_evaluation',
  'consent_scan',
  'certificate',
  'other',
] as const;

/** Allowed upload types (mirrors server file validation; the server re-checks the real bytes). */
export const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,audio/*';
export const MAX_BYTES = 20 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
