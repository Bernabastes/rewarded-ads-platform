import { mockAudit, mockPrisma, mockQueue, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { parseProbe, posterArgs, probeArgs, transcodeArgs, type MediaTools, type ProbeResult } from './ffmpeg.tools';
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
    storageKeyFromPublicUrl: jest.fn((_url: string): string | null => null),
  };
}
let fakeStorageRef: ReturnType<typeof fakeStorage>;

const AD_ID = uuid(10);
const ADVERTISER_ID = uuid(30);
const baseAd = {
  id: AD_ID,
  campaignId: uuid(20),
  mediaType: 'video',
  mediaUrl: `http://localhost:9000/rap-media/creatives/${ADVERTISER_ID}/2026-09-28/raw.mp4`,
  storageKey: `creatives/${ADVERTISER_ID}/2026-09-28/raw.mp4`,
  thumbnailUrl: null,
  durationSeconds: 15,
  durationDeclaredSeconds: 15,
  mediaStatus: 'processing',
  originalMediaUrl: null,
  mediaError: null,
  campaign: { advertiserId: ADVERTISER_ID },
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
      `creatives/${ADVERTISER_ID}/processed/${AD_ID}/transcoded.mp4`,
      `creatives/${ADVERTISER_ID}/processed/${AD_ID}/poster.png`,
    ]);
    const update = prisma.ad.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({
      mediaStatus: 'ready',
      durationSeconds: 15, // unchanged (within tolerance)
      durationProbedSeconds: 15,
      durationDeclaredSeconds: 15,
      mediaUrl: `http://localhost:9000/rap-media/creatives/${ADVERTISER_ID}/processed/${AD_ID}/transcoded.mp4`,
      originalMediaUrl: baseAd.mediaUrl,
      thumbnailUrl: `http://localhost:9000/rap-media/creatives/${ADVERTISER_ID}/processed/${AD_ID}/poster.png`,
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

  it('marks the ad failed with a GENERIC message when transcoding fails (review must refuse approval; detail stays server-side)', async () => {
    const service = build(fakeTools({}, { failTranscode: true }));
    const outcome = await service.process(AD_ID);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/could not be transcoded/);
    expect(outcome.error).not.toMatch(/invalid data/);
    const update = prisma.ad.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(update.data).toMatchObject({ mediaStatus: 'failed', mediaError: expect.stringMatching(/could not be transcoded/) });
    expect(fakeStorageRef.uploads).toHaveLength(0);
  });

  describe('security audit #2: media sources', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('never fetches a remote mediaUrl - an ad without a readable storage key fails generically', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as never;
      prisma.ad.findUnique.mockResolvedValue({ ...baseAd, storageKey: null, mediaUrl: 'http://127.0.0.1:3000/ssrf-probe' });
      const tools = fakeTools();
      const service = build(tools);
      const outcome = await service.process(AD_ID);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fakeStorageRef.downloadToFile).not.toHaveBeenCalled();
      expect(tools.probe).not.toHaveBeenCalled();
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toMatch(/could not be read from storage/);
      expect(outcome.error).not.toMatch(/127\.0\.0\.1|404|3000/);
    });

    it('refuses storage keys outside the advertiser prefix (e.g. private/kyc/...) and never reads them', async () => {
      prisma.ad.findUnique.mockResolvedValue({ ...baseAd, storageKey: 'private/kyc/someone-else/id-front.jpg' });
      const service = build(fakeTools());
      const outcome = await service.process(AD_ID);
      expect(outcome.status).toBe('failed');
      expect(fakeStorageRef.exists).not.toHaveBeenCalled();
      expect(fakeStorageRef.downloadToFile).not.toHaveBeenCalled();
      // another advertiser's creatives are off limits too
      prisma.ad.findUnique.mockResolvedValue({ ...baseAd, storageKey: `creatives/${uuid(99)}/2026-09-28/raw.mp4` });
      expect((await build(fakeTools()).process(AD_ID)).status).toBe('failed');
    });

    it('accepts a mediaUrl that points into our own bucket under the advertiser prefix (derives the key)', async () => {
      prisma.ad.findUnique.mockResolvedValue({ ...baseAd, storageKey: null });
      const service = build(fakeTools());
      fakeStorageRef.storageKeyFromPublicUrl = jest.fn((_url: string): string | null => `creatives/${ADVERTISER_ID}/2026-09-28/raw.mp4`);
      const outcome = await service.process(AD_ID);
      expect(outcome.status).toBe('ready');
      expect(fakeStorageRef.downloadToFile).toHaveBeenCalledWith(
        `creatives/${ADVERTISER_ID}/2026-09-28/raw.mp4`,
        expect.any(String),
        expect.objectContaining({ maxBytes: expect.any(Number), timeoutMs: expect.any(Number) }),
      );
    });

    it('output renditions always land under creatives/<advertiserId>/processed/<adId>/, whatever the input key', async () => {
      prisma.ad.findUnique.mockResolvedValue({ ...baseAd, storageKey: 'seed/morning-roast.mp4' });
      const service = build(fakeTools());
      await service.process(AD_ID);
      expect(fakeStorageRef.uploads.map((u) => u.key)).toEqual([
        `creatives/${ADVERTISER_ID}/processed/${AD_ID}/transcoded.mp4`,
        `creatives/${ADVERTISER_ID}/processed/${AD_ID}/poster.png`,
      ]);
    });
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

describe('ffmpeg hardening (security audit #2)', () => {
  it('every ffmpeg/ffprobe invocation whitelists only file/pipe protocols and ffmpeg never reads stdin', () => {
    const probe = probeArgs('/tmp/in');
    expect(probe.slice(probe.indexOf('-protocol_whitelist'), probe.indexOf('-protocol_whitelist') + 2)).toEqual(['-protocol_whitelist', 'file,pipe']);
    expect(probe.indexOf('-protocol_whitelist')).toBeLessThan(probe.indexOf('/tmp/in'));
    for (const args of [transcodeArgs('/tmp/in', '/tmp/out.mp4', 720), posterArgs('/tmp/in', '/tmp/poster.png')]) {
      expect(args[0]).toBe('-nostdin');
      const i = args.indexOf('-protocol_whitelist');
      expect(args[i + 1]).toBe('file,pipe');
      expect(i).toBeLessThan(args.indexOf('-i'));
      expect(args.join(' ')).not.toMatch(/https?|tcp|data:/);
    }
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
