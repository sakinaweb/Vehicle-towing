import type { Readable } from 'node:stream';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StoredObject {
  body: Readable;
  contentType: string;
  sizeBytes: number;
}

/**
 * Private object storage for user files (inspection photos, KYC documents).
 * Objects are addressed by server-generated keys only; files are never public —
 * the API streams them to authorised callers.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

/** Keys are built by the server: lowercase segments of [a-z0-9-_.] separated by "/". */
export function assertSafeKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9\-_.]*(\/[a-z0-9][a-z0-9\-_.]*)*$/.test(key) || key.includes('..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
