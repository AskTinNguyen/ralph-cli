/**
 * Mock Ollama LLM Server
 *
 * A configurable mock server that simulates the Ollama API.
 * Used for E2E testing of the voice pipeline intent classification
 * without requiring an actual Ollama server.
 *
 * Usage:
 *   import { createMockOllamaServer } from './tests/helpers/mock-ollama-server.mjs';
 *   const { server, port, url, configure } = await createMockOllamaServer();
 *   configure({ defaultIntent: { action: 'terminal', command: 'ls' } });
 *   // ... run tests ...
 *   await server.close();
 */

import http from 'node:http';
import { once } from 'node:events';

/**
 * Default mock Ollama configuration
 */
const DEFAULT_CONFIG = {
  // Default model to report
  model: 'qwen2.5:1.5b',

  // Whether the server should report as healthy
  healthy: true,

  // Available models
  models: [
    { name: 'qwen2.5:1.5b', modified_at: '2024-01-01T00:00:00Z', size: 1000000000, digest: 'abc123' },
    { name: 'llama3:8b', modified_at: '2024-01-01T00:00:00Z', size: 5000000000, digest: 'def456' },
  ],

  // Default response for chat requests (can be JSON or plain text)
  defaultResponse: JSON.stringify({
    action: 'terminal',
    command: 'test command',
    confidence: 0.9,
  }),

  // Simulated processing duration in ms
  processingDelayMs: 0,

  // Force error responses
  forceError: false,
  errorMessage: 'Simulated error',
  errorStatusCode: 500,

  // Force timeout (never respond)
  forceTimeout: false,

  // Mapping of prompts to responses for specific test cases
  responseMap: new Map(),

  // Track requests for assertions
  requests: [],
};

/**
 * Create a mock Ollama server
 * @param {number} [port=0] - Port to listen on (0 = random)
 * @returns {Promise<{server: http.Server, port: number, url: string, configure: Function, reset: Function, getRequests: Function}>}
 */
export async function createMockOllamaServer(port = 0) {
  const config = { ...DEFAULT_CONFIG, responseMap: new Map(), requests: [] };

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Tags/health endpoint
    if (req.url === '/api/tags' && req.method === 'GET') {
      if (!config.healthy) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server unhealthy' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        models: config.models,
      }));
      return;
    }

    // Chat completion endpoint
    if (req.url === '/api/chat' && req.method === 'POST') {
      // Collect body
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString();

      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      // Store request for assertions
      config.requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody,
        timestamp: new Date().toISOString(),
      });

      // Check for forced timeout
      if (config.forceTimeout) {
        // Don't respond at all - let client timeout
        return;
      }

      // Check for forced error
      if (config.forceError) {
        res.writeHead(config.errorStatusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: config.errorMessage }));
        return;
      }

      // Simulate processing delay
      if (config.processingDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, config.processingDelayMs));
      }

      // Determine response
      let responseText = config.defaultResponse;

      // Extract user message for mapping lookup
      const userMessage = parsedBody.messages?.find(m => m.role === 'user')?.content || '';

      // Check for specific mappings
      if (config.responseMap.size > 0) {
        for (const [pattern, response] of config.responseMap) {
          if (typeof pattern === 'string' && userMessage.includes(pattern)) {
            responseText = typeof response === 'string' ? response : JSON.stringify(response);
            break;
          } else if (pattern instanceof RegExp && pattern.test(userMessage)) {
            responseText = typeof response === 'string' ? response : JSON.stringify(response);
            break;
          }
        }
      }

      // Return successful response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        model: parsedBody.model || config.model,
        message: {
          role: 'assistant',
          content: responseText,
        },
        prompt_eval_count: 100,
        eval_count: 50,
        done: true,
      }));
      return;
    }

    // Embeddings endpoint
    if (req.url === '/api/embeddings' && req.method === 'POST') {
      // Collect body
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString();

      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      // Return mock embedding (384 dimensions)
      const embedding = Array(384).fill(0).map(() => Math.random() * 2 - 1);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        embedding,
      }));
      return;
    }

    // Pull endpoint (mock)
    if (req.url === '/api/pull' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
      }));
      return;
    }

    // Unknown endpoint
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port);
  await once(server, 'listening');

  const address = server.address();
  const actualPort = address.port;
  const url = `http://localhost:${actualPort}`;

  return {
    server,
    port: actualPort,
    url,

    /**
     * Configure the mock server behavior
     * @param {Partial<typeof DEFAULT_CONFIG>} options
     */
    configure(options) {
      Object.assign(config, options);
    },

    /**
     * Set a specific response for prompts matching a pattern
     * @param {string|RegExp} pattern - Text to match in user message
     * @param {string|object} response - Response to return
     */
    setResponse(pattern, response) {
      config.responseMap.set(pattern, response);
    },

    /**
     * Set the default intent classification response
     * @param {object} intent - The intent object to return
     */
    setDefaultIntent(intent) {
      config.defaultResponse = JSON.stringify(intent);
    },

    /**
     * Reset configuration to defaults
     */
    reset() {
      Object.assign(config, DEFAULT_CONFIG, {
        responseMap: new Map(),
        requests: [],
      });
    },

    /**
     * Get all recorded requests
     */
    getRequests() {
      return [...config.requests];
    },

    /**
     * Get the last request
     */
    getLastRequest() {
      return config.requests[config.requests.length - 1];
    },

    /**
     * Close the server
     */
    async close() {
      return new Promise(resolve => server.close(resolve));
    },
  };
}

// CLI mode for manual testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, port, url } = await createMockOllamaServer(11435);
  console.log(`Mock Ollama server running at ${url}`);
  console.log('Endpoints:');
  console.log('  GET  /api/tags       - List models');
  console.log('  POST /api/chat       - Chat completion');
  console.log('  POST /api/embeddings - Generate embeddings');
  console.log('  POST /api/pull       - Pull model (mock)');
  console.log('\nPress Ctrl+C to stop');

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.close();
    process.exit(0);
  });
}
