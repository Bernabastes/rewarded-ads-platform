import { testConfig, uuid } from '../../testing/test-utils';
import {
  creativesPrefixFor,
  isCreativeKeyOf,
  isReadableCreativeKey,
  isWellFormedStorageKey,
  StorageService,
} from './storage.service';

const ADV = uuid(7);

describe('storage keys (security audit #2)', () => {
  it('well-formed keys have no traversal, empty segments or leading slashes', () => {
    expect(isWellFormedStorageKey(`creatives/${ADV}/2026-10-01/a.mp4`)).toBe(true);
    expect(isWellFormedStorageKey('seed/morning-roast.mp4')).toBe(true);
    for (const bad of ['', '/creatives/x', 'creatives//x', 'creatives/../private/kyc/x', 'creatives/./x', 'creatives/x?y', 'creatives/x y', 'a'.repeat(301)]) {
      expect(isWellFormedStorageKey(bad)).toBe(false);
    }
  });

  it('only keys under the advertiser prefix are creatives of that advertiser', () => {
    expect(creativesPrefixFor(ADV)).toBe(`creatives/${ADV}/`);
    expect(isCreativeKeyOf(ADV, `creatives/${ADV}/2026-10-01/a.mp4`)).toBe(true);
    expect(isCreativeKeyOf(ADV, `creatives/${uuid(8)}/2026-10-01/a.mp4`)).toBe(false);
    expect(isCreativeKeyOf(ADV, `private/kyc/${ADV}/front.jpg`)).toBe(false);
    expect(isCreativeKeyOf(ADV, `creatives/${ADV}/../../private/kyc/x`)).toBe(false);
    expect(isCreativeKeyOf(ADV, `creatives/${ADV}`)).toBe(false);
  });

  it('the media worker may additionally read platform seed assets but nothing else', () => {
    expect(isReadableCreativeKey(ADV, 'seed/morning-roast.mp4')).toBe(true);
    expect(isReadableCreativeKey(ADV, 'private/exports/x.zip')).toBe(false);
    expect(isReadableCreativeKey(ADV, 'seed/../private/exports/x.zip')).toBe(false);
  });
});

describe('StorageService.storageKeyFromPublicUrl', () => {
  const storage = new StorageService(testConfig({ S3_PUBLIC_URL: 'http://localhost:9000', S3_BUCKET: 'rap-media' }));

  it('maps a URL inside our bucket on the public endpoint back to its key', () => {
    expect(storage.storageKeyFromPublicUrl(`http://localhost:9000/rap-media/creatives/${ADV}/2026-10-01/a.mp4`)).toBe(
      `creatives/${ADV}/2026-10-01/a.mp4`,
    );
    expect(storage.storageKeyFromPublicUrl('http://localhost:9000/rap-media/creatives/x/a%20b.mp4')).toBeNull(); // spaces are not well-formed
  });

  it('refuses every other origin, bucket, scheme or decorated URL (SSRF targets)', () => {
    for (const url of [
      'http://127.0.0.1:3000/ssrf-probe',
      'http://localhost:3000/rap-media/creatives/x.mp4', // other port
      'http://169.254.169.254/latest/meta-data/',
      'http://minio:9000/rap-media/creatives/x.mp4', // internal host name
      'http://localhost:9000/other-bucket/creatives/x.mp4',
      'http://localhost:9000/rap-media/private/kyc/u/front.jpg', // fine as a key but still only returned, the caller checks the prefix
      'ftp://localhost:9000/rap-media/creatives/x.mp4',
      'http://user:pass@localhost:9000/rap-media/creatives/x.mp4',
      'http://localhost:9000/rap-media/creatives/x.mp4?x=1',
      'http://localhost:9000/rap-media/creatives/x.mp4#frag',
      'http://localhost:9000/rap-media/../etc/passwd',
      'not a url',
    ]) {
      const key = storage.storageKeyFromPublicUrl(url);
      if (url.includes('/rap-media/private/')) expect(key).toBe('private/kyc/u/front.jpg');
      else expect(key).toBeNull();
    }
  });
});
