/** Tiny response helpers shared by the api/ handlers (web-standard Response, runs on Vercel and the Vite dev middleware). */

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const badRequest = (message: string): Response => json({ error: message }, 400);
export const notFound = (message: string): Response => json({ error: message }, 404);
