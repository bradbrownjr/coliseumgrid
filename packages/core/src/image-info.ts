// Reads an uploaded picture's type, width, and height from its own bytes (docs/PLAN.md, "The
// event graphic"). The server takes the host's upload only when this agrees with the declared
// Content-Type and the size is in range, so the picture is never decoded and no image library
// is needed. Each layout below was read from its published spec before this file was written
// (2026-11-15):
//
// - PNG: W3C, Portable Network Graphics (PNG) Specification (Third Edition),
//   https://www.w3.org/TR/png/. Section 5.2: the 8-byte signature 89 50 4E 47 0D 0A 1A 0A.
//   Section 5.3: a chunk is a 4-byte length, a 4-byte type, the data, and a 4-byte CRC; the
//   length counts the data only. Section 7.1: integers are big-endian (network byte order), and
//   a four-byte unsigned integer is 0 to 2^31 - 1. Section 11.2.1: IHDR comes first, its data
//   is 13 bytes starting with the width and the height, and "Zero is an invalid value."
// - JPEG: ITU-T Recommendation T.81 (09/92), https://www.w3.org/Graphics/JPEG/itu-t81.pdf,
//   read from the PDF itself. B.1.1.2: a marker is X'FF' and a byte that is neither 0 nor X'FF',
//   and "Any marker may optionally be preceded by any number of fill bytes" of X'FF'. B.1.1.3
//   and Table B.1: SOF0 to SOF15 are X'FFC0' to X'FFCF' except DHT (C4), JPG (C8), and DAC
//   (CC); RST0 to RST7 (D0 to D7), SOI (D8), EOI (D9), and TEM (01) stand alone, with no
//   length. B.1.1.4: a marker segment starts with a 2-byte length that counts itself but not
//   the marker. B.1.1.5: inside entropy-coded data, an X'FF' is followed by a stuffed zero
//   byte. B.2.2 and Figure B.3: the frame header is Lf (2 bytes), P (1), Y, the number of
//   lines (2), and X, the samples per line (2), most significant byte first (B.1.1.1).
// - WebP container: Google, WebP Container Specification,
//   https://developers.google.com/speed/webp/docs/riff_container. The file is 'RIFF', a
//   little-endian uint32 file size counted from offset 8, and 'WEBP'. A chunk is a FourCC and
//   a little-endian uint32 size that leaves out the header and the padding; an odd size is
//   followed by one zero byte. 'VP8X' has 4 bytes of flags and reserved bits, then the canvas
//   width minus one and height minus one, 24 bits each, and their product "MUST be at most
//   2^32 - 1".
// - VP8 (the 'VP8 ' chunk): RFC 6386, section 9.1 and 19.1,
//   https://www.rfc-editor.org/rfc/rfc6386. A 3-byte frame tag whose lowest bit is 0 for a key
//   frame, the start code 9D 01 2A, then the width and height as 16-bit little-endian values
//   whose low 14 bits are the size and top 2 bits a scale (19.1 reads them as
//   `(c[1] << 8) | c[0]`).
// - VP8L (the 'VP8L' chunk): Google, WebP Lossless Bitstream Specification, section 3,
//   https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification. The
//   signature byte 0x2F, then 14 bits of width minus one, 14 of height minus one, 1 alpha hint,
//   and a 3-bit version that must be 0, read least significant bit first (section 1).
//
// Every read is checked against the length first, so a cut-off or lying file is a refusal,
// never an exception or a read past the end. Beyond the header, the parser walks the file's
// structure to its end (PNG to IEND, JPEG to EOI, WebP to the RIFF size), so a file cut off
// anywhere is refused, not only one cut inside its header. Bytes after the end are ignored.

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/**
 * Why a file was refused. `not-an-image`: it doesn't start like a PNG, JPEG, or WebP (an SVG,
 * for one). `cut-off`: it ends before its structure does. `bad-header`: it starts right but
 * breaks its format's rules, or has no size, or a size of zero.
 */
export type ImageRefusal = 'not-an-image' | 'cut-off' | 'bad-header';

export type ImageInfo =
  | { ok: true; type: ImageType; width: number; height: number }
  | { ok: false; reason: ImageRefusal };

type Bytes = Uint8Array;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// The largest PNG four-byte unsigned integer (section 7.1).
const PNG_INT_MAX = 2 ** 31 - 1;

