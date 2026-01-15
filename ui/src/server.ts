import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./routes/api.js";
import { sse } from "./routes/sse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure RALPH_ROOT to use parent directory's .ralph unless explicitly set
// This prevents ui/.ralph (test directory) from being used in production
// Use RALPH_ROOT=./ui/.ralph for testing with isolated test data
if (!process.env.RALPH_ROOT) {
  const parentRalphPath = path.join(__dirname, "../../.ralph");
  process.env.RALPH_ROOT = parentRalphPath;
}

const app = new Hono();

// Logging middleware
app.use("*", logger());

// Mount API routes
app.route("/api", api);

// Mount SSE routes
app.route("/api", sse);

// Serve static files from public directory
app.use(
  "/*",
  serveStatic({
    root: path.join(__dirname, "../public"),
    rewriteRequestPath: (p) => p,
  })
);

// Default port
const PORT = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting Ralph UI server on port ${PORT}...`);
console.log(`RALPH_ROOT: ${process.env.RALPH_ROOT}`);

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
