import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { config, routes } from './functions/api.mjs';

const call = (path: string, init?: RequestInit) => handler(new Request(`https://example.netlify.app${path}`, init));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Netlify /api dispatcher', () => {
  it('claims every /api/* path', () => {
    expect(config.path).toBe('/api/*');
  });

  it('serves the same six routes as the Vercel layout', () => {
    expect(Object.keys(routes).sort()).toEqual(
      ['/api/bank/payee-check', '/api/bank/payee-risk', '/api/bank/profile', '/api/detect', '/api/token/agent', '/api/token/stt'].sort(),
    );
  });

  it('dispatches GET /api/bank/payee-check to the real handler', async () => {
    const res = await call('/api/bank/payee-check?sortCode=99-12-34&accountNumber=71829035&name=Northgate%20Autos%20Ltd');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: 'NO_MATCH', accountType: 'personal' });
  });

  it('dispatches POST /api/detect with its body (rules need no key)', async () => {
    const res = await call('/api/detect', {
      method: 'POST',
      body: JSON.stringify({
        utterances: [{ source: 'room_stream', text: "Tell her it's for a car deposit. Don't mention me." }],
        recentConversation: [],
        transfer: { amountGBP: 8000, payeeName: 'X' },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isCoaching: true, source: 'rules' });
  });

  it('dispatches the token routes (a 500 "not configured" proves the real handler ran)', async () => {
    vi.stubEnv('ASSEMBLYAI_API_KEY', '');
    for (const p of ['/api/token/agent', '/api/token/stt']) {
      const res = await call(p);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toMatch(/ASSEMBLYAI_API_KEY/);
    }
  });

  it('ignores a trailing slash', async () => {
    expect((await call('/api/bank/profile/?customerId=cust-sarah')).status).toBe(200);
  });

  it('404s an unknown route', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
  });

  it('405s a known route with the wrong method and says which are allowed', async () => {
    const res = await call('/api/detect');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
    expect((await call('/api/bank/profile', { method: 'POST', body: '{}' })).status).toBe(405);
  });
});
