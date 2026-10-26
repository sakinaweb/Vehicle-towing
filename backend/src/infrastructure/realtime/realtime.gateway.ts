import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { UserRole } from '../../common/enums.js';
import type { AccessTokenPayload, AuthContext } from '../../modules/auth/auth.types.js';
import { AuditService } from '../../modules/audit/audit.service.js';
import { TokenService } from '../../modules/auth/token.service.js';
import { DriverLocationService } from '../../modules/dispatch/driver-location.service.js';
import { LocationUpdateDto } from '../../modules/dispatch/dispatch.dto.js';
import { RealtimeEmitter, userRoom } from './realtime.emitter.js';

interface SocketData {
  auth?: AuthContext;
}
type AuthedSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

export interface Ack {
  ok: boolean;
  error?: string;
}

/**
 * Socket.IO namespace /realtime. Every connection must present a valid access
 * token (handshake `auth.token`, or `Authorization: Bearer …`). Each user joins
 * only their own room, so events reach exactly the people they concern.
 */
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
    private readonly emitter: RealtimeEmitter,
    private readonly locations: DriverLocationService,
    private readonly audit: AuditService,
  ) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      this.authenticate(socket)
        .then((auth) => {
          (socket as AuthedSocket).data.auth = auth;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
    this.emitter.attach(namespace);
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const auth = client.data.auth;
    if (!auth) {
      client.disconnect(true);
      return;
    }
    await client.join(userRoom(auth.userId));
    this.logger.debug(`Connected ${auth.role} ${auth.userId}`);
  }

  handleDisconnect(client: AuthedSocket): void {
    this.logger.debug(`Disconnected ${client.data.auth?.userId ?? 'anonymous'}`);
  }

  /** Connectivity check: emit "ping", receive "pong" with the server time. */
  @SubscribeMessage('ping')
  ping(): { event: string; data: { serverTime: string } } {
    return { event: 'pong', data: { serverTime: new Date().toISOString() } };
  }

  /** Drivers stream their own position; the driver is always taken from the token. */
  @SubscribeMessage('driver:location')
  async driverLocation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack> {
    const auth = client.data.auth;
    if (!auth || auth.role !== UserRole.Driver) {
      if (auth) {
        await this.audit.record({
          action: 'security.location_publish_denied',
          entityType: 'user',
          entityId: auth.userId,
          actorUserId: auth.userId,
          metadata: { role: auth.role, channel: 'socket' },
        });
      }
      return { ok: false, error: 'forbidden' };
    }
    const dto = plainToInstance(LocationUpdateDto, body ?? {});
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      return { ok: false, error: Object.values(errors[0].constraints ?? {})[0] ?? 'invalid' };
    }
    try {
      await this.locations.update(auth.userId, dto);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }

  private async authenticate(socket: Socket): Promise<AuthContext> {
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const header = socket.handshake.headers.authorization;
    const raw =
      typeof fromAuth === 'string'
        ? fromAuth
        : typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice(7)
          : '';
    const token = raw.replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('missing token');
    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      algorithms: ['HS256'],
    });
    if (payload.typ !== 'access' || (await this.tokens.isSessionRevoked(payload.sid))) {
      throw new Error('revoked');
    }
    return { userId: payload.sub, role: payload.role, sessionId: payload.sid };
  }
}
