import 'server-only';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

/**
 * Logo validation and sanitising (SECURITY.md §8, ADR-010, F-18). Pure: bytes in, bytes out.
 *
 * - The type comes from MAGIC BYTES only (never the client MIME or file name). SVG/XML/HTML and
 *   everything else is rejected; only PNG, JPEG and WebP pass.
 * - The container is parsed STRICTLY and re-written from validated parts. Metadata chunks
 *   (EXIF/GPS, XMP, text, comments, timestamps) and any trailing bytes are dropped, which also
 *   removes appended polyglot payloads. Pixel data is untouched (no re-encoding dependency).
 * - Dimensions are read from the headers and bounded.
 */

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MIN_SIDE = 16;
export const LOGO_MAX_SIDE = 2048;

export type LogoContentType = 'image/png' | 'image/jpeg' | 'image/webp';
export type LogoExtension = 'png' | 'jpg' | 'webp';
export type LogoErrorReason = 'too_large' | 'unsupported_type' | 'corrupt' | 'dimensions';

export class LogoError extends Error {
  constructor(readonly reason: LogoErrorReason) {
    super(`logo_${reason}`);
    this.name = 'LogoError';
  }
}

export type SanitizedLogo = {
  bytes: Buffer;
  contentType: LogoContentType;
  extension: LogoExtension;
  width: number;
  height: number;
  /** First 32 hex chars of sha256 over the SANITISED bytes (content-addressed object name). */
  hash: string;
};

const corrupt = () => new LogoError('corrupt');

/** Detects the type from magic bytes. Returns null for anything else (incl. SVG). */
export function sniffLogoType(bytes: Uint8Array): LogoContentType | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 16));
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 12 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function assertDimensions(width: number, height: number): void {
  if (
    width < LOGO_MIN_SIDE ||
    height < LOGO_MIN_SIDE ||
    width > LOGO_MAX_SIDE ||
    height > LOGO_MAX_SIDE
  ) {
    throw new LogoError('dimensions');
  }
}

/* ----------------------------------------- PNG ----------------------------------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Rendering-relevant chunks only. Dropped: tEXt/zTXt/iTXt, eXIf, tIME, pHYs, APNG chunks, … */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'IDAT',
  'IEND',
]);

function sanitizePng(input: Buffer) {
  const out: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  let first = true;
  let idat = 0;
  let width = 0;
  let height = 0;
  let ended = false;
  while (offset + 12 <= input.length && !ended) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('latin1', offset + 4, offset + 8);
    const end = offset + 8 + length + 4;
    if (length > 0x7fffffff || end > input.length || !/^[A-Za-z]{4}$/.test(type)) throw corrupt();
    const body = input.subarray(offset + 4, offset + 8 + length); // type + data
    if (crc32(body) !== input.readUInt32BE(offset + 8 + length)) throw corrupt();
    if (first) {
      if (type !== 'IHDR' || length !== 13) throw corrupt();
      width = input.readUInt32BE(offset + 8);
      height = input.readUInt32BE(offset + 12);
      first = false;
    }
    if (PNG_KEEP.has(type)) {
      out.push(input.subarray(offset, end));
      if (type === 'IDAT') idat += 1;
    }
    if (type === 'IEND') ended = true;
    offset = end;
  }
  if (first || !ended || idat === 0) throw corrupt();
  assertDimensions(width, height);
  return { bytes: Buffer.concat(out), width, height };
}

/* ----------------------------------------- JPEG ---------------------------------------- */

