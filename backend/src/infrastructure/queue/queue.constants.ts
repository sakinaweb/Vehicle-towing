/** Infrastructure queue used to verify the BullMQ pipeline (enqueue → worker → result). */
export const SYSTEM_QUEUE = 'system';

export const SystemJob = {
  Heartbeat: 'heartbeat',
} as const;

export interface HeartbeatResult {
  ok: true;
  processedAt: string;
}
