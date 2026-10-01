import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import {
  AdminAccountsController,
  AdminCoinAdjustmentsController,
  AdminFraudController,
  AdminHomeController,
  AdminReportsController,
  AdminReviewController,
  AdminUsersController,
  AdminWithdrawalsController,
} from './controllers/admin.controllers';
import { AdminAccountsService } from './services/admin-accounts.service';
import { AdminReportsService } from './services/admin-reports.service';
import { AdminReviewService } from './services/admin-review.service';
import { AdminUsersService } from './services/admin-users.service';
import { CoinAdjustmentsService } from './services/coin-adjustments.service';

@Module({
  imports: [CampaignsModule, WithdrawalsModule, NotificationsModule],
  controllers: [
    AdminHomeController,
    AdminAccountsController,
    AdminReviewController,
    AdminUsersController,
    AdminFraudController,
    AdminWithdrawalsController,
    AdminCoinAdjustmentsController,
    AdminReportsController,
  ],
  providers: [AdminReviewService, AdminUsersService, CoinAdjustmentsService, AdminReportsService, AdminAccountsService],
})
export class AdminModule {}
