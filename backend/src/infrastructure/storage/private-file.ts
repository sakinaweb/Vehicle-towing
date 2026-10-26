import { StreamableFile } from '@nestjs/common';
import type { StoredObject } from './storage-provider.js';

/** Streams a stored file to its authorised caller; never cached by shared proxies. */
export function privateFile(obj: StoredObject): StreamableFile {
  return new StreamableFile(obj.body, {
    type: obj.contentType,
    length: obj.sizeBytes || undefined,
    disposition: 'inline',
  });
}
