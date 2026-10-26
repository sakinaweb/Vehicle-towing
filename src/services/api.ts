/**
 * TowNow API client.
 * - Access token lives in memory only (never localStorage).
 * - The refresh token is an HttpOnly cookie set by the API; JavaScript never sees it.
 * - On 401 the client refreshes once and retries, sharing a single in-flight refresh.
 */

// Shared by the Vite web app (VITE_API_URL) and the Next.js admin dashboard (NEXT_PUBLIC_API_URL).
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
export const API_BASE_URL: string =
  viteEnv?.VITE_API_URL ??
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL : undefined) ??
  'http://localhost:4000/api/v1';

export type AppRole = 'customer' | 'driver' | 'admin';

export interface ApiUser {
  id: string;
  phone: string;
  role: 'customer' | 'driver' | 'admin' | 'staff';
  fullName: string | null;
  email: string | null;
  createdAt: string;
}

export interface SessionResponse {
  user: ApiUser;
  isNewUser: boolean;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * OTP verify errors raised after the code was accepted and spent: the number belongs to
 * another app (409) or may not sign in here (403). Retrying the same code can only fail.
 */
export const isSpentOtpRejection = (err: unknown): err is ApiError =>
  err instanceof ApiError && (err.status === 403 || err.status === 409);

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialisable value, or FormData for file uploads. */
  body?: unknown;
  /** 'blob' for files (photos, documents) served behind auth. */
  responseType?: 'json' | 'blob';
  /** Send the access token and refresh on 401 (default true). */
  auth?: boolean;
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<SessionResponse | null> | null = null;

  constructor(readonly role: AppRole) {}

  /** Current in-memory access token (for the Socket.IO handshake). */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  setSession(session: SessionResponse | null): void {
    this.accessToken = session?.accessToken ?? null;
  }

  /** Restores or renews the session from the HttpOnly cookie; null if signed out. */
  refresh(): Promise<SessionResponse | null> {
    this.refreshing ??= this.send<SessionResponse>('/auth/refresh', {
      method: 'POST',
      body: { role: this.role },
      auth: false,
    })
      .then((session) => {
        this.setSession(session);
        return session;
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          this.setSession(null);
          return null;
        }
        throw err;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    try {
      return await this.send<T>(path, options);
    } catch (err) {
      if (!auth || !(err instanceof ApiError) || err.status !== 401) throw err;
      const renewed = await this.refresh();
      if (!renewed) throw err;
      return this.send<T>(path, options);
    }
  }

  private async send<T>(path: string, { method = 'GET', body, auth = true, responseType = 'json' }: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const isForm = body instanceof FormData; // the browser sets the multipart boundary
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (auth && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
        credentials: 'include', // send/receive the HttpOnly refresh cookie
      });
    } catch {
      throw new ApiError(0, 'Cannot reach TowNow right now. Check your connection and try again.');
    }

    if (response.status === 204) return undefined as T;
    if (responseType === 'blob' && response.ok) return (await response.blob()) as T;
    const payload = (await response.json().catch(() => null)) as
      | { message?: string | string[]; details?: Record<string, unknown> }
      | null;
    if (!response.ok) {
      const message = Array.isArray(payload?.message)
        ? payload.message[0]
        : payload?.message ?? `Request failed (${response.status})`;
      throw new ApiError(response.status, message, payload?.details);
    }
    return payload as T;
  }
}

/** One client per app, shared across re-renders and React StrictMode double effects. */
export const apiClients: Record<AppRole, ApiClient> = {
  customer: new ApiClient('customer'),
  driver: new ApiClient('driver'),
  admin: new ApiClient('admin'),
};
