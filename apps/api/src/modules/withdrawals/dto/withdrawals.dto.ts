import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutMethod, WithdrawalStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';

export class CreateWithdrawalDto {
  /** ETB with up to 2 decimals, at least the configured minimum (default 50). */
  @ApiProperty({ example: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  amountEtb: number;

  @ApiProperty({ enum: PayoutMethod })
  @IsEnum(PayoutMethod)
  payoutMethod: PayoutMethod;

  /** Phone number for telebirr / CBE Birr, account number for bank. */
  @ApiProperty({ example: '0911223344' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  payoutDestination: string;

  /** Account holder name (required for bank transfers). */
  @ApiPropertyOptional({ example: 'Abebe Bikila' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationName?: string;

  /** Chapa bank code for bank transfers (see GET /v1/banks on Chapa). */
  @ApiPropertyOptional({ example: '946' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankCode?: string;
}

export class WithdrawalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WithdrawalStatus })
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;
}
