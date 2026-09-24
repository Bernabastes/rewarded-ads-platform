import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class StartWatchSessionDto {
  /** Stable device fingerprint hash computed by the client (required for fraud checks). */
  @ApiProperty({ example: 'fp_9f8e7d6c5b4a' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  deviceFingerprint: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class HeartbeatDto {
  /** Current player position in seconds (informational only; the server uses its own clock). */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  positionSeconds?: number;
}

export class CompleteWatchSessionDto {
  /** Index of the selected option when an attention question was returned at session start. */
  @ApiPropertyOptional({ minimum: 0, maximum: 9 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  attentionAnswerIndex?: number;
}
