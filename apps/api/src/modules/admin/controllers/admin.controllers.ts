import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AllowPendingSecuritySetup,
  type AuthContext,
  ClientIp,
  CurrentAuth,
  Roles,
  Subjects,
} from '../../../common/decorators/auth.decorators';
import { Idempotent } from '../../../common/idempotency/idempotency.interceptor';
import { PaginationQueryDto } from '../../../common/pagination';
import { FraudService } from '../../fraud/fraud.service';
import { FraudFlagsQueryDto, ResolveFraudFlagDto } from '../../fraud/dto/fraud.dto';
import { WithdrawalsService } from '../../withdrawals/withdrawals.service';
import {
  AdReportsQueryDto,
  AdReviewQueueQueryDto,
  AdminAdvertisersQueryDto,
  AdminCampaignsQueryDto,
  AdminCoinAdjustmentsQueryDto,
  AdminUsersQueryDto,
  AdminWithdrawalsQueryDto,
  AppInstallCompletionsQueryDto,
  ApproveAdDto,
  AuditLogQueryDto,
  CreateAdminDto,
  CreateCoinAdjustmentDto,
  OptionalNoteDto,
  ReasonDto,
  RejectAdDto,
  RejectWithReasonDto,
  ResolveManualReviewDto,
  RevenueQueryDto,
  ReviewAdReportDto,
  SetAdminActiveDto,
  UpdateAdminRoleDto,
} from '../dto/admin.dto';
import { AdminAccountsService } from '../services/admin-accounts.service';
import { AdminReportsService } from '../services/admin-reports.service';
import { AdminReviewService } from '../services/admin-review.service';
import { AdminUsersService } from '../services/admin-users.service';
import { CoinAdjustmentsService } from '../services/coin-adjustments.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuthService, toAdminProfile } from '../../auth/auth.service';
import { ChangePasswordDto, MfaDisableDto, MfaEnableDto } from '../../auth/dto/auth.dto';
import { MfaService } from '../../auth/mfa.service';

const actorOf = (auth: AuthContext, ip: string) => ({ adminId: auth.subjectId, ip });

/* ------------------------------------------------------------------ */
/* Me / overview / config                                              */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Subjects('admin')
export class AdminHomeController {
  constructor(
    private readonly reports: AdminReportsService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Get('me')
  @AllowPendingSecuritySetup()
  @ApiOperation({ summary: 'Current admin profile, role, MFA state and pending security requirements' })
  async me(@CurrentAuth() auth: AuthContext) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: auth.subjectId } });
    return toAdminProfile(admin, { mfaSetupRequired: this.mfa.setupRequiredFor(admin) });
  }

  @Post('me/change-password')
  @AllowPendingSecuritySetup()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change my admin password (clears the temporary-password flag; revokes every session - sign in again)',
  })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS (current password wrong)' })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.auth.changeAdminPassword(auth.subjectId, dto.currentPassword, dto.newPassword, ip);
  }

  @Post('me/mfa/setup')
  @AllowPendingSecuritySetup()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start TOTP enrolment: returns the secret + otpauth URI (MFA is active only after /enable)',
  })
  @ApiResponse({ status: 409, description: 'MFA_ALREADY_ENABLED' })
  mfaSetup(@CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.mfa.setup(auth.subjectId, ip);
  }

  @Post('me/mfa/enable')
  @AllowPendingSecuritySetup()
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a code from the authenticator app and switch MFA on' })
  @ApiResponse({ status: 400, description: 'MFA_CODE_INVALID | MFA_NOT_ENABLED (setup not started)' })
  mfaEnable(@Body() dto: MfaEnableDto, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.mfa.enable(auth.subjectId, dto.code, ip);
  }

  @Post('me/mfa/disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Switch MFA off (requires a current code AND the password)' })
  @ApiResponse({ status: 400, description: 'MFA_CODE_INVALID | MFA_NOT_ENABLED' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  mfaDisable(@Body() dto: MfaDisableDto, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.mfa.disable(auth.subjectId, dto.code, dto.password, ip);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Dashboard home counters' })
  overview() {
    return this.reports.overview();
  }

  @Get('config')
  @ApiOperation({ summary: 'Effective platform configuration (read-only)' })
  config() {
    return this.reports.platformConfig();
  }
}

/* ------------------------------------------------------------------ */
/* Admin accounts (super_admin)                                        */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/admins')
@Subjects('admin')
@Roles('super_admin')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'List admin accounts' })
  list() {
    return this.accounts.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Create an admin account with a one-time temporary password (must be changed at first login)',
  })
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_REGISTERED' })
  create(@Body() dto: CreateAdminDto, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.accounts.create(actorOf(auth, ip), dto);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change an admin role (revokes all of their sessions immediately)' })
  @ApiResponse({ status: 409, description: 'LAST_SUPER_ADMIN' })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.accounts.changeRole(actorOf(auth, ip), id, dto.role, dto.reason);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue a new temporary password (revokes all sessions; must be changed at next login)' })
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.accounts.resetPassword(actorOf(auth, ip), id);
  }

  @Patch(':id/active')
  @ApiOperation({ summary: 'Activate / deactivate an admin account' })
  @ApiResponse({ status: 409, description: 'LAST_SUPER_ADMIN | CONFLICT (self-deactivation)' })
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAdminActiveDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.accounts.setActive(actorOf(auth, ip), id, dto.active, dto.reason);
  }
}

