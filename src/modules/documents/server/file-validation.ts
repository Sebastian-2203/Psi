import 'server-only';
import { createHash } from 'node:crypto';
import { MAX_CLINICAL_FILE_BYTES } from '@/modules/documents/schemas';

/**
 * Server-side validation of an uploaded clinical file (DOC-01): declared MIME type must be on
 * the allowlist AND match the file's magic bytes; size bounded; display name sanitized.
 * Malware scanning is NOT implemented (pending: needs an approved scanner, ADR) — files are
 * never rendered inline: downloads use `Content-Disposition: attachment` signed URLs.
 */

export type ValidatedFile = {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
  sha256Hex: string;
  displayName: string;
};

export type FileRejection = 'fileTypeNotAllowed' | 'fileTooLarge' | 'fieldRequired';

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const SNIFFERS: Record<string, (b: Uint8Array) => boolean> = {
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
  'image/png': (b) => b[0] === 0x89 && ascii(b, 1, 3) === 'PNG',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP',
  'audio/mpeg': (b) => ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
  'audio/mp4': (b) => ascii(b, 4, 4) === 'ftyp',
  'audio/ogg': (b) => ascii(b, 0, 4) === 'OggS',
  'audio/wav': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE',
};

/** Keeps letters, digits, space and `._-()`; collapses the rest; bounded to 200 chars. */
export function sanitizeDisplayName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/, '')
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'archivo';
}

export function validateClinicalFile(
  bytes: Uint8Array,
  declaredType: string,
  originalName: string,
): { ok: true; file: ValidatedFile } | { ok: false; reason: FileRejection } {
  if (bytes.byteLength === 0) return { ok: false, reason: 'fieldRequired' };
  if (bytes.byteLength > MAX_CLINICAL_FILE_BYTES) return { ok: false, reason: 'fileTooLarge' };
  const mimeType = declaredType.toLowerCase().split(';')[0]?.trim() ?? '';
  const sniff = SNIFFERS[mimeType];
  if (!sniff || !sniff(bytes)) return { ok: false, reason: 'fileTypeNotAllowed' };
  return {
    ok: true,
    file: {
      bytes,
      mimeType,
      sizeBytes: bytes.byteLength,
      sha256Hex: createHash('sha256').update(bytes).digest('hex'),
      displayName: sanitizeDisplayName(originalName),
    },
  };
}
