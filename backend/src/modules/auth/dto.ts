import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { UaeMobile } from '../../common/validation/uae-mobile.decorator.js';
import { UserView } from '../users/user.view.js';
import { SIGN_IN_ROLES, type SignInRole } from './auth.types.js';

export class RequestOtpDto {
  @UaeMobile({ devIndia: true })
  phone!: string;
}

export class OtpRequestedView {
  @ApiProperty({ description: 'When the code stops working' }) expiresAt!: Date;
  @ApiProperty({ description: 'Earliest time a new code can be requested' })
  resendAvailableAt!: Date;
}

export class VerifyOtpDto {
  @UaeMobile({ devIndia: true })
  phone!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from the SMS' })
  code!: string;

  @ApiProperty({ enum: SIGN_IN_ROLES, description: 'Which app is signing in' })
  @IsIn(SIGN_IN_ROLES)
  role!: SignInRole;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Mobile clients only; web clients use the HttpOnly cookie' })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiPropertyOptional({
    enum: SIGN_IN_ROLES,
    description: 'Web clients: which app cookie to use',
  })
  @IsOptional()
  @IsIn(SIGN_IN_ROLES)
  role?: SignInRole;
}

export class SessionView {
  @ApiProperty({ type: UserView }) user!: UserView;
  @ApiProperty({ description: 'True when this sign-in created the account' }) isNewUser!: boolean;
  @ApiProperty({ description: 'Send as "Authorization: Bearer <token>"' }) accessToken!: string;
  @ApiProperty() accessTokenExpiresAt!: Date;
  @ApiProperty() refreshTokenExpiresAt!: Date;
  @ApiPropertyOptional({
    description: 'Only returned to mobile clients (header X-Client-Type: mobile)',
  })
  refreshToken?: string;
}