/* ------------------------------------------------------------------ */
/* Ad review + campaigns + ad reports                                  */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Subjects('admin')
export class AdminReviewController {
  constructor(private readonly review: AdminReviewService) {}

  @Get('ads/review-queue')
  @Roles('super_admin', 'ad_reviewer')
  @ApiOperation({ summary: 'Ad review queue (default: pending)' })
  queue(@Query() query: AdReviewQueueQueryDto) {
    return this.review.reviewQueue(query);
  }

  @Get('ads/:id')
  @Roles('super_admin', 'ad_reviewer', 'support')
  @ApiOperation({ summary: 'Ad detail for review (includes banned-topics list and attention questions)' })
  ad(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.getAd(id);
  }

  @Post('ads/:id/approve')
  @Roles('super_admin', 'ad_reviewer')
  @ApiOperation({ summary: 'Approve an ad (every banned topic must be checked off)' })
  approveAd(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveAdDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.review.approveAd(id, dto.bannedTopicsChecklist, dto.note, actorOf(auth, ip));
  }

  @Post('ads/:id/reject')
  @Roles('super_admin', 'ad_reviewer')
  @ApiOperation({ summary: 'Reject an ad (reason required)' })
  rejectAd(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAdDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.review.rejectAd(id, dto.reason, dto.bannedTopicsChecklist, actorOf(auth, ip));
  }

  @Post('ads/:id/reprocess-media')
  @Roles('super_admin', 'ad_reviewer')
  @ApiOperation({
    summary: 'Re-run the media pipeline (probe + transcode + poster) for a creative',
    description: 'Use after a `failed` processing run. The ad goes back to `processing` until the job finishes.',
  })
  reprocessMedia(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.review.reprocessMedia(id, actorOf(auth, ip));
  }

  @Get('campaigns')
  @Roles('super_admin', 'ad_reviewer', 'support', 'finance')
  @ApiOperation({ summary: 'All campaigns (filter by status / advertiser)' })
  campaigns(@Query() query: AdminCampaignsQueryDto) {
    return this.review.listCampaigns(query);
  }

  @Get('campaigns/:id')
  @Roles('super_admin', 'ad_reviewer', 'support', 'finance')
  @ApiOperation({ summary: 'Campaign detail with ads and analytics' })
  campaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.getCampaign(id);
  }

  @Post('campaigns/:id/approve')
  @Roles('super_admin', 'ad_reviewer')
  @ApiOperation({ summary: 'Approve a pending campaign (pending_review -> active)' })
  approveCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.review.approveCampaign(id, actorOf(auth, ip), dto.note);
  }

  @Post('campaigns/:id/reject')
  @Roles('super_admin', 'ad_reviewer')
  @ApiOperation({ summary: 'Reject a campaign (reason required; unspent budget is refunded)' })
  rejectCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.review.rejectCampaign(id, dto.reason, actorOf(auth, ip));
  }

  @Post('campaigns/:id/pause')
  @Roles('super_admin', 'ad_reviewer', 'support')
  @ApiOperation({ summary: 'Pause an active campaign (platform-initiated)' })
  pauseCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.review.pauseCampaign(id, dto.reason, actorOf(auth, ip));
  }

  @Post('campaigns/:id/resume')
  @Roles('super_admin', 'ad_reviewer', 'support')
  @ApiOperation({ summary: 'Resume a paused campaign' })
  resumeCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.review.resumeCampaign(id, actorOf(auth, ip));
  }

  @Get('ad-reports')
  @Roles('super_admin', 'ad_reviewer', 'support')
  @ApiOperation({ summary: 'User-submitted ad reports' })
  adReports(@Query() query: AdReportsQueryDto) {
    return this.review.listAdReports(query);
  }

  @Post('ad-reports/:id/review')
  @Roles('super_admin', 'ad_reviewer', 'support')
  @ApiOperation({ summary: 'Close an ad report (optionally pulling the ad)' })
  reviewReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAdReportDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.review.reviewAdReport(id, dto, actorOf(auth, ip));
  }
}

