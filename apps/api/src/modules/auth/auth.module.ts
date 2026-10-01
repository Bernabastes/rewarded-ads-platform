import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottle } from './login-throttle';
import { MfaService } from './mfa.service';
import { OtpVerifier } from './otp.verifier';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, OtpVerifier, LoginThrottle, MfaService],
  exports: [AuthService, TokenService, OtpVerifier, LoginThrottle, MfaService, JwtModule],
})
export class AuthModule {}
