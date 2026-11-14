import { describe, expect, it } from 'vitest';
import {
  sanitizeDisplayName,
  validateClinicalFile,
} from '@/modules/documents/server/file-validation';
import { MAX_CLINICAL_FILE_BYTES } from '@/modules/documents/schemas';

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const pdf = new TextEncoder().encode('%PDF-1.7 fictitious');

// DOC-01: blocked types / sizes produce clear rejections (QA Phase 3).
describe('validateClinicalFile (DOC-01)', () => {
  it('accepts a PDF whose magic bytes match the declared type', () => {
    const r = validateClinicalFile(pdf, 'application/pdf; charset=binary', 'informe.pdf');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.mimeType).toBe('application/pdf');
  });
  it('rejects a declared type that does not match the content (spoofed)', () => {
    expect(validateClinicalFile(pdf, 'image/png', 'x.png')).toEqual({
      ok: false,
      reason: 'fileTypeNotAllowed',
    });
  });
  it.each(['text/html', 'application/javascript', 'image/svg+xml', 'application/x-msdownload'])(
    'rejects blocked type %s',
    (t) => {
      expect(validateClinicalFile(bytes(0x3c, 0x73), t, 'x')).toEqual({
        ok: false,
        reason: 'fileTypeNotAllowed',
      });
    },
  );
  it('rejects oversized and empty files', () => {
    const big = new Uint8Array(MAX_CLINICAL_FILE_BYTES + 1);
    expect(validateClinicalFile(big, 'application/pdf', 'x.pdf')).toEqual({
      ok: false,
      reason: 'fileTooLarge',
    });
    expect(validateClinicalFile(new Uint8Array(), 'application/pdf', 'x.pdf').ok).toBe(false);
  });
  it('sanitizes path traversal in display names', () => {
    expect(sanitizeDisplayName('../../etc/passwd')).not.toMatch(/[/\\]/);
    expect(sanitizeDisplayName('...')).toBe('archivo');
  });
});
