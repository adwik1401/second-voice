import { tokenResponse } from '../_lib/assemblyai';

/** GET /api/token/stt — single-use token for a Realtime STT browser session (room stream). */
export function GET(): Promise<Response> {
  return tokenResponse('stt');
}
