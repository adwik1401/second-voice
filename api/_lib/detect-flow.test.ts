import { describe, expect, it, vi } from 'vitest';
import type { DetectRequest } from './detect';
import { detectCoaching } from './detect-flow';

const req = (text: string): DetectRequest => ({
  utterances: [{ source: 'room_stream', text }],
  recentConversation: [],
  transfer: { amountGBP: 8000, payeeName: 'Northgate Autos Ltd' },
});
const llm = (content: object, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;
const verdict = { isCoaching: true, type: 'script_feeding', quote: 'x', confidence: 0.9 };

describe('detectCoaching', () => {
  it('returns a rules hit immediately and never calls the LLM', async () => {
    const f = llm(verdict);
    const r = await detectCoaching(req("Tell her it's for a car deposit. Don't mention me."), { apiKey: 'K', model: 'm', fetchImpl: f });
    expect(r).toMatchObject({ isCoaching: true, type: 'secrecy_instruction', source: 'rules' });
    expect(f).not.toHaveBeenCalled();
  });

  it('with no LLM configured, unmatched text is "unclear" with zero confidence, not degraded', async () => {
    expect(await detectCoaching(req('Dinner is at seven.'))).toEqual({
      isCoaching: false,
      type: 'unclear',
      quote: '',
      confidence: 0,
      source: 'rules',
    });
  });

  it('needs both a model and a key before it will call the LLM', async () => {
    const f = llm(verdict);
    await detectCoaching(req('Dinner is at seven.'), { model: 'm', fetchImpl: f });
    await detectCoaching(req('Dinner is at seven.'), { apiKey: 'K', fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
  });

  it('uses the LLM verdict when the rules find nothing', async () => {
    const r = await detectCoaching(req('Stay calm and read out the reason I gave you.'), { apiKey: 'K', model: 'm', fetchImpl: llm(verdict) });
    expect(r).toMatchObject({ isCoaching: true, source: 'llm', confidence: 0.9 });
  });

  it('can report the LLM found nothing (benign) without raising an alarm', async () => {
    const f = llm({ isCoaching: false, type: 'benign_chatter', quote: '', confidence: 0.95 });
    const r = await detectCoaching(req('Dinner is at seven.'), { apiKey: 'K', model: 'm', fetchImpl: f });
    expect(r).toMatchObject({ isCoaching: false, type: 'benign_chatter', source: 'llm' });
  });

  it('flags degraded when the LLM was wanted but failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await detectCoaching(req('Dinner is at seven.'), { apiKey: 'K', model: 'm', fetchImpl: llm({}, 429) });
    expect(r).toMatchObject({ isCoaching: false, type: 'unclear', confidence: 0, degraded: true });
  });
});
