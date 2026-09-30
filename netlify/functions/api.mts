/**
 * Netlify entry point: ONE function that serves every /api/* route by dispatching to the same web-standard
 * handlers Vercel and the Vite dev server use (api/**). So there is exactly one implementation of the API.
 * Netlify bundles this with esbuild, which resolves the `.js` specifiers used in api/ to the .ts sources.
 */
import { GET as bankProfile } from '../../api/bank/profile.js';
import { GET as bankPayeeCheck } from '../../api/bank/payee-check.js';
import { GET as bankPayeeRisk } from '../../api/bank/payee-risk.js';
import { POST as detect } from '../../api/detect.js';
import { GET as tokenAgent } from '../../api/token/agent.js';
import { GET as tokenStt } from '../../api/token/stt.js';

type Handler = (request: Request) => Response | Promise<Response>;

export const routes: Record<string, Partial<Record<string, Handler>>> = {
  '/api/token/agent': { GET: () => tokenAgent() },
  '/api/token/stt': { GET: () => tokenStt() },
  '/api/bank/profile': { GET: bankProfile },
  '/api/bank/payee-check': { GET: bankPayeeCheck },
  '/api/bank/payee-risk': { GET: bankPayeeRisk },
  '/api/detect': { POST: detect },
};

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

export default async function handler(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const methods = routes[path];
  if (!methods) return json({ error: 'not found' }, 404);
  const run = methods[request.method];
  if (!run) return json({ error: 'method not allowed' }, 405, { Allow: Object.keys(methods).join(', ') });
  return run(request);
}

export const config = { path: '/api/*' };
