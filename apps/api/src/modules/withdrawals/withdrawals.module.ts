import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { NotificationsModule } from '../notifications/notifications.module';
import { DestinationsService } from './destinations/destinations.service';
import { PayoutProcessor } from './payout.processor';
import { ChapaPayoutProvider } from './providers/chapa-payout.provider';
import { PAYOUT_PROVIDERS } from './providers/payout-provider';
import { PayoutProviderRegistry } from './providers/payout-provider.registry';
import { TelebirrPayoutProvider } from './providers/telebirr.provider';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [NotificationsModule],
  controllers: [WithdrawalsController],
  providers: [
    WithdrawalsService,
    DestinationsService,
    PayoutProviderRegistry,
    PayoutProcessor,
    {
      provide: PAYOUT_PROVIDERS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => [
        new TelebirrPayoutProvider(config),
        new ChapaPayoutProvider(config),
      ],
    },
  ],
  exports: [WithdrawalsService, DestinationsService, PayoutProviderRegistry],
})
export class WithdrawalsModule {}
