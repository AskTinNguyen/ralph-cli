import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();

// Logging middleware
app.use('*', logger());

// Serve static files from public directory
app.use(
  '/*',
  serveStatic({
    root: path.join(__dirname, '../public'),
    rewriteRequestPath: (p) => p,
  })
);

// Default port
const PORT = parseInt(process.env.PORT || '3000', 10);

console.log(`Starting Ralph UI server on port ${PORT}...`);

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`Ralph UI server running at http://localhost:${info.port}`);
  }
);

export { app };
