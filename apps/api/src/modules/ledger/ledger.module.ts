import { Global, Module } from '@nestjs/common';
import {
  LedgerReconciliationProcessor,
  LedgerReconciliationScheduler,
  LedgerReconciliationService,
} from './ledger-reconciliation.service';
import { LedgerService } from './ledger.service';

@Global()
@Module({
  providers: [
    LedgerService,
    LedgerReconciliationService,
    LedgerReconciliationProcessor,
    LedgerReconciliationScheduler,
  ],
  exports: [LedgerService, LedgerReconciliationService],
})
export class LedgerModule {}
