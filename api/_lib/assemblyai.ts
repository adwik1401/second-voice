/**
 * Mints short-lived AssemblyAI tokens so the browser never sees the API key.
 *
 * Two products, two endpoints (verified against the AssemblyAI docs):
 *  - Voice Agent API  → GET https://agents.assemblyai.com/v1/token   (Authorization: Bearer <key>)
 *  - Realtime STT     → GET https://streaming.assemblyai.com/v3/token (Authorization: <key>, no "Bearer")
 *
 * Both take `expires_in_seconds` (redemption window) and `max_session_duration_seconds`
 * (cap on the resulting session) and return `{ token }`.
 *
 * The agent token response also carries `agentId` (env AGENT_ID, from `node scripts/create-agent.mjs`) so the
 * browser never hard-codes it and a redeploy with a new agent needs no code change.
 */

export type TokenKind = 'agent' | 'stt';

const ENDPOINTS: Record<TokenKind, string> = {
  agent: 'https://agents.assemblyai.com/v1/token',
  stt: 'https://streaming.assemblyai.com/v3/token',
};

/** Redemption window: the client must open its WebSocket within this many seconds. */
const EXPIRES_IN_SECONDS = 120;
/** Session cap: a Voice Check is short; 10 minutes bounds cost if a tab is left open. */
const MAX_SESSION_SECONDS = 600;

function authHeader(kind: TokenKind, apiKey: string): string {
  return kind === 'agent' ? `Bearer ${apiKey}` : apiKey;
}

/** Calls AssemblyAI and returns the raw token string. Throws on any non-2xx or malformed reply. */
export async function mintToken(
  kind: TokenKind,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = new URL(ENDPOINTS[kind]);
  url.searchParams.set('expires_in_seconds', String(EXPIRES_IN_SECONDS));
  url.searchParams.set('max_session_duration_seconds', String(MAX_SESSION_SECONDS));

  const res = await fetchImpl(url, { headers: { Authorization: authHeader(kind, apiKey) } });
  if (!res.ok) throw new Error(`AssemblyAI ${kind} token request failed: HTTP ${res.status}`);

  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new Error(`AssemblyAI ${kind} token response had no token`);
  }
  return body.token;
}

/**
 * Web-standard handler body shared by the Vercel functions and the Vite dev middleware.
 * Never leaks upstream error detail to the client; logs it server-side instead.
 */
export async function tokenResponse(
  kind: TokenKind,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const apiKey = env.ASSEMBLYAI_API_KEY;
  if (!apiKey) return Response.json({ error: 'ASSEMBLYAI_API_KEY is not configured' }, { status: 500 });

  const agentId = env.AGENT_ID;
  if (kind === 'agent' && !agentId) return Response.json({ error: 'AGENT_ID is not configured' }, { status: 500 });

  try {
    const token = await mintToken(kind, apiKey, fetchImpl);
    return Response.json(kind === 'agent' ? { token, agentId } : { token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Could not mint token' }, { status: 502 });
  }
}
