import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { UserRole } from '../../common/enums.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { UserView } from '../users/user.view.js';
import { AuthService } from './auth.service.js';
import type { AuthContext, ClientMeta, IssuedTokens, SignInRole } from './auth.types.js';
import { SIGN_IN_ROLES } from './auth.types.js';
import { CurrentAuth, Public } from './decorators.js';
import { OtpRequestedView, RefreshDto, RequestOtpDto, SessionView, VerifyOtpDto } from './dto.js';
import { TokenService } from './token.service.js';

const MOBILE_HEADER = 'x-client-type';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a 6-digit sign-in code by SMS' })
  @ApiAcceptedResponse({ type: OtpRequestedView })
  @ApiTooManyRequestsResponse({ description: 'Cooldown or hourly limit reached' })
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request): Promise<OtpRequestedView> {
    return this.auth.requestOtp(dto.phone, clientMeta(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the code and sign in (creates the account on first sign-in)' })
  @ApiHeader({
    name: MOBILE_HEADER,
    required: false,
    description: '"mobile" to receive the refresh token in the body',
  })
  @ApiOkResponse({ type: SessionView })
  @ApiUnauthorizedResponse({ description: 'Incorrect code' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionView> {
    const { user, isNewUser, tokens } = await this.auth.signInWithOtp(
      dto.phone,
      dto.code,
      dto.role,
      clientMeta(req),
    );
    return this.deliver(req, res, dto.role, tokens, UserView.from(user), isNewUser);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  @ApiOkResponse({ type: SessionView })
  @ApiUnauthorizedResponse({ description: 'Session expired, revoked or token reused' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionView> {
    const cookieToken = dto.role ? readCookie(req, cookieName(dto.role)) : undefined;
    const { user, tokens } = await this.tokens.rotate(
      dto.refreshToken ?? cookieToken,
      clientMeta(req),
    );
    return this.deliver(req, res, user.role as SignInRole, tokens, UserView.from(user), false);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End the current session' })
  @ApiNoContentResponse()
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth.userId, auth.sessionId, clientMeta(req));
    this.clearCookie(res, auth.role);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End every session of the current user (all devices)' })
  @ApiOkResponse({ schema: { example: { sessionsEnded: 3 } } })
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ sessionsEnded: number }> {
    const sessionsEnded = await this.auth.logoutEverywhere(auth.userId, clientMeta(req));
    this.clearCookie(res, auth.role);
    return { sessionsEnded };
  }

  /** Web: refresh token goes in an HttpOnly cookie only. Mobile: in the body. */
  private deliver(
    req: Request,
    res: Response,
    role: SignInRole,
    tokens: IssuedTokens,
    user: UserView,
    isNewUser: boolean,
  ): SessionView {
    const isMobile = req.headers[MOBILE_HEADER] === 'mobile';
    if (!isMobile) {
      res.cookie(cookieName(role), tokens.refreshToken, {
        ...this.cookieOptions(),
        expires: tokens.refreshTokenExpiresAt,
      });
    }
    return {
      user,
      isNewUser,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      ...(isMobile && { refreshToken: tokens.refreshToken }),
    };
  }

  private clearCookie(res: Response, role: UserRole): void {
    if ((SIGN_IN_ROLES as readonly string[]).includes(role)) {
      res.clearCookie(cookieName(role as SignInRole), this.cookieOptions());
    }
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true, // unreachable from JavaScript (XSS cannot steal it)
      secure: this.config.auth.cookieSecure,
      sameSite: 'strict', // never sent on cross-site requests (CSRF)
      path: `/${this.config.app.apiPrefix}/v1/auth`, // only sent to auth endpoints
    };
  }
}

/** One cookie per app, so the customer and driver apps keep separate sessions. */
function cookieName(role: SignInRole): string {
  return `townow_rt_${role}`;
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : undefined;
}

function clientMeta(req: Request): ClientMeta {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}