/* ------------------------------------------------------------------ */
/* Users + advertisers                                                 */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Subjects('admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  @Roles('super_admin', 'support', 'finance')
  @ApiOperation({ summary: 'Search users' })
  list(@Query() query: AdminUsersQueryDto) {
    return this.users.listUsers(query);
  }

  @Get('users/:id')
  @Roles('super_admin', 'support', 'finance')
  @ApiOperation({ summary: 'User detail: trust score, flags, ledger, withdrawals, device/IP stats' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getUser(id);
  }

  @Post('users/:id/suspend')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'Suspend a user (reason required; sessions revoked)' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.users.moderateUser(id, 'suspend', dto.reason, actorOf(auth, ip));
  }

  @Post('users/:id/ban')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'Ban a user (reason required; sessions revoked)' })
  ban(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.users.moderateUser(id, 'ban', dto.reason, actorOf(auth, ip));
  }

  @Post('users/:id/reinstate')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'Reinstate a suspended/banned user' })
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.users.moderateUser(id, 'reinstate', dto.reason, actorOf(auth, ip));
  }

  @Post('users/:id/impersonate')
  @Roles('super_admin', 'support')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Issue a 10-minute READ-ONLY user token for support (audited on issue and on every request)',
    description:
      'The token (`typ: impersonation`, `actorAdminId`) is accepted by user-scoped GET endpoints only; every mutation fails with 403 IMPERSONATION_READ_ONLY. No refresh token is issued.',
  })
  impersonate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.users.impersonate(id, dto.reason, actorOf(auth, ip));
  }

  @Get('advertisers')
  @Roles('super_admin', 'support', 'finance', 'ad_reviewer')
  @ApiOperation({ summary: 'Advertisers (filter by verification status)' })
  advertisers(@Query() query: AdminAdvertisersQueryDto) {
    return this.users.listAdvertisers(query);
  }

  @Get('advertisers/:id')
  @Roles('super_admin', 'support', 'finance', 'ad_reviewer')
  @ApiOperation({ summary: 'Advertiser detail with campaigns' })
  advertiser(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getAdvertiser(id);
  }

  @Get('advertisers/:id/wallet')
  @Roles('super_admin', 'finance', 'support')
  @ApiOperation({
    summary: 'Advertiser wallet: balance, reserved budget, ledger (paginated) and gateway payments',
  })
  advertiserWallet(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    return this.users.getAdvertiserWallet(id, query);
  }

  @Post('advertisers/:id/verify')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'Verify an advertiser business registration' })
  verifyAdvertiser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.users.decideAdvertiser(id, 'verified', dto.note, actorOf(auth, ip));
  }

  @Post('advertisers/:id/reject')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'Reject an advertiser verification (reason required)' })
  rejectAdvertiser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.users.decideAdvertiser(id, 'rejected', dto.reason, actorOf(auth, ip));
  }
}

/* ------------------------------------------------------------------ */
/* Fraud dashboard                                                     */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/fraud')
@Subjects('admin')
@Roles('super_admin', 'support', 'finance')
export class AdminFraudController {
  constructor(
    private readonly fraud: FraudService,
    private readonly reports: AdminReportsService,
  ) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'Aggregate fraud metrics (weekly flagged rate, open flags by severity, daily series)',
  })
  metrics() {
    return this.fraud.metrics();
  }

  @Get('flags')
  @ApiOperation({ summary: 'Fraud flags (filter by severity / resolved / user / type)' })
  flags(@Query() query: FraudFlagsQueryDto) {
    return this.fraud.listFlags(query);
  }

  @Get('flags/:id')
  @ApiOperation({ summary: 'Flag detail' })
  flag(@Param('id', ParseUUIDPipe) id: string) {
    return this.fraud.getFlag(id);
  }

  @Post('flags/:id/dismiss')
  @ApiOperation({
    summary: 'Dismiss (false positive). A flagged completion whose flags are all dismissed is credited.',
  })
  dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveFraudFlagDto | OptionalNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.reports.dismissFlag(id, (dto as OptionalNoteDto).note ?? 'Dismissed', actorOf(auth, ip));
  }

  @Post('flags/:id/escalate')
  @ApiOperation({ summary: 'Escalate for deeper investigation (trust score -10)' })
  escalate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.reports.escalateFlag(id, dto.note ?? 'Escalated', actorOf(auth, ip));
  }

  @Post('flags/:id/suspend-user')
  @ApiOperation({ summary: 'Confirm the flag and suspend the user' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.reports.suspendUserFromFlag(id, dto.reason, actorOf(auth, ip));
  }
}

