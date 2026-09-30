import { describe, expect, it, vi } from 'vitest';
import { detectCoaching, type DetectInput } from './detect-client';
import { fetchAgentToken } from './token';

const input = (text: string): DetectInput => ({
  utterances: [{ source: 'agent_stream', text }],
  recentConversation: [{ role: 'agent', text: "What's this payment for?" }],
  transfer: { amountGBP: 8000, payeeName: 'Northgate Autos Ltd', purpose: 'car' },
});
const serverSays = (body: object, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('detectCoaching', () => {
  it('returns the server’s verdict', async () => {
    const f = serverSays({ isCoaching: true, type: 'script_feeding', quote: 'tell her', confidence: 0.88, source: 'llm' });
    expect(await detectCoaching(input('whatever'), f)).toEqual({
      isCoaching: true,
      type: 'script_feeding',
      quote: 'tell her',
      confidence: 0.88,
      source: 'llm',
      degraded: undefined,
    });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/detect');
    expect(init.method).toBe('POST');
  });

  it('keeps the degraded flag so the panel can say the second opinion was unavailable', async () => {
    const f = serverSays({ isCoaching: false, type: 'unclear', quote: '', confidence: 0, source: 'rules', degraded: true });
    expect((await detectCoaching(input('dinner is at seven'), f)).degraded).toBe(true);
  });

  describe('falls back to the same rules locally when the server cannot answer', () => {
    const coach = "Tell her it's for a car deposit. Don't mention me.";

    it('on a network error', async () => {
      const f = vi.fn(async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch;
      expect(await detectCoaching(input(coach), f)).toMatchObject({ isCoaching: true, type: 'secrecy_instruction', source: 'rules' });
    });

    it('on an HTTP error', async () => {
      expect(await detectCoaching(input(coach), serverSays({}, 500))).toMatchObject({ isCoaching: true, source: 'rules' });
    });

    it('on a malformed response', async () => {
      expect(await detectCoaching(input(coach), serverSays({ nonsense: true }))).toMatchObject({ isCoaching: true, source: 'rules' });
    });

    it('and says "unclear" for benign text', async () => {
      expect(await detectCoaching(input("It's for my friend."), serverSays({}, 500))).toEqual({
        isCoaching: false,
        type: 'unclear',
        quote: '',
        confidence: 0,
        source: 'rules',
      });
    });
  });

  it('trims what it sends to the server’s limits (a long session must not make the request invalid)', async () => {
    const f = serverSays({ isCoaching: false, type: 'unclear', quote: '', confidence: 0, source: 'rules' });
    await detectCoaching(
      {
        utterances: Array.from({ length: 15 }, (_, i) => ({ source: 'agent_stream' as const, text: `line ${i}` })),
        recentConversation: Array.from({ length: 20 }, () => ({ role: 'customer' as const, text: 'x'.repeat(900) })),
        transfer: { amountGBP: 1, payeeName: 'P' },
      },
      f,
    );
    const body = JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.utterances).toHaveLength(10);
    expect(body.utterances.at(-1).text).toBe('line 14'); // the most recent are kept
    expect(body.recentConversation).toHaveLength(12);
    expect(body.recentConversation[0].text).toHaveLength(600);
  });
});

describe('fetchAgentToken', () => {
  it('returns the token and the agent id', async () => {
    expect(await fetchAgentToken(serverSays({ token: 't', agentId: 'a' }))).toEqual({ token: 't', agentId: 'a' });
  });
  it('throws on an HTTP error or an incomplete response', async () => {
    await expect(fetchAgentToken(serverSays({}, 500))).rejects.toThrow(/HTTP 500/);
    await expect(fetchAgentToken(serverSays({ token: 't' }))).rejects.toThrow(/incomplete/);
  });
});
