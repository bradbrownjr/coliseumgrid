// imageInfo (src/image-info.ts): real files of each kind, every truncation of each, and
// hand-built files that break the rules. The fixtures and how they were made are in
// test/fixtures/README.md.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { imageInfo, type ImageInfo } from '../src/index.ts';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

const FIXTURES = [
  { name: 'graphic.png', type: 'image/png', width: 48, height: 32 },
  { name: 'baseline.jpg', type: 'image/jpeg', width: 40, height: 24 },
  { name: 'progressive.jpg', type: 'image/jpeg', width: 64, height: 48 },
  { name: 'lossy.webp', type: 'image/webp', width: 50, height: 30 },
  { name: 'lossless.webp', type: 'image/webp', width: 33, height: 17 },
  { name: 'extended.webp', type: 'image/webp', width: 70, height: 20 },
] as const;

const refused = (info: ImageInfo): string | undefined => (info.ok ? undefined : info.reason);

/** A copy of `bytes` with `patch` written at `at`. */
function patched(bytes: Uint8Array, at: number, patch: number[]): Uint8Array {
  const copy = bytes.slice();
  copy.set(patch, at);
  return copy;
}

const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const be16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
const le24 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const le32 = (n: number): number[] => [...le24(n), (n >>> 24) & 0xff];
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
/** Where a byte pattern first occurs. */
function find(bytes: Uint8Array, pattern: number[]): number {
  for (let i = 0; i + pattern.length <= bytes.length; i++) if (pattern.every((b, j) => bytes[i + j] === b)) return i;
  throw new Error(`pattern ${pattern.join(',')} not found`);
}

describe('imageInfo on real files', () => {
  it.each(FIXTURES)('reads $name as $type, $width x $height', ({ name, type, width, height }) => {
    expect(imageInfo(fixture(name))).toEqual({ ok: true, type, width, height });
  });

  it('the fixtures cover each layout the parser reads', () => {
    const at = (name: string, pattern: number[]): number => find(fixture(name), pattern);
    expect(at('lossy.webp', text('VP8 '))).toBe(12);
    expect(at('lossless.webp', text('VP8L'))).toBe(12);
    expect(at('extended.webp', text('VP8X'))).toBe(12);
    // SOF0 in the baseline file and SOF2 in the progressive one.
    expect(at('baseline.jpg', [0xff, 0xc0])).toBeGreaterThan(2);
    expect(at('progressive.jpg', [0xff, 0xc2])).toBeGreaterThan(2);
    // The baseline file has restart markers inside its scan, and the progressive file a DHT
    // between its scans, so the walk to EOI passes both.
    expect(at('baseline.jpg', [0xff, 0xd0])).toBeGreaterThan(at('baseline.jpg', [0xff, 0xda]));
    const progressive = fixture('progressive.jpg');
    const firstScan = find(progressive, [0xff, 0xda]);
    expect(find(progressive.subarray(firstScan), [0xff, 0xc4])).toBeGreaterThan(0);
  });

  it('ignores bytes after the end of the file structure', () => {
    for (const { name, type, width, height } of FIXTURES) {
      const bytes = fixture(name);
      const longer = new Uint8Array(bytes.length + 7);
      longer.set(bytes);
      expect(imageInfo(longer), name).toEqual({ ok: true, type, width, height });
    }
  });
});

