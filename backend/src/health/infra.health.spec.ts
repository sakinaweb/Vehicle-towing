import { withTimeout } from './infra.health.js';

describe('withTimeout', () => {
  it('passes through a result that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('PONG'), 50)).resolves.toBe('PONG');
  });

  it('rejects when the dependency hangs', async () => {
    const hanging = new Promise<never>(() => undefined);
    await expect(withTimeout(hanging, 20)).rejects.toThrow('Timed out after 20 ms');
  });

  it('keeps the original error when the dependency fails fast', async () => {
    await expect(withTimeout(Promise.reject(new Error('ECONNREFUSED')), 50)).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});
