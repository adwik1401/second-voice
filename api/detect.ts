import { parseDetectRequest } from './_lib/detect.js';
import { detectCoaching } from './_lib/detect-flow.js';
import { badRequest, json } from './_lib/http.js';

/**
 * POST /api/detect — does anything said near the customer read as coaching?
 * Rules answer instantly and need no key. Set DETECT_MODEL (and DETECT_STRUCTURED=0 for models without
 * `response_format`, such as qwen3.5-4b-32k-fast) to add an LLM second opinion for what the rules miss.
 * Always 200 once the request is valid: an LLM failure only sets `degraded` on the verdict.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('body must be JSON');
  }
  const parsed = parseDetectRequest(body);
  if (!parsed) return badRequest('invalid request');

  return json(
    await detectCoaching(parsed, {
      apiKey: process.env.ASSEMBLYAI_API_KEY,
      model: process.env.DETECT_MODEL || undefined,
      structured: process.env.DETECT_STRUCTURED !== '0',
    }),
  );
}
