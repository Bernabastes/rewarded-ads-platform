import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  Public,
  Subjects,
} from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { BillingService } from './billing.service';
import { CreateTopupDto } from './dto/billing.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('balance')
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({ summary: 'Wallet balance, reserved budget and lifetime totals' })
  balance(@CurrentAuth() auth: AuthContext) {
    return this.billing.balance(auth.subjectId);
  }

  @Get('ledger')
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({ summary: 'Wallet ledger (top-ups, budget reservations, refunds)' })
  ledger(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.billing.ledger(auth.subjectId, query);
  }

  @Post('topups')
  @HttpCode(201)
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({
    summary: 'Start a wallet top-up via the payment gateway',
    description:
      'Returns a `checkoutUrl` to redirect the browser to. Without CHAPA_SECRET_KEY the API serves a local mock checkout page (`mock: true`).',
  })
  createTopup(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTopupDto) {
    return this.billing.createTopup(auth.subjectId, dto.amountEtb, dto.returnUrl);
  }

  @Get('payments')
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({ summary: 'Payment history' })
  payments(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.billing.listPayments(auth.subjectId, query);
  }

  @Get('payments/:id')
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({ summary: 'Payment detail (pending payments are re-verified with the gateway)' })
  payment(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getPayment(auth.subjectId, id);
  }

  @Get('invoices')
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({ summary: 'Invoices (JSON)' })
  invoices(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.billing.listInvoices(auth.subjectId, query);
  }

  @Get('invoices/:id')
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({ summary: 'Invoice detail' })
  invoice(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.getInvoice(auth.subjectId, id);
  }

  @Post('webhooks/chapa')
  @Public()
  @ApiOperation({ summary: 'Chapa payment webhook (signature verified, idempotent)' })
  @ApiResponse({ status: 401, description: 'WEBHOOK_SIGNATURE_INVALID' })
  chapaWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @ClientIp() ip: string,
  ) {
    return this.billing.handleChapaWebhook(req.rawBody, body ?? {}, headers, ip);
  }

  @Get('mock-checkout/:txRef')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiExcludeEndpoint()
  mockCheckout(@Param('txRef') txRef: string) {
    return this.billing.mockCheckoutPage(txRef);
  }

  @Post('mock-checkout/:txRef/pay')
  @Public()
  @ApiOperation({ summary: '[MOCK MODE ONLY] Complete or fail a mock checkout', deprecated: false })
  mockPay(@Param('txRef') txRef: string, @Body() body: { outcome?: 'success' | 'failed' }) {
    return this.billing.mockCheckoutPay(txRef, body?.outcome === 'failed' ? 'failed' : 'success');
  }
}
