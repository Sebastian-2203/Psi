import { deflateSync, crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  LOGO_MAX_BYTES,
  LogoError,
  logoObjectPath,
  sanitizeLogo,
  sniffLogoType,
} from '@/modules/branding/server/logo';

/** Builds tiny valid fixtures in memory (FICTIONAL images; nothing on disk). */

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width = 32, height = 32, extra: Buffer[] = [], trailer = Buffer.alloc(0)): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (1 + width * 3), 0x7f);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...extra,
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
    trailer,
  ]);
}

function seg(marker: number, data: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, data]);
}

function jpeg(width = 32, height = 32, trailer = Buffer.alloc(0)): Buffer {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, Buffer.from('Exif\0\0GPS-SECRET', 'latin1')),
    seg(0xfe, Buffer.from('a comment', 'latin1')),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xc0, sof),
    seg(0xda, sos),
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    Buffer.from([0xff, 0xd9]),
    trailer,
  ]);
}

function riff(chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function webp(width = 32, height = 32, withMetadata = false): Buffer {
  const vp8l = Buffer.alloc(8);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  if (!withMetadata) return riff([webpChunk('VP8L', vp8l)]);
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04 | 0x10; // EXIF + XMP + alpha flags
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  return riff([
    webpChunk('VP8X', vp8x),
    webpChunk('VP8L', vp8l),
    webpChunk('EXIF', Buffer.from('GPS-SECRET')),
    webpChunk('XMP ', Buffer.from('<x:xmpmeta/>')),
  ]);
}

const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof LogoError) return error.reason;
    throw error;
  }
  return 'none';
};

describe('sniffLogoType (magic bytes)', () => {
  it('recognises PNG, JPEG and WebP regardless of any declared type', () => {
    expect(sniffLogoType(png())).toBe('image/png');
    expect(sniffLogoType(jpeg())).toBe('image/jpeg');
    expect(sniffLogoType(webp())).toBe('image/webp');
  });
  it('rejects SVG, HTML, GIF and empty input', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect(sniffLogoType(svg)).toBeNull();
    expect(sniffLogoType(Buffer.from('<!doctype html><script>1</script>'))).toBeNull();
    expect(sniffLogoType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffLogoType(Buffer.alloc(0))).toBeNull();
  });
});

describe('sanitizeLogo', () => {
  it('re-writes PNG without text/EXIF chunks and without trailing bytes', () => {
    const dirty = png(
      40,
      24,
      [pngChunk('tEXt', Buffer.from('Comment\0secret')), pngChunk('eXIf', Buffer.from('GPS'))],
      Buffer.from('<script>alert(1)</script>'),
    );
    const clean = sanitizeLogo(dirty);
    expect(clean).toMatchObject({
      contentType: 'image/png',
      extension: 'png',
      width: 40,
      height: 24,
    });
    const text = clean.bytes.toString('latin1');
    expect(text).not.toContain('tEXt');
    expect(text).not.toContain('eXIf');
    expect(text).not.toContain('script');
    expect(sniffLogoType(clean.bytes)).toBe('image/png');
    expect(clean.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('removes JPEG APP1 (EXIF/GPS), comments and trailing bytes; keeps JFIF and the scan', () => {
    const clean = sanitizeLogo(jpeg(64, 48, Buffer.from('<script>x</script>')));
    expect(clean).toMatchObject({
      contentType: 'image/jpeg',
      extension: 'jpg',
      width: 64,
      height: 48,
    });
    const text = clean.bytes.toString('latin1');
    expect(text).not.toContain('GPS-SECRET');
    expect(text).not.toContain('a comment');
    expect(text).not.toContain('script');
    expect(text).toContain('JFIF');
    expect(clean.bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it('drops WebP EXIF/XMP chunks and clears their flags', () => {
    const clean = sanitizeLogo(webp(20, 30, true));
    expect(clean).toMatchObject({
      contentType: 'image/webp',
      extension: 'webp',
      width: 20,
      height: 30,
    });
    const text = clean.bytes.toString('latin1');
    expect(text).not.toContain('EXIF');
    expect(text).not.toContain('XMP');
    expect(text).not.toContain('GPS-SECRET');
    const vp8x = clean.bytes.indexOf('VP8X');
    expect(clean.bytes[vp8x + 8]! & (0x08 | 0x04)).toBe(0);
    expect(clean.bytes.readUInt32LE(4)).toBe(clean.bytes.length - 8);
  });

  it('is deterministic: same input -> same content-addressed name', () => {
    const a = sanitizeLogo(png());
    const b = sanitizeLogo(png());
    expect(a.hash).toBe(b.hash);
    expect(logoObjectPath('0a000000-0000-4000-8000-000000000001', a)).toBe(
      `0a000000-0000-4000-8000-000000000001/logo-${a.hash}.png`,
    );
  });

  it('rejects SVG and other types by content, whatever the file name says', () => {
    expect(
      reason(() => sanitizeLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
    ).toBe('unsupported_type');
    expect(reason(() => sanitizeLogo(Buffer.from('GIF89a\x01\0\x01\0')))).toBe('unsupported_type');
  });

  it('rejects oversized, empty, truncated and tampered files', () => {
    expect(reason(() => sanitizeLogo(Buffer.alloc(LOGO_MAX_BYTES + 1, 0)))).toBe('too_large');
    expect(reason(() => sanitizeLogo(Buffer.alloc(0)))).toBe('corrupt');
    expect(reason(() => sanitizeLogo(png().subarray(0, 60)))).toBe('corrupt');
    const bad = Buffer.from(png());
    bad[40] = bad[40]! ^ 0xff; // flips a byte inside a CRC-protected chunk
    expect(reason(() => sanitizeLogo(bad))).toBe('corrupt');
    expect(reason(() => sanitizeLogo(jpeg().subarray(0, 120)))).toBe('corrupt');
    expect(reason(() => sanitizeLogo(webp().subarray(0, 14)))).toBe('corrupt');
  });

  it('bounds dimensions', () => {
    expect(reason(() => sanitizeLogo(png(8, 8)))).toBe('dimensions');
    expect(reason(() => sanitizeLogo(png(4096, 16)))).toBe('dimensions');
    expect(reason(() => sanitizeLogo(jpeg(5000, 100)))).toBe('dimensions');
    expect(reason(() => sanitizeLogo(webp(16384, 100)))).toBe('dimensions');
  });
});
