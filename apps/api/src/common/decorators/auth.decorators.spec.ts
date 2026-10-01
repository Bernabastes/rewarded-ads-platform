import express, { type Request } from 'express';
import type { AddressInfo } from 'node:net';
import { extractClientIp } from './auth.decorators';

/**
 * Security audit #3: the client IP must come from `req.ip` (socket + trusted proxy hops), never from a
 * client-supplied X-Forwarded-For header.
 */
describe('extractClientIp', () => {
  it('ignores X-Forwarded-For and uses req.ip (the Express trust-proxy result)', () => {
    const req = {
      ip: '10.0.0.7',
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      socket: { remoteAddress: '10.0.0.7' },
    } as unknown as Request;
    expect(extractClientIp(req)).toBe('10.0.0.7');
  });

  it('strips the IPv4-mapped IPv6 prefix and falls back to the socket address', () => {
    expect(extractClientIp({ ip: '::ffff:192.168.1.9', headers: {} } as unknown as Request)).toBe('192.168.1.9');
    expect(extractClientIp({ headers: {}, socket: { remoteAddress: '::1' } } as unknown as Request)).toBe('::1');
    expect(extractClientIp({ headers: {} } as unknown as Request)).toBe('0.0.0.0');
  });

  async function ipSeenBy(trustProxyHops: number, headers: Record<string, string>): Promise<string> {
    const app = express();
    app.set('trust proxy', trustProxyHops);
    app.get('/', (req, res) => res.json({ ip: extractClientIp(req) }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
      return ((await res.json()) as { ip: string }).ip;
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('with TRUST_PROXY_HOPS=0 (direct exposure) a spoofed header changes nothing', async () => {
    expect(await ipSeenBy(0, { 'x-forwarded-for': '203.0.113.99' })).toBe('127.0.0.1');
    expect(await ipSeenBy(0, { 'x-forwarded-for': '203.0.113.99, 198.51.100.1' })).toBe('127.0.0.1');
    expect(await ipSeenBy(0, {})).toBe('127.0.0.1');
  });

  it('with TRUST_PROXY_HOPS=1 only the LAST hop appended by the proxy is trusted, not an arbitrary first value', async () => {
    // our test client plays the single trusted proxy; the value it appends last is the "client" it saw
    expect(await ipSeenBy(1, { 'x-forwarded-for': '203.0.113.99, 198.51.100.1' })).toBe('198.51.100.1');
  });
});
