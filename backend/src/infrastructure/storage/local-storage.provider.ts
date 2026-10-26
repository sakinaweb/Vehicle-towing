import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertSafeKey, StorageProvider, StoredObject } from './storage-provider.js';

/**
 * Development storage on the local disk. Refused in production by env validation
 * (files would live on one server and vanish with it). Content types are kept in
 * a sidecar file so reads return what was written.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(`${path}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<StoredObject> {
    const path = this.pathOf(key);
    const info = await stat(path);
    const meta = JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as { contentType: string };
    return { body: createReadStream(path), contentType: meta.contentType, sizeBytes: info.size };
  }

  async delete(key: string): Promise<void> {
    const path = this.pathOf(key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
  }

  private pathOf(key: string): string {
    assertSafeKey(key);
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root)) throw new Error('Storage key escapes the storage root');
    return path;
  }
}
