/**
 * Mock GitHub API for testing
 *
 * Intercepts GitHub API calls (PR creation, issue comments, status checks)
 * and returns realistic responses without hitting the real API.
 *
 * Usage:
 *   import { mockGitHubAPI, resetGitHubMocks, getGitHubCalls } from './tests/mocks/github-api.js';
 *   mockGitHubAPI();
 *   // ... run tests that call GitHub API ...
 *   const calls = getGitHubCalls();
 *   resetGitHubMocks();
 */

import { once } from 'node:events';
import http from 'node:http';

// Track all API calls
const apiCalls = [];
let mockServer = null;

/**
 * Start mock GitHub API server
 * @param {number} [port=8888] - Port to listen on
 * @returns {Promise<{server: http.Server, port: number, url: string}>}
 */
export async function startMockGitHubAPI(port = 8888) {
  const server = http.createServer((req, res) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      let parsedBody = null;
      try {
        parsedBody = body ? JSON.parse(body) : null;
      } catch {
        // Invalid JSON
      }

      // Record the call
      const call = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody,
        timestamp: new Date().toISOString()
      };
      apiCalls.push(call);

      // Route based on URL pattern
      const response = routeGitHubAPI(req.method, req.url, parsedBody);

      res.writeHead(response.status, {
        'Content-Type': 'application/json',
        'X-GitHub-Request-Id': 'mock-' + Date.now()
      });
      res.end(JSON.stringify(response.body));
    });
  });

  server.listen(port);
  await once(server, 'listening');

  const actualPort = server.address().port;
  const url = `http://localhost:${actualPort}`;

  mockServer = server;

  return {
    server,
    port: actualPort,
    url
  };
}

/**
 * Route GitHub API requests to appropriate mock responses
 */
function routeGitHubAPI(method, url, body) {
  // POST /repos/:owner/:repo/pulls - Create PR
  if (method === 'POST' && url.match(/\/repos\/[^/]+\/[^/]+\/pulls$/)) {
    return {
      status: 201,
      body: {
        id: 123456789,
        number: 42,
        state: 'open',
        title: body?.title || 'Test PR',
        body: body?.body || '',
        head: { ref: body?.head || 'feature-branch' },
        base: { ref: body?.base || 'main' },
        user: { login: 'test-user' },
        html_url: 'https://github.com/test/repo/pull/42',
        created_at: new Date().toISOString()
      }
    };
  }

  // POST /repos/:owner/:repo/issues/:number/comments - Add issue comment
  if (method === 'POST' && url.match(/\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/)) {
    return {
      status: 201,
      body: {
        id: 987654321,
        body: body?.body || '',
        user: { login: 'test-user' },
        created_at: new Date().toISOString(),
        html_url: 'https://github.com/test/repo/issues/1#issuecomment-987654321'
      }
    };
  }

  // POST /repos/:owner/:repo/statuses/:sha - Create status check
  if (method === 'POST' && url.match(/\/repos\/[^/]+\/[^/]+\/statuses\/[a-f0-9]+$/)) {
    return {
      status: 201,
      body: {
        id: 111222333,
        state: body?.state || 'success',
        description: body?.description || '',
        context: body?.context || 'test',
        target_url: body?.target_url || null,
        created_at: new Date().toISOString()
      }
    };
  }

  // GET /repos/:owner/:repo/pulls/:number - Get PR
  if (method === 'GET' && url.match(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/)) {
    return {
      status: 200,
      body: {
        id: 123456789,
        number: 42,
        state: 'open',
        title: 'Test PR',
        body: 'Test PR body',
        head: { ref: 'feature-branch', sha: 'abc123' },
        base: { ref: 'main', sha: 'def456' },
        user: { login: 'test-user' },
        mergeable: true,
        merged: false
      }
    };
  }

  // GET /repos/:owner/:repo/issues/:number - Get issue
  if (method === 'GET' && url.match(/\/repos\/[^/]+\/[^/]+\/issues\/\d+$/)) {
    return {
      status: 200,
      body: {
        id: 789456123,
        number: 15,
        state: 'open',
        title: 'Test Issue',
        body: 'Test issue body',
        user: { login: 'test-user' },
        labels: []
      }
    };
  }

  // Default 404
  return {
    status: 404,
    body: {
      message: 'Not Found',
      documentation_url: 'https://docs.github.com/rest'
    }
  };
}

/**
 * Get all recorded API calls
 */
export function getGitHubCalls() {
  return [...apiCalls];
}

/**
 * Get the last API call
 */
export function getLastGitHubCall() {
  return apiCalls[apiCalls.length - 1];
}

/**
 * Reset recorded calls
 */
export function resetGitHubMocks() {
  apiCalls.length = 0;
}

/**
 * Stop mock server
 */
export async function stopMockGitHubAPI() {
  if (mockServer) {
    await new Promise((resolve) => mockServer.close(resolve));
    mockServer = null;
  }
}

/**
 * Mock GitHub API by setting environment variables
 * This makes tools like `gh` CLI or GitHub API clients use the mock
 */
export async function mockGitHubAPI(port = 8888) {
  const { url } = await startMockGitHubAPI(port);

  // Store original values
  const original = {
    GITHUB_API_URL: process.env.GITHUB_API_URL,
    GH_HOST: process.env.GH_HOST
  };

  // Override with mock URL
  process.env.GITHUB_API_URL = url;
  process.env.GH_HOST = `localhost:${port}`;

  return {
    restore: () => {
      if (original.GITHUB_API_URL) {
        process.env.GITHUB_API_URL = original.GITHUB_API_URL;
      } else {
        delete process.env.GITHUB_API_URL;
      }
      if (original.GH_HOST) {
        process.env.GH_HOST = original.GH_HOST;
      } else {
        delete process.env.GH_HOST;
      }
      stopMockGitHubAPI();
    }
  };
}

/**
 * CLI mode for manual testing
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, port, url } = await startMockGitHubAPI(8888);
  console.log(`Mock GitHub API server running at ${url}`);
  console.log('Endpoints:');
  console.log('  POST /repos/:owner/:repo/pulls - Create PR');
  console.log('  POST /repos/:owner/:repo/issues/:number/comments - Add comment');
  console.log('  POST /repos/:owner/:repo/statuses/:sha - Create status');
  console.log('  GET /repos/:owner/:repo/pulls/:number - Get PR');
  console.log('  GET /repos/:owner/:repo/issues/:number - Get issue');
  console.log('\nPress Ctrl+C to stop');

  // Log incoming requests
  setInterval(() => {
    if (apiCalls.length > 0) {
      const call = apiCalls[apiCalls.length - 1];
      console.log(`[${call.timestamp}] ${call.method} ${call.url}`);
    }
  }, 1000);

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await stopMockGitHubAPI();
    process.exit(0);
  });
}
