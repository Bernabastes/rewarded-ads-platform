import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus, MediaType, TargetActionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PLATFORM_DEFAULTS } from '@rap/shared';
import { PaginationQueryDto } from '../../../common/pagination';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCampaignDto {
  @ApiProperty({ example: 'Buna Time - Morning Roast launch' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Total budget in ETB (>= MIN_CAMPAIGN_BUDGET_ETB); reserved from the wallet when the campaign is submitted. */
  @ApiProperty({ example: 5000, minimum: PLATFORM_DEFAULTS.MIN_CAMPAIGN_BUDGET_ETB })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PLATFORM_DEFAULTS.MIN_CAMPAIGN_BUDGET_ETB)
  @Max(10_000_000)
  budgetEtb: number;

  /** Amount the advertiser pays per valid action (>= MIN_COST_PER_ACTION_ETB). User reward = cost x (1 - take rate). */
  @ApiProperty({ example: 2, minimum: PLATFORM_DEFAULTS.MIN_COST_PER_ACTION_ETB })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PLATFORM_DEFAULTS.MIN_COST_PER_ACTION_ETB)
  @Max(10_000)
  costPerActionEtb: number;

  @ApiProperty({ enum: TargetActionType })
  @IsEnum(TargetActionType)
  targetActionType: TargetActionType;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE_RE)
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_RE)
  endDate?: string;

  /** Ask a one-question attention check after each ad (default true). */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  attentionCheckEnabled?: boolean;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ minimum: PLATFORM_DEFAULTS.MIN_CAMPAIGN_BUDGET_ETB })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PLATFORM_DEFAULTS.MIN_CAMPAIGN_BUDGET_ETB)
  @Max(10_000_000)
  budgetEtb?: number;

  @ApiPropertyOptional({ minimum: PLATFORM_DEFAULTS.MIN_COST_PER_ACTION_ETB })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PLATFORM_DEFAULTS.MIN_COST_PER_ACTION_ETB)
  @Max(10_000)
  costPerActionEtb?: number;

  @ApiPropertyOptional({ enum: TargetActionType })
  @IsOptional()
  @IsEnum(TargetActionType)
  targetActionType?: TargetActionType;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_RE)
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_RE)
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attentionCheckEnabled?: boolean;
}

export class CampaignsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CampaignStatus })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}

export class AttentionQuestionInputDto {
  @ApiProperty({ example: 'Which product was shown in the video?' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  prompt: string;

  @ApiPropertyOptional({ example: 'በቪዲዮው ላይ የታየው ምርት ምንድን ነው?' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  promptAm?: string;

  @ApiProperty({ type: [String], example: ['Coffee', 'Tea', 'Water'] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  options: string[];

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  @Max(3)
  correctIndex: number;
}

export class CreateAdDto {
  @ApiProperty({ example: 'Morning Roast - 30s spot' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Storage key returned by POST /campaigns/uploads/presign (preferred). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  storageKey?: string;

  /** Alternatively a publicly reachable media URL. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  mediaUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(1000)
  thumbnailUrl?: string;

  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  mediaType: MediaType;

  /** 5..120 seconds. For images this is the fixed viewing time. */
  @ApiProperty({ example: 30, minimum: 5, maximum: 120 })
  @IsInt()
  @Min(5)
  @Max(120)
  durationSeconds: number;

  @ApiPropertyOptional({ type: [AttentionQuestionInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AttentionQuestionInputDto)
  attentionQuestions?: AttentionQuestionInputDto[];
}

export class PresignUploadDto {
  @ApiProperty({ example: 'morning-roast.mp4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName: string;

  @ApiProperty({ example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contentType: string;

  @ApiProperty({ example: 10485760 })
  @IsInt()
  @Min(1)
  sizeBytes: number;
}

export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'ISO date or datetime (default: 30 days ago)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date or datetime (default: now)' })
  @IsOptional()
  @IsString()
  to?: string;
}
