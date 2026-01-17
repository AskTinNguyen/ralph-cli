/**
 * Mock STT (Speech-to-Text) Server
 *
 * A configurable mock server that simulates the Whisper STT API.
 * Used for E2E testing of the voice pipeline without requiring
 * an actual Whisper server.
 *
 * Usage:
 *   import { createMockSTTServer } from './tests/helpers/mock-stt-server.mjs';
 *   const { server, port, url, configure } = await createMockSTTServer();
 *   configure({ defaultTranscription: 'hello world' });
 *   // ... run tests ...
 *   await server.close();
 */

import http from 'node:http';
import { once } from 'node:events';

/**
 * Default mock STT configuration
 */
const DEFAULT_CONFIG = {
  // Default transcription text to return
  defaultTranscription: 'test transcription',

  // Language to report
  language: 'en',

  // Whether the server should report as healthy
  healthy: true,

  // Whether model is loaded
  modelLoaded: true,

  // Model name
  model: 'whisper-base',

  // Simulated processing duration in ms
  processingDelayMs: 0,

  // Force error responses
  forceError: false,
  errorMessage: 'Simulated error',
  errorStatusCode: 500,

  // Mapping of audio patterns to transcriptions (for more realistic tests)
  transcriptionMap: new Map(),

  // Track requests for assertions
  requests: [],
};

/**
 * Create a mock STT server
 * @param {number} [port=0] - Port to listen on (0 = random)
 * @returns {Promise<{server: http.Server, port: number, url: string, configure: Function, reset: Function, getRequests: Function}>}
 */
export async function createMockSTTServer(port = 0) {
  const config = { ...DEFAULT_CONFIG, transcriptionMap: new Map(), requests: [] };

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

    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
      if (!config.healthy) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unhealthy' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        model: config.model,
        model_loaded: config.modelLoaded,
      }));
      return;
    }

    // Models endpoint
    if (req.url === '/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        available: ['tiny', 'base', 'small', 'medium', 'large'],
        current: config.model,
        recommendations: {
          fast: 'tiny',
          balanced: 'base',
          accurate: 'small',
        },
      }));
      return;
    }

    // Transcribe endpoint
    if (req.url?.startsWith('/transcribe') && req.method === 'POST') {
      // Parse query params
      const urlObj = new URL(req.url, `http://localhost:${port}`);
      const language = urlObj.searchParams.get('language') || config.language;

      // Collect body
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);

      // Store request for assertions
      config.requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodySize: body.length,
        language,
        timestamp: new Date().toISOString(),
      });

      // Check for forced error
      if (config.forceError) {
        res.writeHead(config.errorStatusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: config.errorMessage,
        }));
        return;
      }

      // Simulate processing delay
      if (config.processingDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, config.processingDelayMs));
      }

      // Determine transcription
      let transcription = config.defaultTranscription;

      // Check for specific mappings based on body content hash
      if (config.transcriptionMap.size > 0) {
        const bodyHash = simpleHash(body);
        if (config.transcriptionMap.has(bodyHash)) {
          transcription = config.transcriptionMap.get(bodyHash);
        }
      }

      // Return successful transcription
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        text: transcription,
        language,
        duration_ms: 100 + Math.random() * 200,
        segments: [
          { start: 0, end: 1.5, text: transcription },
        ],
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
     * Set a specific transcription for a given audio input
     * @param {Buffer|string} audioKey - Audio data or identifier
     * @param {string} transcription - Text to return
     */
    setTranscription(audioKey, transcription) {
      const key = typeof audioKey === 'string' ? audioKey : simpleHash(audioKey);
      config.transcriptionMap.set(key, transcription);
    },

    /**
     * Reset configuration to defaults
     */
    reset() {
      Object.assign(config, DEFAULT_CONFIG, {
        transcriptionMap: new Map(),
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

/**
 * Simple hash function for identifying audio buffers
 */
function simpleHash(buffer) {
  let hash = 0;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) - hash) + bytes[i];
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

// CLI mode for manual testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, port, url } = await createMockSTTServer(5002);
  console.log(`Mock STT server running at ${url}`);
  console.log('Endpoints:');
  console.log('  GET  /health     - Health check');
  console.log('  GET  /models     - List models');
  console.log('  POST /transcribe - Transcribe audio');
  console.log('\nPress Ctrl+C to stop');

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.close();
    process.exit(0);
  });
}
