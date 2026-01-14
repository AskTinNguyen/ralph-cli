/**
 * Mock HTTP server for webhook testing
 *
 * Captures POST requests (Slack/Discord webhooks) and returns 200 OK.
 * Can be started on a random port for test isolation.
 *
 * Usage:
 *   import { startMockWebhookServer } from './tests/mocks/http-server.js';
 *   const { server, port, requests } = await startMockWebhookServer();
 *   // ... run tests ...
 *   await server.close();
 */

import http from 'node:http';
import { once } from 'node:events';

/**
 * Start a mock webhook server
 * @param {number} [port=0] - Port to listen on (0 = random)
 * @returns {Promise<{server: http.Server, port: number, requests: Array, url: string}>}
 */
export async function startMockWebhookServer(port = 0) {
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      // Parse JSON if possible
      let parsedBody = body;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        // Keep as string if not JSON
      }

      // Store request data
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody,
        timestamp: new Date().toISOString()
      });

      // Simulate different responses based on path
      if (req.url === '/slack/webhook') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.url === '/discord/webhook') {
        res.writeHead(204); // Discord returns 204 No Content
        res.end();
      } else if (req.url === '/error') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      }
    });
  });

  server.listen(port);
  await once(server, 'listening');

  const address = server.address();
  const actualPort = address.port;
  const url = `http://localhost:${actualPort}`;

  // Add helper methods
  server.requests = requests;
  server.reset = () => requests.length = 0;
  server.getLastRequest = () => requests[requests.length - 1];
  server.getRequests = () => [...requests];
  server.close = () => new Promise((resolve) => server.close(resolve));

  return {
    server,
    port: actualPort,
    url,
    requests
  };
}

/**
 * CLI mode for manual testing
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, port, url, requests } = await startMockWebhookServer(3001);
  console.log(`Mock webhook server running at ${url}`);
  console.log('Endpoints:');
  console.log('  POST /slack/webhook - Returns 200 with {"ok": true}');
  console.log('  POST /discord/webhook - Returns 204 No Content');
  console.log('  POST /error - Returns 500 error');
  console.log('  POST /* - Returns 200 with {"received": true}');
  console.log('\nPress Ctrl+C to stop');

  // Log incoming requests
  setInterval(() => {
    if (requests.length > 0) {
      const req = requests[requests.length - 1];
      console.log(`[${req.timestamp}] ${req.method} ${req.url}`);
    }
  }, 1000);

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.close();
    process.exit(0);
  });
}
