import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Language } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OtpRequestDto {
  /** Ethiopian mobile number (09.., 07.., +2519.., 2517..). Normalised server-side to +251XXXXXXXXX. */
  @ApiProperty({ example: '0911223344' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '0911223344' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(4, 8)
  code: string;

  /** Stable app-installation identifier. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  /** Device fingerprint hash collected by the client. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceFingerprint?: string;

  /** Referral code of the inviting user; honoured only on the FIRST login of a new account. */
  @ApiPropertyOptional({ example: 'K7MP2X' })
  @IsOptional()
  @IsString()
  @Length(4, 12)
  referralCode?: string;
}

/** Ethiopian (Amete Mihret) calendar date; month 13 = Pagume (5 days, 6 in leap years). */
export class EthiopianDateDto {
  @ApiProperty({ example: 1987 })
  @IsInt()
  @Min(1900)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 8, description: '1-13 (13 = Pagume)' })
  @IsInt()
  @Min(1)
  @Max(13)
  month: number;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(30)
  day: number;
}

export class CompleteProfileDto {
  @ApiProperty({ example: 'Abebe Bikila' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  /** Gregorian date of birth as YYYY-MM-DD. Provide EITHER this OR dateOfBirthEthiopian. */
  @ApiPropertyOptional({ example: '1995-04-12' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth?: string;

  /** Ethiopian calendar date of birth; converted and validated server-side (Pagume / leap-year rules). */
  @ApiPropertyOptional({ type: EthiopianDateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EthiopianDateDto)
  dateOfBirthEthiopian?: EthiopianDateDto;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  languagePreference?: Language;
}

export class AdvertiserRegisterDto {
  @ApiProperty({ example: 'Habesha Coffee Roasters PLC' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  businessName: string;

  @ApiProperty({ example: 'MT/AA/2/0012345/2015' })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  businessRegistrationNumber: string;

  @ApiProperty({ example: 'ads@habesha-coffee.et' })
  @IsEmail()
  @MaxLength(160)
  contactEmail: string;

  @ApiProperty({ example: '+251911000001' })
  @IsString()
  @MaxLength(20)
  contactPhone: string;

  /** Min 8 characters with at least one letter and one digit. */
  @ApiProperty({ example: 'Advertiser123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password must contain a letter and a digit' })
  password: string;

  /** Advertiser terms version accepted at registration (GET /legal/current?audience=advertiser). */
  @ApiPropertyOptional({ example: '1.0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  termsVersion?: string;
}

export class EmailPasswordLoginDto {
  @ApiProperty({ example: 'super@rap.et' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin123!' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken: string;
}

export class LogoutDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  /** Min 8 characters with at least one letter and one digit. */
  @ApiProperty({ example: 'NewPassw0rd!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'newPassword must contain a letter and a digit' })
  newPassword: string;
}
