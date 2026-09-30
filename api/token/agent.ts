import { tokenResponse } from '../_lib/assemblyai.js';

/** GET /api/token/agent — single-use token for a Voice Agent API browser session. */
export function GET(): Promise<Response> {
  return tokenResponse('agent');
}
