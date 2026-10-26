import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter that applies the same CORS allow-list as the REST API, and relays
 * events through Redis so the worker process (and further API instances) can reach clients.
 */
export class CorsIoAdapter extends IoAdapter {
  private readonly clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
    private readonly redis?: { client: Redis; key: string },
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const withCors = {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    } as ServerOptions;
    const server: Server = super.createIOServer(port, withCors);
    if (this.redis) {
      const pub = this.redis.client.duplicate();
      const sub = this.redis.client.duplicate();
      this.clients.push(pub, sub);
      server.adapter(createAdapter(pub, sub, { key: this.redis.key }));
    }
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.clients.splice(0).map((c) => c.quit().catch(() => c.disconnect())));
  }
}
