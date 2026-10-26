import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectFileType } from './file-type.js';
import { LocalStorageProvider } from './local-storage.provider.js';
import { assertSafeKey } from './storage-provider.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('detectFileType', () => {
  it('recognises images and PDFs by their bytes', () => {
    expect(detectFileType(JPEG)).toBe('image/jpeg');
    expect(detectFileType(PNG)).toBe('image/png');
    expect(detectFileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectFileType(Buffer.from('\0\0\0\x18ftypheic\0\0'))).toBe('image/heic');
    expect(detectFileType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('rejects anything else, whatever its name claims', () => {
    expect(detectFileType(Buffer.from('MZ\x90\0'))).toBeNull(); // Windows executable
    expect(detectFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe('storage keys', () => {
  it.each(['bookings/abc/pickup/1.jpg', 'drivers/x-1/emirates_id.pdf'])('accepts %s', (key) => {
    expect(() => assertSafeKey(key)).not.toThrow();
  });

  it.each(['../etc/passwd', '/abs/path', 'a/../b', 'Upper/Case', 'a//b', 'a/b/'])(
    'rejects %s',
    (key) => {
      expect(() => assertSafeKey(key)).toThrow(/Unsafe storage key/);
    },
  );
});

describe('LocalStorageProvider', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'townow-storage-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips bytes and content type, then deletes', async () => {
    const storage = new LocalStorageProvider(dir);
    await storage.put('bookings/b1/pickup/front.jpg', JPEG, 'image/jpeg');
    const obj = await storage.get('bookings/b1/pickup/front.jpg');
    const chunks: Buffer[] = [];
    for await (const c of obj.body) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks)).toEqual(JPEG);
    expect(obj).toMatchObject({ contentType: 'image/jpeg', sizeBytes: JPEG.length });

    await storage.delete('bookings/b1/pickup/front.jpg');
    await expect(storage.get('bookings/b1/pickup/front.jpg')).rejects.toThrow();
  });

  it('refuses keys that would escape its folder', async () => {
    await expect(
      new LocalStorageProvider(dir).put('../escape.jpg', JPEG, 'image/jpeg'),
    ).rejects.toThrow();
  });
});
