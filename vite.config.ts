/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Serves `api/**` locally so `npm run dev` needs no Vercel CLI or login.
 * Each file exports web-standard method handlers (`GET`, `POST`, …) — the same
 * shape Vercel runs in production — so there is exactly one implementation.
 */
function devApi(): Plugin {
  return {
    name: 'second-voice-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (!path.startsWith('/api/')) return next();
        try {
          const mod = await server.ssrLoadModule(`${path}.ts`);
          const handler = mod[(req.method ?? 'GET').toUpperCase()];
          if (typeof handler !== 'function') {
            res.statusCode = 405;
            return res.end('Method Not Allowed');
          }
          const out: Response = await handler(new Request(`http://localhost${req.url}`, { method: req.method }));
          res.statusCode = out.status;
          out.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await out.text());
        } catch {
          next(); // unknown route → fall through to Vite's 404
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose .env / .env.local to the dev API handlers (server-side only; no VITE_ prefix needed).
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [react(), devApi()],
    test: { environment: 'node', include: ['api/**/*.test.ts', 'src/**/*.test.ts'] },
  };
});