/* ------------------------------------------------------------------ */
/* Withdrawal queue                                                    */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/withdrawals')
@Subjects('admin')
@Roles('super_admin', 'finance')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  @ApiOperation({ summary: 'Withdrawal queue (filter by status; flagged_for_review first)' })
  list(@Query() query: AdminWithdrawalsQueryDto) {
    return this.withdrawals.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Withdrawal detail with approvals' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.getForAdmin(id);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve a held withdrawal. Large amounts need two DISTINCT finance/super_admin approvals.',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.withdrawals.approve(id, { adminId: auth.subjectId, role: auth.role!, ip }, dto.note);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a held/pending withdrawal (coins refunded via reversing ledger entry)' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.withdrawals.reject(id, { adminId: auth.subjectId, role: auth.role!, ip }, dto.reason);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed payout' })
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.withdrawals.retry(id, { adminId: auth.subjectId, role: auth.role!, ip });
  }

  @Post(':id/resolve-manual-review')
  @ApiOperation({
    summary: 'Resolve a needs_manual_review payout after checking the partner (Phase 5 #7)',
    description:
      'The worker parks a withdrawal as needs_manual_review when the partner outcome is unknown (timeout / 5xx / polling exhausted); the coins stay held. `completed` keeps them debited, `failed` refunds them. Audited with the reason.',
  })
  @ApiResponse({ status: 409, description: 'WITHDRAWAL_NOT_REVIEWABLE (not in needs_manual_review)' })
  resolveManualReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveManualReviewDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.withdrawals.resolveManualReview(id, { adminId: auth.subjectId, role: auth.role!, ip }, dto);
  }
}

/* ------------------------------------------------------------------ */
/* Coin adjustments (dual approval)                                    */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/coin-adjustments')
@Subjects('admin')
@Roles('super_admin', 'finance')
export class AdminCoinAdjustmentsController {
  constructor(private readonly adjustments: CoinAdjustmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Adjustment requests (pending first)' })
  list(@Query() query: AdminCoinAdjustmentsQueryDto) {
    return this.adjustments.list(query);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @ApiOperation({ summary: 'Step 1: request a manual coin adjustment (nothing is credited yet)' })
  create(@Body() dto: CreateCoinAdjustmentDto, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.adjustments.create(dto, actorOf(auth, ip));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Adjustment request detail' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adjustments.get(id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Step 2: a DIFFERENT admin approves; the ledger is written exactly once' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.adjustments.approve(id, dto.note, actorOf(auth, ip));
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a pending request' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.adjustments.reject(id, dto.reason, actorOf(auth, ip));
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Requester cancels their own pending request' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.adjustments.cancel(id, actorOf(auth, ip));
  }
}

/* ------------------------------------------------------------------ */
/* Revenue, audit log, offers verification                             */
/* ------------------------------------------------------------------ */

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Subjects('admin')
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get('revenue/overview')
  @Roles('super_admin', 'finance')
  @ApiOperation({
    summary: 'Revenue dashboard: spend, rewards, platform revenue, payouts, top-ups; daily + by advertiser',
  })
  revenue(@Query() query: RevenueQueryDto) {
    return this.reports.revenue(query);
  }

  @Get('audit-log')
  @Roles('super_admin', 'finance', 'support')
  @ApiOperation({ summary: 'Searchable audit log' })
  audit(@Query() query: AuditLogQueryDto) {
    return this.reports.auditLog(query);
  }

  @Get('offers/app-install-completions')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'App-install completions awaiting verification' })
  appInstalls(@Query() query: AppInstallCompletionsQueryDto) {
    return this.reports.listAppInstallCompletions(query);
  }

  @Post('offers/app-install-completions/:id/verify')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'Verify an install (credits the user via the ledger)' })
  verifyInstall(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.reports.decideAppInstall(id, 'valid', dto.note, actorOf(auth, ip));
  }

  @Post('offers/app-install-completions/:id/reject')
  @Roles('super_admin', 'support')
  @ApiOperation({ summary: 'Reject an install claim' })
  rejectInstall(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectWithReasonDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.reports.decideAppInstall(id, 'rejected', dto.reason, actorOf(auth, ip));
  }
}
