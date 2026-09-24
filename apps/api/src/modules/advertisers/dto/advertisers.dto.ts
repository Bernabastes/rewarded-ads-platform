import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class AdvertiserNotificationPrefsDto {
  /** Email when a campaign or creative is approved/rejected. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  campaignReviews?: boolean;

  /** Email for top-ups, invoices and low-balance warnings. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  billing?: boolean;

  /** Weekly performance summary. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  weeklyReport?: boolean;
}

export class UpdateAdvertiserProfileDto {
  @ApiPropertyOptional({ example: 'Habesha Coffee Roasters PLC' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  businessName?: string;

  @ApiPropertyOptional({ example: '+251911000001' })
  @IsOptional()
  @IsString()
  @MinLength(9)
  @MaxLength(20)
  contactPhone?: string;

  @ApiPropertyOptional({ type: AdvertiserNotificationPrefsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdvertiserNotificationPrefsDto)
  notificationPrefs?: AdvertiserNotificationPrefsDto;
}
