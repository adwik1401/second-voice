/** Fetches a single-use Voice Agent token (and the stored agent's id) from our own server. */
export async function fetchAgentToken(fetchImpl: typeof fetch = fetch): Promise<{ token: string; agentId: string }> {
  const res = await fetchImpl('/api/token/agent');
  if (!res.ok) throw new Error(`token request failed (HTTP ${res.status})`);
  const data = (await res.json()) as { token?: unknown; agentId?: unknown };
  if (typeof data.token !== 'string' || typeof data.agentId !== 'string') throw new Error('token response incomplete');
  return { token: data.token, agentId: data.agentId };
}
