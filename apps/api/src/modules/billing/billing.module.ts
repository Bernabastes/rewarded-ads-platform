import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { ChapaGateway, PAYMENT_GATEWAY } from './gateway/chapa.gateway';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    { provide: PAYMENT_GATEWAY, inject: [AppConfig], useFactory: (config: AppConfig) => new ChapaGateway(config) },
  ],
  exports: [BillingService],
})
export class BillingModule {}
