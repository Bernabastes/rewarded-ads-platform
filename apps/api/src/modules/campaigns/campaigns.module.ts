import { Module } from '@nestjs/common';
import { CampaignLifecycleService } from './campaign-lifecycle.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignLifecycleService],
  exports: [CampaignsService, CampaignLifecycleService],
})
export class CampaignsModule {}
