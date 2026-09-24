import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FraudResolution, FraudSeverity } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';

export class CreateFraudFlagDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ example: 'user' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  relatedEntityType: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  relatedEntityId?: string;

  @ApiProperty({ example: 'MANUAL_REVIEW' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  flagType: string;

  @ApiProperty({ enum: FraudSeverity })
  @IsEnum(FraudSeverity)
  severity: FraudSeverity;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description: string;

  @ApiPropertyOptional({ description: 'Signed trust-score change to apply immediately', minimum: -50, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(-50)
  @Max(50)
  trustScoreDelta?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ResolveFraudFlagDto {
  @ApiProperty({ enum: FraudResolution })
  @IsEnum(FraudResolution)
  resolution: FraudResolution;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note: string;
}

export class FraudFlagsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FraudSeverity })
  @IsOptional()
  @IsEnum(FraudSeverity)
  severity?: FraudSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  resolved?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  flagType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relatedEntityType?: string;
}
