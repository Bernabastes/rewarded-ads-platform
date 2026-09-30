import { BANNED_TOPICS, ErrorCode } from '@rap/shared';
import { mockAudit, mockPrisma, mockSecurity, uuid } from '../../../testing/test-utils';
import { AdminReviewService } from './admin-review.service';

const ADMIN = uuid(1);
const AD = uuid(10);

function adRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AD,
    reviewStatus: 'pending',
    mediaStatus: 'ready',
    mediaError: null,
    bannedTopicsChecklist: null,
    reviewedBy: null,
    reviewNote: null,
    campaign: {
      id: uuid(20),
      title: 'Fresh dabo',
      status: 'active',
      targetActionType: 'video_view',
      costPerActionEtb: 2,
      budgetEtb: 500,
      advertiser: { id: uuid(30), businessName: 'Habesha Coffee', verificationStatus: 'verified' },
    },
    attentionQuestions: [],
    _count: { attentionQuestions: 0, reports: 0 },
    ...overrides,
  };
}

describe('AdminReviewService review queue (Phase 4C/4D: mediaStatus filter + media gate)', () => {
  let prisma: any;
  let service: AdminReviewService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new AdminReviewService(
      prisma,
      mockAudit(),
      mockSecurity(),
      { toAdSummary: (a: any) => ({ id: a.id, mediaStatus: a.mediaStatus, reviewStatus: a.reviewStatus }) } as never,
      {} as never,
      {} as never,
    );
    prisma.ad.findMany.mockResolvedValue([adRow()]);
    prisma.ad.count.mockResolvedValue(1);
  });

  it('defaults to the pending queue without a media filter', async () => {
    const page = await service.reviewQueue({});
    expect(prisma.ad.findMany.mock.calls[0][0].where).toEqual({ reviewStatus: 'pending', mediaStatus: undefined });
    expect(prisma.ad.count.mock.calls[0][0].where).toEqual({ reviewStatus: 'pending', mediaStatus: undefined });
    expect(page.data[0]).toMatchObject({ id: AD, mediaStatus: 'ready', openReports: 0 });
    expect(page.meta.total).toBe(1);
  });

  it('honours ?mediaStatus= for both the rows and the total (same where clause)', async () => {
    for (const mediaStatus of ['processing', 'ready', 'duration_corrected', 'failed'] as const) {
      prisma.ad.findMany.mockClear();
      prisma.ad.count.mockClear();
      await service.reviewQueue({ status: 'approved', mediaStatus });
      const where = { reviewStatus: 'approved', mediaStatus };
      expect(prisma.ad.findMany.mock.calls[0][0].where).toEqual(where);
      expect(prisma.ad.count.mock.calls[0][0].where).toEqual(where);
    }
  });

  it('refuses to approve while the creative is processing or failed (422 MEDIA_NOT_READY)', async () => {
    const checks = Object.fromEntries(BANNED_TOPICS.map((t) => [t.key, true]));
    prisma.ad.findUnique.mockResolvedValueOnce(adRow({ mediaStatus: 'processing' }));
    await expect(service.approveAd(AD, { checks } as never, undefined, { adminId: ADMIN })).rejects.toMatchObject({
      code: ErrorCode.MEDIA_NOT_READY,
      status: 422,
      details: { mediaStatus: 'processing', mediaError: null },
    });
    prisma.ad.findUnique.mockResolvedValueOnce(adRow({ mediaStatus: 'failed', mediaError: 'ffprobe: no video stream' }));
    await expect(service.approveAd(AD, { checks } as never, undefined, { adminId: ADMIN })).rejects.toMatchObject({
      code: ErrorCode.MEDIA_NOT_READY,
      details: { mediaStatus: 'failed', mediaError: 'ffprobe: no video stream' },
    });
    expect(prisma.ad.update).not.toHaveBeenCalled();
  });
});
