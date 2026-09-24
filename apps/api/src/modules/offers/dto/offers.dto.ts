import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';

export class OffersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['survey', 'app_install'] })
  @IsOptional()
  @IsEnum(['survey', 'app_install'])
  type?: 'survey' | 'app_install';
}

export class SurveyAnswerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  questionId: string;

  /** string (text / option index), string[] (multi choice) or number (rating). */
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }, { type: 'number' }] })
  @IsNotEmpty()
  value: string | string[] | number;
}

export class CompleteSurveyDto {
  @ApiProperty({ type: [SurveyAnswerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerDto)
  answers: SurveyAnswerDto[];
}

export class CompleteAppInstallDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  deviceFingerprint: string;

  @ApiPropertyOptional({ description: 'Optional attribution token / proof stored for manual verification' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  proof?: string;
}