const refuse = (reason: ImageRefusal): ImageInfo => ({ ok: false, reason });

/** True when `count` bytes from `at` are inside `bytes`. */
const has = (bytes: Bytes, at: number, count: number): boolean => at >= 0 && count >= 0 && at + count <= bytes.length;

// The readers below are only called after `has` said the bytes are there, so `?? 0` never
// happens; it only satisfies noUncheckedIndexedAccess.
const byte = (bytes: Bytes, at: number): number => bytes[at] ?? 0;
const be16 = (bytes: Bytes, at: number): number => byte(bytes, at) * 0x100 + byte(bytes, at + 1);
const be32 = (bytes: Bytes, at: number): number => be16(bytes, at) * 0x10000 + be16(bytes, at + 2);
const le16 = (bytes: Bytes, at: number): number => byte(bytes, at) + byte(bytes, at + 1) * 0x100;
const le24 = (bytes: Bytes, at: number): number => le16(bytes, at) + byte(bytes, at + 2) * 0x10000;
const le32 = (bytes: Bytes, at: number): number => le24(bytes, at) + byte(bytes, at + 3) * 0x1000000;
const ascii = (bytes: Bytes, at: number, count: number): string => String.fromCharCode(...bytes.subarray(at, at + count));

/**
 * How `bytes` compares with a magic number placed at `at`: 'match', 'short' when the bytes end
 * partway through it but agree so far, or 'differ'.
 */
function magic(bytes: Bytes, at: number, expected: readonly number[]): 'match' | 'short' | 'differ' {
  for (let i = 0; i < expected.length; i++) {
    if (at + i >= bytes.length) return 'short';
    if (bytes[at + i] !== expected[i]) return 'differ';
  }
  return 'match';
}

const sized = (type: ImageType, width: number, height: number): ImageInfo =>
  width === 0 || height === 0 ? refuse('bad-header') : { ok: true, type, width, height };