describe('imageInfo refuses', () => {
  it.each(FIXTURES)('$name cut off at every byte, without throwing', ({ name }) => {
    const bytes = fixture(name);
    for (let length = 0; length < bytes.length; length++) {
      const info = imageInfo(bytes.subarray(0, length));
      expect(info.ok, `${name} cut to ${length} bytes`).toBe(false);
      expect(refused(info), `${name} cut to ${length} bytes`).toBe(length === 0 ? 'not-an-image' : 'cut-off');
    }
  });

  it('an SVG and other files that are not pictures', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>');
    expect(refused(imageInfo(svg))).toBe('not-an-image');
    expect(refused(imageInfo(new TextEncoder().encode('GIF89a\x10\x00\x10\x00')))).toBe('not-an-image');
    expect(refused(imageInfo(new Uint8Array(64)))).toBe('not-an-image');
    // A RIFF file that isn't WebP (a WAVE header).
    expect(refused(imageInfo(new Uint8Array([...text('RIFF'), ...le32(4), ...text('WAVE')])))).toBe('not-an-image');
  });

  it('a wrong magic number by one byte', () => {
    for (const name of ['graphic.png', 'baseline.jpg', 'lossy.webp']) {
      const bytes = fixture(name);
      expect(refused(imageInfo(patched(bytes, 1, [(bytes[1] ?? 0) ^ 0x01]))), name).toBe('not-an-image');
    }
    expect(refused(imageInfo(patched(fixture('lossy.webp'), 9, [0])))).toBe('not-an-image');
  });

  describe('PNG', () => {
    const png = fixture('graphic.png');
    it('a zero width or height', () => {
      expect(refused(imageInfo(patched(png, 16, be32(0))))).toBe('bad-header');
      expect(refused(imageInfo(patched(png, 20, be32(0))))).toBe('bad-header');
    });
    it('a size over 2^31 - 1', () => {
      expect(refused(imageInfo(patched(png, 16, be32(2 ** 31))))).toBe('bad-header');
    });
    it('reads sizes at the edges of the upload range', () => {
      for (const n of [15, 16, 4000, 4001]) expect(imageInfo(patched(png, 16, be32(n)))).toMatchObject({ ok: true, width: n, height: 32 });
    });
    it('a first chunk that is not a 13-byte IHDR', () => {
      expect(refused(imageInfo(patched(png, 12, text('IDAT'))))).toBe('bad-header');
      expect(refused(imageInfo(patched(png, 8, be32(12))))).toBe('bad-header');
    });
    it('a chunk length past the end of the file', () => {
      const after = 8 + 12 + 13;
      expect(refused(imageInfo(patched(png, after, be32(0x7fffffff))))).toBe('cut-off');
      expect(refused(imageInfo(patched(png, after, be32(0x80000000))))).toBe('bad-header');
    });
    it('a file with no IEND', () => {
      const iend = find(png, text('IEND')) - 4;
      expect(refused(imageInfo(png.subarray(0, iend)))).toBe('cut-off');
    });
  });

  describe('JPEG', () => {
    const jpeg = fixture('baseline.jpg');
    const sof = find(jpeg, [0xff, 0xc0]);
    it('a zero width, and a zero height (a line count left to a DNL segment)', () => {
      expect(refused(imageInfo(patched(jpeg, sof + 7, be16(0))))).toBe('bad-header');
      expect(refused(imageInfo(patched(jpeg, sof + 5, be16(0))))).toBe('bad-header');
    });
    it('reads the frame header that follows fill bytes', () => {
      // FF FF FF C0: two fill bytes before the SOF0 marker (T.81 B.1.1.2).
      const filled = new Uint8Array([...jpeg.subarray(0, sof), 0xff, 0xff, ...jpeg.subarray(sof)]);
      expect(imageInfo(filled)).toEqual({ ok: true, type: 'image/jpeg', width: 40, height: 24 });
    });
    it('passes a standalone marker between segments', () => {
      // An RST0 before the frame header has no length to skip.
      const withRestart = new Uint8Array([...jpeg.subarray(0, sof), 0xff, 0xd0, ...jpeg.subarray(sof)]);
      expect(imageInfo(withRestart)).toMatchObject({ ok: true, width: 40, height: 24 });
    });
    it('skips DHT, JPG, and DAC segments, which are not frame headers', () => {
      // A segment with the marker C4, C8, or CC before SOF0 whose bytes would read as a 1 x 1
      // frame if the parser took it for one.
      for (const marker of [0xc4, 0xc8, 0xcc]) {
        const segment = [0xff, marker, ...be16(10), 8, ...be16(1), ...be16(1), 1, 0, 0];
        const bytes = new Uint8Array([...jpeg.subarray(0, sof), ...segment, ...jpeg.subarray(sof)]);
        expect(imageInfo(bytes), marker.toString(16)).toMatchObject({ ok: true, width: 40, height: 24 });
      }
    });
    it('a scan before the frame header', () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, ...be16(2), 0x12, 0x34, 0xff, 0xd9]);
      expect(refused(imageInfo(bytes))).toBe('bad-header');
    });
    it('an EOI with no frame', () => {
      expect(refused(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])))).toBe('bad-header');
    });
    it('a byte between segments that is not a marker', () => {
      const bytes = new Uint8Array([...jpeg.subarray(0, sof), 0x00, ...jpeg.subarray(sof)]);
      expect(refused(imageInfo(bytes))).toBe('bad-header');
    });
    it('FF 00 or a second SOI where a marker should be', () => {
      expect(refused(imageInfo(patched(jpeg, sof, [0xff, 0x00])))).toBe('bad-header');
      expect(refused(imageInfo(patched(jpeg, sof, [0xff, 0xd8])))).toBe('bad-header');
    });
    it('a segment length under 2, a frame header under 8 bytes, and a length past the end', () => {
      expect(refused(imageInfo(patched(jpeg, sof + 2, be16(1))))).toBe('bad-header');
      const short = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, ...be16(7), 8, 0, 16, 0, 16, 0xff, 0xd9]);
      expect(refused(imageInfo(short))).toBe('bad-header');
      expect(refused(imageInfo(patched(jpeg, sof + 2, be16(0xffff))))).toBe('cut-off');
    });
    it('a file that ends in its scan with no EOI', () => {
      expect(refused(imageInfo(jpeg.subarray(0, jpeg.length - 2)))).toBe('cut-off');
    });
  });

  describe('WebP', () => {
    const lossy = fixture('lossy.webp');
    const lossless = fixture('lossless.webp');
    const extended = fixture('extended.webp');
    it('a lossy width or height of zero', () => {
      expect(refused(imageInfo(patched(lossy, 26, le16(0))))).toBe('bad-header');
      expect(refused(imageInfo(patched(lossy, 28, le16(0))))).toBe('bad-header');
    });
    it('reads only the 14 size bits of a lossy frame, not the scale', () => {
      expect(imageInfo(patched(lossy, 26, le16((2 << 14) | 50)))).toMatchObject({ ok: true, width: 50, height: 30 });
    });
    it('a lossy frame that is not a key frame, or has no start code', () => {
      expect(refused(imageInfo(patched(lossy, 20, [(lossy[20] ?? 0) | 1])))).toBe('bad-header');
      expect(refused(imageInfo(patched(lossy, 23, [0x9c])))).toBe('bad-header');
    });
    it('a lossless header without its signature or with a version other than 0', () => {
      expect(refused(imageInfo(patched(lossless, 20, [0x2e])))).toBe('bad-header');
      expect(refused(imageInfo(patched(lossless, 24, [(lossless[24] ?? 0) | 0x20])))).toBe('bad-header');
    });
    it('reads the lossless size at the edges of the upload range', () => {
      // 14 bits of width minus one, then 14 of height minus one, least significant bit first.
      const bits = (w: number, h: number): number[] => le32((w - 1) | ((h - 1) << 14));
      for (const [w, h] of [[15, 16], [16, 4000], [4001, 16]] as const) {
        expect(imageInfo(patched(lossless, 21, bits(w, h)))).toMatchObject({ ok: true, width: w, height: h });
      }
    });
    it('reads the extended canvas size, and refuses a canvas over 2^32 - 1 pixels', () => {
      expect(imageInfo(patched(extended, 24, [...le24(3999), ...le24(15)]))).toMatchObject({ ok: true, width: 4000, height: 16 });
      expect(refused(imageInfo(patched(extended, 24, [...le24(0xffffff), ...le24(0xffffff)])))).toBe('bad-header');
    });
    it('a first chunk that is not VP8, VP8L, or VP8X', () => {
      expect(refused(imageInfo(patched(lossy, 12, text('ALPH'))))).toBe('bad-header');
    });
    it('a RIFF size past the end, and a chunk past the RIFF size', () => {
      expect(refused(imageInfo(patched(lossy, 4, le32(lossy.length))))).toBe('cut-off');
      expect(refused(imageInfo(patched(lossy, 16, le32(lossy.length))))).toBe('bad-header');
      // The VP8X file's later chunks: one that claims more than the RIFF size holds.
      const alph = find(extended, text('ALPH'));
      expect(refused(imageInfo(patched(extended, alph + 4, le32(extended.length))))).toBe('bad-header');
    });
    it('a chunk too short for its header', () => {
      expect(refused(imageInfo(patched(lossy, 16, le32(9))))).toBe('bad-header');
      expect(refused(imageInfo(patched(lossless, 16, le32(4))))).toBe('bad-header');
      expect(refused(imageInfo(patched(extended, 16, le32(9))))).toBe('bad-header');
    });
  });
});
