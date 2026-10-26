import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../../config/app-config.service.js';
import { SmsModule } from '../../infrastructure/sms/sms.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthSession } from './entities/auth-session.entity.js';
import { OtpChallenge } from './entities/otp-challenge.entity.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { OtpService } from './otp.service.js';
import { TokenService } from './token.service.js';

/** Phone + OTP sign-in, sessions and token issuance; installs the global auth guards. */
@Module({
  imports: [
    TypeOrmModule.forFeature([OtpChallenge, AuthSession]),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.auth.accessSecret,
        signOptions: { algorithm: 'HS256', issuer: 'townow-api', audience: 'townow' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'townow-api', audience: 'townow' },
      }),
    }),
    SmsModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TypeOrmModule, TokenService, JwtModule],
})
export class AuthModule {}
