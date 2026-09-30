import { tokenResponse } from '../_lib/assemblyai';

/** GET /api/token/agent — single-use token for a Voice Agent API browser session. */
export function GET(): Promise<Response> {
  return tokenResponse('agent');
}
