/**
 * Asks /api/detect whether anything said near the customer reads as coaching (rules, plus the opt-in LLM the
 * server may add). If the server is unreachable or rejects the request, the SAME rules run locally in the
 * browser, so detection never depends on the network: a coach cannot be missed just because a request failed.
 */
import { classifyByRules } from '../core/coaching-rules';
import type { ConversationTurn } from '../core/types';

export interface DetectInput {
  utterances: { source: 'agent_stream' | 'room_stream'; text: string }[];
  recentConversation: Pick<ConversationTurn, 'role' | 'text'>[];
  transfer: { amountGBP: number; payeeName: string; purpose?: string };
}

export interface DetectResult {
  isCoaching: boolean;
  type: string;
  quote: string;
  confidence: number;
  source: 'rules' | 'llm';
  degraded?: boolean;
}

// Mirror the server's validation limits (api/_lib/detect.ts) so a long session never makes the request invalid.
const MAX_UTTERANCES = 10;
const MAX_CONVERSATION = 12;
const MAX_TEXT = 600;
const clip = (text: string) => text.slice(0, MAX_TEXT);

function localVerdict(input: DetectInput): DetectResult {
  const rules = classifyByRules(input.utterances.map((u) => u.text));
  return rules
    ? { isCoaching: true, ...rules, source: 'rules' }
    : { isCoaching: false, type: 'unclear', quote: '', confidence: 0, source: 'rules' };
}

export async function detectCoaching(input: DetectInput, fetchImpl: typeof fetch = fetch): Promise<DetectResult> {
  const body = {
    utterances: input.utterances.slice(-MAX_UTTERANCES).map((u) => ({ ...u, text: clip(u.text) })),
    recentConversation: input.recentConversation.slice(-MAX_CONVERSATION).map((c) => ({ ...c, text: clip(c.text) })),
    transfer: { ...input.transfer, payeeName: clip(input.transfer.payeeName), ...(input.transfer.purpose ? { purpose: clip(input.transfer.purpose) } : {}) },
  };
  try {
    const res = await fetchImpl('/api/detect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Partial<DetectResult>;
    if (typeof data.isCoaching !== 'boolean' || typeof data.confidence !== 'number' || typeof data.type !== 'string') {
      throw new Error('unexpected response');
    }
    return { isCoaching: data.isCoaching, type: data.type, quote: data.quote ?? '', confidence: data.confidence, source: data.source ?? 'rules', degraded: data.degraded };
  } catch {
    return localVerdict({ ...input, utterances: body.utterances });
  }
}