const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function sanitizeJpeg(input: Buffer) {
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let offset = 2;
  let width = 0;
  let height = 0;
  let scans = 0;
  let ended = false;
  while (offset < input.length && !ended) {
    if (input[offset] !== 0xff) throw corrupt();
    while (input[offset] === 0xff) offset += 1; // fill bytes
    const marker = input[offset];
    if (marker === undefined) throw corrupt();
    offset += 1;
    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      ended = true;
      break;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) throw corrupt();
    if (offset + 2 > input.length) throw corrupt();
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) throw corrupt();
    const segment = input.subarray(offset, offset + length);
    offset += length;
    if (isSof(marker)) {
      if (length < 8) throw corrupt();
      height = segment.readUInt16BE(3);
      width = segment.readUInt16BE(5);
    }
    // Drop APP1..APP13/APP15 (EXIF, XMP, ICC, …) and comments; keep JFIF (APP0) and Adobe (APP14).
    const dropped = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    if (!dropped) out.push(Buffer.from([0xff, marker]), segment);
    if (marker === 0xda) {
      if (width === 0) throw corrupt(); // SOS before SOF
      scans += 1;
      // Entropy-coded data: runs until a real marker (not FF00 stuffing, not RSTn, not fill).
      const start = offset;
      while (offset < input.length) {
        if (input[offset] === 0xff) {
          const next = input[offset + 1];
          if (next === undefined) throw corrupt();
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            offset += 2;
            continue;
          }
          if (next === 0xff) {
            offset += 1;
            continue;
          }
          break;
        }
        offset += 1;
      }
      out.push(input.subarray(start, offset));
    }
  }
  if (!ended || scans === 0 || width === 0) throw corrupt();
  assertDimensions(width, height);
  return { bytes: Buffer.concat(out), width, height };
}

/* ----------------------------------------- WebP ---------------------------------------- */

function sanitizeWebp(input: Buffer) {
  const riffSize = input.readUInt32LE(4);
  const total = riffSize + 8;
  if (total > input.length || total < 20) throw corrupt();
  const chunks: Buffer[] = [];
  let offset = 12;
  let width = 0;
  let height = 0;
  let images = 0;
  let canvas: { width: number; height: number } | null = null;
  while (offset + 8 <= total) {
    const type = input.toString('latin1', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > total) throw corrupt();
    const data = input.subarray(offset + 8, offset + 8 + size);
    let keep = false;
    switch (type) {
      case 'VP8X': {
        if (size < 10) throw corrupt();
        if ((data[0] ?? 0) & 0x02) throw new LogoError('unsupported_type'); // animation
        canvas = { width: data.readUIntLE(4, 3) + 1, height: data.readUIntLE(7, 3) + 1 };
        const patched = Buffer.from(input.subarray(offset, end));
        patched[8] = (patched[8] ?? 0) & ~(0x08 | 0x04); // clear EXIF + XMP flags
        chunks.push(patched);
        break;
      }
      case 'VP8 ':
        if (size < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) throw corrupt();
        width = data.readUInt16LE(6) & 0x3fff;
        height = data.readUInt16LE(8) & 0x3fff;
        images += 1;
        keep = true;
        break;
      case 'VP8L': {
        if (size < 5 || data[0] !== 0x2f) throw corrupt();
        const bits = data.readUInt32LE(1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        images += 1;
        keep = true;
        break;
      }
      case 'ICCP':
      case 'ALPH':
        keep = true;
        break;
      default: // EXIF, XMP, ANIM, ANMF, unknown: dropped
        break;
    }
    if (keep) chunks.push(input.subarray(offset, end));
    offset = end;
  }
  if (images !== 1) throw corrupt();
  if (canvas && (canvas.width !== width || canvas.height !== height)) throw corrupt();
  assertDimensions(width, height);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return { bytes: Buffer.concat([header, body]), width, height };
}

/* --------------------------------------- Entry point -------------------------------------- */

export function sanitizeLogo(input: Uint8Array): SanitizedLogo {
  if (input.length === 0) throw corrupt();
  if (input.length > LOGO_MAX_BYTES) throw new LogoError('too_large');
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const contentType = sniffLogoType(buffer);
  if (!contentType) throw new LogoError('unsupported_type');
  try {
    const result =
      contentType === 'image/png'
        ? sanitizePng(buffer)
        : contentType === 'image/jpeg'
          ? sanitizeJpeg(buffer)
          : sanitizeWebp(buffer);
    return {
      ...result,
      contentType,
      extension:
        contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp',
      hash: createHash('sha256').update(result.bytes).digest('hex').slice(0, 32),
    };
  } catch (error) {
    if (error instanceof LogoError) throw error;
    throw corrupt(); // RangeError from truncated buffers
  }
}

/** Object name inside the `branding` bucket; matches `app.branding_object_org` and the table check. */
export function logoObjectPath(
  organizationId: string,
  logo: Pick<SanitizedLogo, 'hash' | 'extension'>,
) {
  return `${organizationId}/logo-${logo.hash}.${logo.extension}`;
}
