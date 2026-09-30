import { describe, expect, it, vi } from 'vitest';
import { mintToken, tokenResponse } from './assemblyai';

/** Builds a fetch stub that records the request and replies with the given JSON body/status. */
function stubFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('mintToken', () => {
  it('calls the Voice Agent endpoint with a Bearer header and expiry params', async () => {
    const f = stubFetch({ token: 'agent-tok' });
    await expect(mintToken('agent', 'KEY', f)).resolves.toBe('agent-tok');

    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://agents.assemblyai.com/v1/token');
    expect(url.searchParams.get('expires_in_seconds')).toBe('120');
    expect(url.searchParams.get('max_session_duration_seconds')).toBe('600');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer KEY');
  });

  it('calls the streaming endpoint with the raw key (no Bearer prefix)', async () => {
    const f = stubFetch({ token: 'stt-tok' });
    await expect(mintToken('stt', 'KEY', f)).resolves.toBe('stt-tok');

    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://streaming.assemblyai.com/v3/token');
    expect((init.headers as Record<string, string>).Authorization).toBe('KEY');
  });

  it('throws on a non-2xx upstream response', async () => {
    await expect(mintToken('agent', 'KEY', stubFetch({}, 401))).rejects.toThrow('HTTP 401');
  });

  it('throws when the upstream body has no token', async () => {
    await expect(mintToken('stt', 'KEY', stubFetch({ nope: true }))).rejects.toThrow('no token');
  });
});

describe('tokenResponse', () => {
  it('returns 500 when the API key is not configured', async () => {
    const res = await tokenResponse('agent', {}, stubFetch({ token: 'x' }));
    expect(res.status).toBe(500);
  });

  it('returns { token } with no-store caching on success', async () => {
    const res = await tokenResponse('stt', { ASSEMBLYAI_API_KEY: 'KEY' }, stubFetch({ token: 'abc' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ token: 'abc' });
  });

  it('returns 502 and does not leak upstream detail or the key on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await tokenResponse('agent', { ASSEMBLYAI_API_KEY: 'SECRET' }, stubFetch({}, 500));
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('500');
    spy.mockRestore();
  });
});
