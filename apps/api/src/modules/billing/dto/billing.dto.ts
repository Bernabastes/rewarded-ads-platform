import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PLATFORM_DEFAULTS } from '@rap/shared';
import { IsNumber, IsOptional, IsUrl, Max, Min } from 'class-validator';

export class CreateTopupDto {
  /** ETB amount to add to the wallet (min MIN_TOPUP_ETB, default 100). */
  @ApiProperty({ example: 5000, minimum: PLATFORM_DEFAULTS.MIN_TOPUP_ETB })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(PLATFORM_DEFAULTS.MIN_TOPUP_ETB)
  @Max(10_000_000)
  amountEtb: number;

  /** Where to send the browser after checkout. Defaults to ADVERTISER_WEB_URL/billing. */
  @ApiPropertyOptional({ example: 'http://localhost:5173/billing?topup=done' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}
