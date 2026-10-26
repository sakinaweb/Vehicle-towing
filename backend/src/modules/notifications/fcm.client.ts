import { Injectable } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service.js';
import { PushProviderName } from '../../config/env.validation.js';
import type { NotificationMessage } from './notification.messages.js';

export class FcmError extends Error {
  constructor(
    readonly status: number,
    /** FCM error code, e.g. UNREGISTERED (the app was uninstalled / token rotated). */
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }

  get tokenIsDead(): boolean {
    return this.code === 'UNREGISTERED' || this.status === 404;
  }
}

/**
 * Firebase Cloud Messaging HTTP v1, using the service account directly (OAuth JWT
 * bearer flow signed with node:crypto) — no Firebase SDK needed on the server.
 */
@Injectable()
export class FcmClient {
  private cached: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return this.config.push.provider === PushProviderName.Fcm;
  }

  async send(token: string, msg: NotificationMessage): Promise<void> {
    const { apiBase, projectId } = this.config.push.fcm;
    const res = await fetch(`${apiBase}/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: { type: msg.type, ...msg.data },
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (res.ok) return;
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; details?: { errorCode?: string }[] };
    };
    throw new FcmError(
      res.status,
      err.error?.details?.find((d) => d.errorCode)?.errorCode,
      err.error?.message ?? `FCM responded ${res.status}`,
    );
  }

  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.value;
    const { clientEmail, privateKey, tokenUri } = this.config.push.fcm;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(privateKey ?? '', 'base64url');
    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!res.ok)
      throw new FcmError(res.status, undefined, `FCM OAuth token request failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
