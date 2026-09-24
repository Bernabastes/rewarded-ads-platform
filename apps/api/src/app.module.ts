import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthGuard } from './common/guards/auth.guard';
import { AppConfigModule } from './config/app-config';
import { HealthModule } from './health/health.module';
import { AppLoggerModule } from './infra/logger/logger.module';
import { PrismaModule } from './infra/prisma/prisma.service';
import { PushModule } from './infra/push/push.module';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.service';
import { SmsModule } from './infra/sms/sms.module';
import { StorageModule } from './infra/storage/storage.service';
import { AdminModule } from './modules/admin/admin.module';
import { AdvertisersModule } from './modules/advertisers/advertisers.module';
import { AdsModule } from './modules/ads/ads.module';
import { AuditModule } from './modules/audit/audit.service';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OffersModule } from './modules/offers/offers.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    ScheduleModule.forRoot(),
    StorageModule,
    SmsModule,
    PushModule,
    AuditModule,
    HealthModule,
    AuthModule,
    LedgerModule,
    FraudModule,
    NotificationsModule,
    WalletModule,
    UsersModule,
    AdsModule,
    OffersModule,
    CampaignsModule,
    BillingModule,
    AdvertisersModule,
    WithdrawalsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
