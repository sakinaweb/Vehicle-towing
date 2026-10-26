import { UserRole } from '../../common/enums.js';

/** Claims inside an access token. */
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  role: UserRole;
  /** Session id — lets logout revoke tokens that are still within their lifetime. */
  sid: string;
  typ: 'access';
}

/** The authenticated caller, attached to the request by JwtAuthGuard. */
export interface AuthContext {
  userId: string;
  role: UserRole;
  sessionId: string;
}

/** Client details recorded with a session (shown in "active devices", used for audit). */
export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/** Roles that can sign themselves up via OTP. Admin/staff accounts are provisioned. */
export const SELF_SERVICE_ROLES = [UserRole.Customer, UserRole.Driver] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

/** Roles that can sign in with OTP. Admins sign in but are never created by sign-in. */
export const SIGN_IN_ROLES = [...SELF_SERVICE_ROLES, UserRole.Admin] as const;
export type SignInRole = (typeof SIGN_IN_ROLES)[number];