function png(bytes: Bytes): ImageInfo {
  let at = PNG_SIGNATURE.length;
  let size: { width: number; height: number } | undefined;
  for (;;) {
    if (!has(bytes, at, 8)) return refuse('cut-off');
    const length = be32(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    if (length > PNG_INT_MAX) return refuse('bad-header');
    if (size === undefined) {
      if (type !== 'IHDR' || length !== 13) return refuse('bad-header');
      if (!has(bytes, at + 8, 8)) return refuse('cut-off');
      size = { width: be32(bytes, at + 8), height: be32(bytes, at + 12) };
      if (size.width > PNG_INT_MAX || size.height > PNG_INT_MAX) return refuse('bad-header');
    }
    // The chunk's header, its data, and its CRC.
    if (!has(bytes, at, 12 + length)) return refuse('cut-off');
    if (type === 'IEND') return sized('image/png', size.width, size.height);
    at += 12 + length;
  }
}

// T.81 Table B.1.
const EOI = 0xd9;
const SOI = 0xd8;
const SOS = 0xda;
const TEM = 0x01;
const isRestart = (marker: number): boolean => marker >= 0xd0 && marker <= 0xd7;
const isStartOfFrame = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpeg(bytes: Bytes): ImageInfo {
  let at = 2; // past SOI
  let size: { width: number; height: number } | undefined;
  let inScan = false;
  for (;;) {
    if (inScan) {
      // Entropy-coded data runs until a marker. FF 00 is a stuffed data byte, a restart marker
      // stays inside the scan, and FF FF is a fill byte before the marker that ends it.
      for (;;) {
        if (!has(bytes, at, 1)) return refuse('cut-off');
        if (byte(bytes, at) !== 0xff) {
          at += 1;
          continue;
        }
        if (!has(bytes, at, 2)) return refuse('cut-off');
        const next = byte(bytes, at + 1);
        if (next === 0x00 || isRestart(next)) at += 2;
        else if (next === 0xff) at += 1;
        else break;
      }
      inScan = false;
    }
    // A marker: X'FF', any number of fill bytes, then its code.
    if (!has(bytes, at, 1)) return refuse('cut-off');
    if (byte(bytes, at) !== 0xff) return refuse('bad-header');
    while (has(bytes, at, 1) && byte(bytes, at) === 0xff) at += 1;
    if (!has(bytes, at, 1)) return refuse('cut-off');
    const marker = byte(bytes, at);
    at += 1;
    if (marker === 0x00 || marker === SOI) return refuse('bad-header');
    if (marker === EOI) return size === undefined ? refuse('bad-header') : sized('image/jpeg', size.width, size.height);
    if (isRestart(marker) || marker === TEM) continue;
    // A marker segment: its length counts itself and what follows, not the marker.
    if (!has(bytes, at, 2)) return refuse('cut-off');
    const length = be16(bytes, at);
    if (length < 2) return refuse('bad-header');
    if (!has(bytes, at, length)) return refuse('cut-off');
    if (isStartOfFrame(marker) && size === undefined) {
      // Lf, P, Y, X, Nf: 8 bytes before the components.
      if (length < 8) return refuse('bad-header');
      // Y of 0 means the line count comes later in a DNL segment; `sized` refuses it, since the
      // header then has no height to check.
      size = { height: be16(bytes, at + 3), width: be16(bytes, at + 5) };
    }
    if (marker === SOS) {
      // A scan before any frame header breaks B.2's order.
      if (size === undefined) return refuse('bad-header');
      inScan = true;
    }
    at += length;
  }
}

const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const VP8_START_CODE = [0x9d, 0x01, 0x2a];
const VP8L_SIGNATURE = 0x2f;

function webp(bytes: Bytes): ImageInfo {
  // The RIFF size counts from offset 8, so the file's structure ends at 8 + size.
  const end = 8 + le32(bytes, 4);
  if (end > bytes.length) return refuse('cut-off');
  const at = 12;
  if (!has(bytes, at, 8) || at + 8 > end) return refuse('bad-header');
  const fourCc = ascii(bytes, at, 4);
  const size = le32(bytes, at + 4);
  const data = at + 8;
  if (data + size > end) return refuse('bad-header');

  let info: ImageInfo;
  if (fourCc === 'VP8 ') {
    if (size < 10) return refuse('bad-header');
    // A still picture is one key frame: the frame tag's lowest bit is 0.
    if ((byte(bytes, data) & 1) !== 0 || magic(bytes, data + 3, VP8_START_CODE) !== 'match') return refuse('bad-header');
    info = sized('image/webp', le16(bytes, data + 6) & 0x3fff, le16(bytes, data + 8) & 0x3fff);
  } else if (fourCc === 'VP8L') {
    if (size < 5 || byte(bytes, data) !== VP8L_SIGNATURE) return refuse('bad-header');
    const bits = le32(bytes, data + 1);
    if (bits >>> 29 !== 0) return refuse('bad-header');
    info = sized('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  } else if (fourCc === 'VP8X') {
    if (size < 10) return refuse('bad-header');
    const width = le24(bytes, data + 4) + 1;
    const height = le24(bytes, data + 7) + 1;
    if (width * height > 2 ** 32 - 1) return refuse('bad-header');
    info = sized('image/webp', width, height);
  } else {
    return refuse('bad-header');
  }

  // The rest of the chunks must fit inside the RIFF size. A missing pad byte after the last
  // chunk is let through.
  let next = data + size + (size & 1);
  while (next < end) {
    if (next + 8 > end) return refuse('bad-header');
    const chunkSize = le32(bytes, next + 4);
    if (next + 8 + chunkSize > end) return refuse('bad-header');
    next += 8 + chunkSize + (chunkSize & 1);
  }
  return info;
}

/**
 * The type, width, and height of a PNG, JPEG, or WebP file, read from its header, or why it
 * was refused. Pure: it reads only `bytes`.
 */
export function imageInfo(bytes: Uint8Array): ImageInfo {
  const pngMagic = magic(bytes, 0, PNG_SIGNATURE);
  if (pngMagic === 'match') return png(bytes);
  const jpegMagic = magic(bytes, 0, [0xff, SOI]);
  if (jpegMagic === 'match') return jpeg(bytes);
  // 'RIFF', 4 bytes of size, 'WEBP'.
  const riffMagic = magic(bytes, 0, RIFF);
  const webpMagic = bytes.length < 8 ? 'short' : magic(bytes, 8, WEBP);
  if (riffMagic === 'match' && webpMagic === 'match') return webp(bytes);
  const started = pngMagic === 'short' || jpegMagic === 'short' || (riffMagic !== 'differ' && webpMagic !== 'differ');
  return refuse(started && bytes.length > 0 ? 'cut-off' : 'not-an-image');
}
