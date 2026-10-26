import { createPublicKey, createVerify, generateKeyPairSync, KeyObject } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface SentPush {
  token: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
}

/**
 * Stand-in for Google's OAuth token endpoint and FCM HTTP v1. Verifies the service-account
 * JWT signature like Google would; tokens starting with "dead" answer UNREGISTERED.
 */
export class FakeFcm {
  readonly sent: SentPush[] = [];
  readonly privateKeyPem: string;
  private readonly publicKey: KeyObject;
  private server!: Server;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.publicKey = createPublicKey(publicKey.export({ type: 'spki', format: 'pem' }));
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void this.read(req).then((body) => {
        const [status, json] = this.route(req, body);
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  to(token: string): SentPush[] {
    return this.sent.filter((s) => s.token === token);
  }

  private route(req: IncomingMessage, body: string): [number, unknown] {
    if (req.method === 'POST' && req.url === '/token') {
      const assertion = new URLSearchParams(body).get('assertion') ?? '';
      const [header, claims, sig] = assertion.split('.');
      const ok = createVerify('RSA-SHA256')
        .update(`${header}.${claims}`)
        .verify(this.publicKey, Buffer.from(sig ?? '', 'base64url'));
      if (!ok) return [400, { error: 'invalid_grant' }];
      return [200, { access_token: 'fake-access-token', expires_in: 3600 }];
    }
    if (req.method === 'POST' && /^\/v1\/projects\/[^/]+\/messages:send$/.test(req.url ?? '')) {
      if (req.headers.authorization !== 'Bearer fake-access-token') return [401, {}];
      const { message } = JSON.parse(body) as { message: SentPush };
      if (message.token.startsWith('dead')) {
        return [
          404,
          {
            error: {
              message: 'Requested entity was not found.',
              details: [{ errorCode: 'UNREGISTERED' }],
            },
          },
        ];
      }
      this.sent.push(message);
      return [200, { name: `projects/x/messages/${this.sent.length}` }];
    }
    return [404, {}];
  }

  private read(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => resolve(data));
    });
  }
}
