/**
 * Orchestrates coaching detection for /api/detect: rules first, optional LLM second opinion.
 *
 *  1. Rules (src/core/coaching-rules.ts): instant, offline, unmanipulable. A hit is final — the LLM is never
 *     consulted, never overrides it, and no quota is spent.
 *  2. LLM (api/_lib/detect.ts): only when the rules found nothing AND the operator opted in with DETECT_MODEL
 *     and an API key. It catches paraphrases the patterns miss. If it fails, the verdict says so (`degraded`).
 *  3. Otherwise: `unclear` with zero confidence — "nothing recognised", which is not evidence of innocence.
 */
import { classifyByRules } from '../../src/core/coaching-rules.js';
import { classify, type DetectRequest, type DetectResponse } from './detect.js';

export interface DetectOptions {
  apiKey?: string;
  /** Opt-in LLM second opinion (e.g. "qwen3.5-4b-32k-fast"). Unset = rules only. */
  model?: string;
  /** false for models that reject `response_format` (see classify()). Default true. */
  structured?: boolean;
  fetchImpl?: typeof fetch;
}

export type DetectVerdict = DetectResponse & { source: 'rules' | 'llm' };

export async function detectCoaching(req: DetectRequest, opts: DetectOptions = {}): Promise<DetectVerdict> {
  const rules = classifyByRules(req.utterances.map((u) => u.text));
  if (rules) return { isCoaching: true, ...rules, source: 'rules' };

  let degraded = false;
  if (opts.model && opts.apiKey) {
    const llm = await classify(req, opts.apiKey, { model: opts.model, structured: opts.structured, fetchImpl: opts.fetchImpl });
    if (!llm.degraded) return { ...llm, source: 'llm' };
    degraded = true; // the second opinion was wanted but unavailable — let the panel say so
  }
  return { isCoaching: false, type: 'unclear', quote: '', confidence: 0, source: 'rules', ...(degraded ? { degraded } : {}) };
}
