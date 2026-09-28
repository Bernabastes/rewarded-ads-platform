import { mockAudit, mockPrisma, mockQueue, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { parseProbe, type MediaTools, type ProbeResult } from './ffmpeg.tools';
import { MediaService } from './media.service';

function fakeTools(probe: Partial<ProbeResult> = {}, opts: { failTranscode?: boolean; failPoster?: boolean } = {}) {
  const tools = {
    probe: jest.fn(async () => ({
      durationSeconds: 15,
      codec: 'h264',
      width: 1920,
      height: 1080,
      bitrate: 2_000_000,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      ...probe,
    })),
    transcode: jest.fn(async (_i: string, out: string) => {
      if (opts.failTranscode) throw new Error('ffmpeg failed: invalid data');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(out, Buffer.from('mp4'));
    }),
    poster: jest.fn(async (_i: string, out: string) => {
      if (opts.failPoster) throw new Error('no frame');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(out, Buffer.from('png'));
    }),
    describe: () => ({ ffmpeg: 'fake', ffprobe: 'fake' }),
  };
  return tools as unknown as MediaTools & { probe: jest.Mock; transcode: jest.Mock; poster: jest.Mock };
}

function fakeStorage() {
  return {
    uploads: [] as Array<{ key: string; contentType: string }>,
    exists: jest.fn().mockResolvedValue(true),
    downloadToFile: jest.fn(async (_key: string, target: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(target, Buffer.from('source'));
    }),
    upload: jest.fn(async function (this: unknown, key: string, _body: unknown, contentType: string) {
      (fakeStorageRef.uploads as Array<{ key: string; contentType: string }>).push({ key, contentType });
    }),
    publicUrl: (key: string) => `http://localhost:9000/rap-media/${key}`,
  };
}
let fakeStorageRef: ReturnType<typeof fakeStorage>;

const AD_ID = uuid(10);
const baseAd = {
  id: AD_ID,
  campaignId: uuid(20),
  mediaType: 'video',
  mediaUrl: 'http://localhost:9000/rap-media/creatives/adv/2026-09-28/raw.mp4',
  storageKey: 'creatives/adv/2026-09-28/raw.mp4',
  thumbnailUrl: null,
  durationSeconds: 15,
  durationDeclaredSeconds: 15,
  mediaStatus: 'processing',
  originalMediaUrl: null,
  mediaError: null,
  campaign: { advertiserId: uuid(30) },
};

describe('MediaService.process (media.process job)', () => {
  let prisma: ReturnType<typeof mockPrisma>;
  const config = testConfig({ MEDIA_DURATION_TOLERANCE_SECONDS: 1, MEDIA_TARGET_HEIGHT: 720 });

  const build = (tools: MediaTools) => {
    fakeStorageRef = fakeStorage();
    return new MediaService(
      prisma,
      config,
      fakeStorageRef as never,
      mockAudit(),
      mockSecurity(),
      tools,
      mockQueue(),
    );
  };

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.ad.findUnique.mockResolvedValue({ ...baseAd });
    prisma.ad.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...baseAd, ...args.data }));
  });

  it('probes, transcodes to 720p, generates a poster and marks the ad ready when the declared duration matches', async () => {
    const tools = fakeTools({ durationSeconds: 15.4 });
    const service = build(tools);

    const outcome = await service.process(AD_ID);

    expect(outcome.status).toBe('ready');
    expect(tools.probe).toHaveBeenCalledTimes(1);
    expect(tools.transcode).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/transcoded\.mp4$/), 720, expect.any(Number));
    expect(tools.poster).toHaveBeenCalledTimes(1);
    expect(fakeStorageRef.uploads.map((u) => u.key)).toEqual([
      `creatives/adv/2026-09-28/processed/${AD_ID}/transcoded.mp4`,
      `creatives/adv/2026-09-28/processed/${AD_ID}/poster.png`,
    ]);
    const update = prisma.ad.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({
      mediaStatus: 'ready',
      durationSeconds: 15, // unchanged (within tolerance)
      durationProbedSeconds: 15,
      durationDeclaredSeconds: 15,
      mediaUrl: `http://localhost:9000/rap-media/creatives/adv/2026-09-28/processed/${AD_ID}/transcoded.mp4`,
      originalMediaUrl: baseAd.mediaUrl,
      thumbnailUrl: `http://localhost:9000/rap-media/creatives/adv/2026-09-28/processed/${AD_ID}/poster.png`,
    });
    expect((update.data.mediaProbe as ProbeResult).codec).toBe('h264');
  });

  it('corrects the duration and flags duration_corrected when |declared - probed| > tolerance', async () => {
    const service = build(fakeTools({ durationSeconds: 29.8 }));
    const outcome = await service.process(AD_ID);
    expect(outcome.status).toBe('duration_corrected');
    expect(outcome.durationCorrected).toEqual({ declared: 15, probed: 30 });
    const update = prisma.ad.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ mediaStatus: 'duration_corrected', durationSeconds: 30, durationProbedSeconds: 30 });
  });

  it('keeps an advertiser-supplied thumbnail (no poster generated)', async () => {
    prisma.ad.findUnique.mockResolvedValue({ ...baseAd, thumbnailUrl: 'http://cdn/thumb.png' });
    const tools = fakeTools();
    const service = build(tools);
    await service.process(AD_ID);
    expect(tools.poster).not.toHaveBeenCalled();
    const update = prisma.ad.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data.thumbnailUrl).toBe('http://cdn/thumb.png');
  });

  it('marks the ad failed with the error when transcoding fails (review must refuse approval)', async () => {
    const service = build(fakeTools({}, { failTranscode: true }));
    const outcome = await service.process(AD_ID);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/ffmpeg failed/);
    const update = prisma.ad.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ mediaStatus: 'failed', mediaError: expect.stringMatching(/ffmpeg failed/) });
    expect(fakeStorageRef.uploads).toHaveLength(0);
  });

  it('a failed poster does not fail the job', async () => {
    const service = build(fakeTools({}, { failPoster: true }));
    const outcome = await service.process(AD_ID);
    expect(outcome.status).toBe('ready');
    expect(outcome.posterKey).toBeUndefined();
  });

  it('image creatives are marked ready without running ffmpeg', async () => {
    prisma.ad.findUnique.mockResolvedValue({ ...baseAd, mediaType: 'image' });
    const tools = fakeTools();
    const service = build(tools);
    expect((await service.process(AD_ID)).status).toBe('ready');
    expect(tools.probe).not.toHaveBeenCalled();
  });

  it('isEnabled is false in the test environment so new ads are created ready', () => {
    const service = build(fakeTools());
    expect(service.isEnabled()).toBe(false);
  });
});

describe('parseProbe', () => {
  it('extracts duration, codec, dimensions, bitrate and container from ffprobe JSON', () => {
    const out = JSON.stringify({
      streams: [
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
      ],
      format: { duration: '14.980000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2', bit_rate: '1234567' },
    });
    expect(parseProbe(out)).toEqual({
      durationSeconds: 14.98,
      codec: 'h264',
      width: 1280,
      height: 720,
      bitrate: 1234567,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
    });
  });

  it('throws when ffprobe reports no duration', () => {
    expect(() => parseProbe(JSON.stringify({ format: {}, streams: [] }))).toThrow(/no duration/);
  });
});
