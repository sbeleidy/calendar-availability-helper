import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function icalProxyPlugin(): Plugin {
  return {
    name: 'ical-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ical', async (req, res) => {
        try {
          const reqUrl = new URL((req as { url?: string }).url ?? '', 'http://localhost');
          const target = reqUrl.searchParams.get('url');
          if (!target) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
            return;
          }

          let parsed: URL;
          try {
            parsed = new URL(target);
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid URL' }));
            return;
          }

          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Only http/https URLs are allowed' }));
            return;
          }

          const upstream = await fetch(parsed.toString(), {
            headers: {
              Accept: 'text/calendar, text/plain, */*',
              'User-Agent': 'CalendarAvailabilityHelper/1.0',
            },
          });

          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: `Upstream returned ${upstream.status} ${upstream.statusText}`,
              })
            );
            return;
          }

          const text = await upstream.text();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
          res.end(text);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Failed to fetch iCal feed',
            })
          );
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), icalProxyPlugin()],
  build: {
    target: 'esnext',
  },
});
