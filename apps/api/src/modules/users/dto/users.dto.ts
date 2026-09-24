import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdReportReason, DevicePlatform, Language } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class NotificationPrefsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rewards?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawals?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  offers?: boolean;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ enum: Language })
  @IsOptional()
  @IsEnum(Language)
  languagePreference?: Language;

  @ApiPropertyOptional({ type: NotificationPrefsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsDto)
  notificationPrefs?: NotificationPrefsDto;
}

export class RegisterPushTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class CreateAdReportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  adId: string;

  @ApiProperty({ enum: AdReportReason })
  @IsEnum(AdReportReason)
  reason: AdReportReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
