import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Writes append-only audit records. Never throws: auditing must not break the action itself. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          actorUserId: entry.actorUserId ?? null,
          metadata: entry.metadata ?? {},
          ipAddress: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 255) ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`Failed to write audit "${entry.action}": ${String(err)}`);
    }
  }
}
