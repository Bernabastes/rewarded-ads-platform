import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ActorType,
  AdReportStatus,
  AdvertiserVerificationStatus,
  CampaignStatus,
  CoinAdjustmentStatus,
  MediaStatus,
  OfferCompletionStatus,
  ReviewStatus,
  UserStatus,
  WithdrawalStatus,
} from '@prisma/client';
import { BANNED_TOPICS } from '@rap/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';

/* ------------------------------ ad review ------------------------------ */

export class BannedTopicsChecklistDto {
  /** Map of banned-topic key -> true when the reviewer confirmed the ad does NOT contain it. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    example: Object.fromEntries(BANNED_TOPICS.map((t) => [t.key, true])),
  })
  @IsObject()
  checks: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ApproveAdDto {
  @ApiProperty({ type: BannedTopicsChecklistDto })
  @ValidateNested()
  @Type(() => BannedTopicsChecklistDto)
  bannedTopicsChecklist: BannedTopicsChecklistDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectAdDto {
  @ApiProperty({ example: 'Contains alcohol promotion (banned topic).' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ type: BannedTopicsChecklistDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BannedTopicsChecklistDto)
  bannedTopicsChecklist?: BannedTopicsChecklistDto;
}

export class AdReviewQueueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus, default: 'pending' })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  /** Filter by media pipeline state (e.g. `failed` to find creatives needing a reprocess). */
  @ApiPropertyOptional({ enum: MediaStatus })
  @IsOptional()
  @IsEnum(MediaStatus)
  mediaStatus?: MediaStatus;
}

/* -------------------------------- users -------------------------------- */

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search phone number or name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minTrustScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxTrustScore?: number;
}

export class ReasonDto {
  @ApiProperty({ example: 'Multiple accounts on one device confirmed by support ticket #123' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}

export class OptionalNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Finance resolution of a `needs_manual_review` withdrawal after checking the partner's records (Phase 5 #7). */
export class ResolveManualReviewDto {
  @ApiProperty({ enum: ['completed', 'failed'], description: 'completed = partner paid (coins stay debited); failed = partner never paid (coins refunded)' })
  @IsIn(['completed', 'failed'])
  outcome: 'completed' | 'failed';

  @ApiProperty({ example: 'telebirr support confirmed transfer TB-9981 settled on 2026-10-01 (ticket #77)' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ description: 'Partner transaction reference confirmed during the check' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerReference?: string;
}

/* ----------------------------- advertisers ----------------------------- */

export class AdminAdvertisersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AdvertiserVerificationStatus })
  @IsOptional()
  @IsEnum(AdvertiserVerificationStatus)
  status?: AdvertiserVerificationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/* ------------------------------ campaigns ------------------------------ */

export class AdminCampaignsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CampaignStatus })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  advertiserId?: string;
}

/* ------------------------------ withdrawals ---------------------------- */

export class AdminWithdrawalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WithdrawalStatus })
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

/* --------------------------- coin adjustments -------------------------- */

export class CreateCoinAdjustmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;

  /** Signed coins (positive grant, negative deduction). Non-zero. */
  @ApiProperty({ example: 500 })
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  amount: number;

  @ApiProperty({ example: 'Goodwill credit for failed video playback (ticket #452)' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ example: 'TICKET-452' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class AdminCoinAdjustmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CoinAdjustmentStatus })
  @IsOptional()
  @IsEnum(CoinAdjustmentStatus)
  status?: CoinAdjustmentStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

/* --------------------------------- audit -------------------------------- */

export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  /** Admin email, advertiser email or user phone; resolved server-side to the actor id (no rows when unknown). */
  @ApiPropertyOptional({ example: 'finance@rap.et' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  actor?: string;

  @ApiPropertyOptional({ enum: ActorType })
  @IsOptional()
  @IsEnum(ActorType)
  actorType?: ActorType;

  @ApiPropertyOptional({ description: 'Exact action or prefix, e.g. "withdrawal."' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  targetType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiPropertyOptional({ description: 'Free-text search in action/target type' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  to?: string;
}

/* ------------------------------ ad reports ------------------------------ */

export class AdReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AdReportStatus, default: 'open' })
  @IsOptional()
  @IsEnum(AdReportStatus)
  status?: AdReportStatus;
}

export class ReviewAdReportDto {
  @ApiProperty({ enum: ['reviewed', 'dismissed'] })
  @IsEnum(['reviewed', 'dismissed'])
  outcome: 'reviewed' | 'dismissed';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** When true the ad is pulled from the feed (review_status -> rejected) with rejectionReason. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rejectAd?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}

/* --------------------------------- offers ------------------------------- */

export class AppInstallCompletionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OfferCompletionStatus, default: 'pending_verification' })
  @IsOptional()
  @IsEnum(OfferCompletionStatus)
  status?: OfferCompletionStatus;
}

export class RejectWithReasonDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class RevenueQueryDto {
  @ApiPropertyOptional({ description: 'ISO date (default 30 days ago)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (default today)' })
  @IsOptional()
  @IsString()
  to?: string;
}
