/**
 * Identifies a file from its first bytes (magic numbers). The client's declared
 * MIME type and file name are never trusted.
 */
export type DetectedType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf';

export const IMAGE_TYPES: readonly DetectedType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];
export const DOCUMENT_TYPES: readonly DetectedType[] = [...IMAGE_TYPES, 'application/pdf'];

export const EXTENSION: Record<DetectedType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf: Buffer, start: number, end: number) =>
  buf.subarray(start, end).toString('latin1');

export function detectFileType(buf: Buffer): DetectedType | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(buf, 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)$/.test(ascii(buf, 8, 12))) {
    return 'image/heic';
  }
  if (ascii(buf, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
