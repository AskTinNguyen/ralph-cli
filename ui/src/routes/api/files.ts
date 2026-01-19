/**
 * File and Authorship API Routes
 *
 * REST API endpoints for reading/writing files within the .ralph directory
 * and managing authorship metadata for content tracking.
 * Security: All file access is restricted to the .ralph directory only.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { getRalphRoot } from "../../services/state-reader.js";

const filesApi = new Hono();

/**
 * Validate file path security
 *
 * Ensures the requested path:
 * - Does not contain '..' directory traversal
 * - Resolves to a location within the ralph root directory
 *
 * @param relativePath - The relative path to validate
 * @returns The validated absolute path, or null if invalid
 */
function validateFilePath(relativePath: string): string | null {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return null;
  }

  // Reject paths with directory traversal attempts
  if (relativePath.includes("..")) {
    return null;
  }

  // Decode URL-encoded path
  const decodedPath = decodeURIComponent(relativePath);

  // Reject paths that still have traversal after decoding
  if (decodedPath.includes("..")) {
    return null;
  }

  // Resolve the full path
  const resolvedPath = path.resolve(ralphRoot, decodedPath);

  // Ensure the resolved path is within the ralph root directory
  if (
    !resolvedPath.startsWith(ralphRoot + path.sep) &&
    resolvedPath !== ralphRoot
  ) {
    return null;
  }

  return resolvedPath;
}

// Lazy-loaded authorship reader module
let authorshipReader: (typeof import("../../services/authorship-reader.js")) | null =
  null;

async function getAuthorshipReader(): Promise<
  typeof import("../../services/authorship-reader.js")
> {
  if (!authorshipReader) {
    authorshipReader = await import("../../services/authorship-reader.js");
  }
  return authorshipReader;
}

/**
 * GET /files/*
 *
 * Read file content from the .ralph directory.
 * The path parameter should be a relative path within .ralph.
 *
 * Examples:
 *   GET /api/files/PRD-3/prd.md -> Returns content of .ralph/PRD-3/prd.md
 *   GET /api/files/PRD-3/runs/file.log -> Returns content of .ralph/PRD-3/runs/file.log
 *
 * Returns:
 *   - 200 with file content (text/plain) on success
 *   - 400 if path is missing or is a directory
 *   - 403 if path is outside .ralph directory
 *   - 404 if file not found
 *   - 500 on read error
 */
filesApi.get("/files/*", (c) => {
  const requestedPath = c.req.path.replace(/^\/api\/files\//, "");

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  if (!fs.existsSync(validatedPath)) {
    return c.json(
      {
        error: "not_found",
        message: `File not found: ${requestedPath}`,
      },
      404
    );
  }

  const stats = fs.statSync(validatedPath);
  if (stats.isDirectory()) {
    return c.json(
      {
        error: "bad_request",
        message: "Cannot read a directory",
      },
      400
    );
  }

  try {
    const content = fs.readFileSync(validatedPath, "utf-8");
    return c.text(content);
  } catch {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to read file",
      },
      500
    );
  }
});

/**
 * PUT /files/*
 *
 * Update file content in the .ralph directory.
 * The path parameter should be a relative path within .ralph.
 *
 * Request body: Plain text content to write to the file.
 *
 * Examples:
 *   PUT /api/files/PRD-3/prd.md -> Updates .ralph/PRD-3/prd.md
 *
 * Returns:
 *   - 200 on success
 *   - 400 if path is missing
 *   - 403 if path is outside .ralph directory
 *   - 500 on write error
 */
filesApi.put("/files/*", async (c) => {
  const requestedPath = c.req.path.replace(/^\/api\/files\//, "");

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  const content = await c.req.text();

  // Ensure parent directory exists
  const parentDir = path.dirname(validatedPath);
  if (!fs.existsSync(parentDir)) {
    try {
      fs.mkdirSync(parentDir, { recursive: true });
    } catch {
      return c.json(
        {
          error: "internal_error",
          message: "Failed to create parent directory",
        },
        500
      );
    }
  }

  try {
    fs.writeFileSync(validatedPath, content, "utf-8");
    return c.json({
      success: true,
      message: "File updated successfully",
      path: requestedPath,
    });
  } catch {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to write file",
      },
      500
    );
  }
});

/**
 * POST /files/:path/open
 *
 * Open file in user's default text editor or VSCode.
 * The path parameter should be a relative path within .ralph.
 *
 * Returns:
 *   - 200 on success
 *   - 400 if path is missing
 *   - 403 if path is outside .ralph directory
 *   - 404 if file not found
 *   - 500 on error
 */
filesApi.post("/files/*/open", async (c) => {
  const requestedPath = c.req.path
    .replace(/^\/api\/files\//, "")
    .replace(/\/open$/, "");

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  if (!fs.existsSync(validatedPath)) {
    return c.json(
      {
        error: "not_found",
        message: `File not found: ${requestedPath}`,
      },
      404
    );
  }

  try {
    const { exec } = await import("node:child_process");
    const platform = process.platform;

    let command: string;
    if (platform === "darwin") {
      command = `code "${validatedPath}" 2>/dev/null || open -t "${validatedPath}"`;
    } else if (platform === "win32") {
      command = `code "${validatedPath}" 2>nul || notepad "${validatedPath}"`;
    } else {
      command = `code "${validatedPath}" 2>/dev/null || xdg-open "${validatedPath}"`;
    }

    exec(command, (error) => {
      if (error) {
        console.error("Failed to open file:", error);
      }
    });

    return c.json({
      success: true,
      message: "File opened in external editor",
      path: requestedPath,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return c.json(
      {
        error: "internal_error",
        message: `Failed to open file: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * GET /authorship/*
 *
 * Get authorship metadata for a file.
 * The path parameter should be a relative path within .ralph (e.g., PRD-3/prd.md)
 *
 * Returns:
 *   - 200 with authorship metadata (JSON)
 *   - 200 with null metadata if no authorship data exists
 *   - 400 if path is missing
 *   - 403 if path is outside .ralph directory
 *   - 500 on error
 */
filesApi.get("/authorship/*", async (c) => {
  const rawPath = c.req.path.replace(/^\/api\/authorship\//, "");
  const requestedPath = decodeURIComponent(rawPath);

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  try {
    const reader = await getAuthorshipReader();
    const metadata = reader.loadAuthorship(requestedPath);

    return c.json({
      success: true,
      metadata,
      path: requestedPath,
    });
  } catch {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to load authorship metadata",
      },
      500
    );
  }
});

/**
 * PUT /authorship/*
 *
 * Update authorship metadata for a file.
 * The path parameter should be a relative path within .ralph (e.g., PRD-3/prd.md)
 *
 * Request body: JSON with:
 *   - content: The current file content (for reconciliation)
 *   - author: The author type making the change
 *   - metadata: Optional - full metadata object to save directly
 *
 * Returns:
 *   - 200 on success with updated metadata
 *   - 400 if path or body is invalid
 *   - 403 if path is outside .ralph directory
 *   - 500 on error
 */
filesApi.put("/authorship/*", async (c) => {
  const rawPath = c.req.path.replace(/^\/api\/authorship\//, "");
  const requestedPath = decodeURIComponent(rawPath);

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  try {
    const body = await c.req.json();
    const reader = await getAuthorshipReader();

    let metadata;

    if (body.metadata) {
      metadata = body.metadata;
    } else if (body.content !== undefined && body.author) {
      const oldMeta = reader.loadAuthorship(requestedPath);
      metadata = reader.reconcileAuthorship(
        oldMeta,
        body.content,
        body.author,
        requestedPath
      );
    } else {
      return c.json(
        {
          error: "bad_request",
          message:
            "Request must include either 'metadata' or both 'content' and 'author'",
        },
        400
      );
    }

    reader.saveAuthorship(requestedPath, metadata);

    return c.json({
      success: true,
      metadata,
      path: requestedPath,
    });
  } catch {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to save authorship metadata",
      },
      500
    );
  }
});

/**
 * POST /authorship/:path/initialize
 *
 * Initialize authorship metadata for a file that doesn't have any.
 * Marks all existing content with the specified default author.
 *
 * Request body: JSON with:
 *   - defaultAuthor: The author type for existing content (default: 'unknown')
 *
 * Returns:
 *   - 200 on success with new metadata
 *   - 400 if path is missing
 *   - 403 if path is outside .ralph directory
 *   - 404 if file doesn't exist
 *   - 500 on error
 */
filesApi.post("/authorship/*/initialize", async (c) => {
  const rawPath = c.req.path
    .replace(/^\/api\/authorship\//, "")
    .replace(/\/initialize$/, "");
  const requestedPath = decodeURIComponent(rawPath);

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  if (!fs.existsSync(validatedPath)) {
    return c.json(
      {
        error: "not_found",
        message: `File not found: ${requestedPath}`,
      },
      404
    );
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const defaultAuthor = body.defaultAuthor || "unknown";

    const reader = await getAuthorshipReader();
    const content = fs.readFileSync(validatedPath, "utf-8");

    const metadata = reader.initializeAuthorship(
      content,
      requestedPath,
      defaultAuthor
    );
    reader.saveAuthorship(requestedPath, metadata);

    return c.json({
      success: true,
      metadata,
      path: requestedPath,
    });
  } catch {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to initialize authorship metadata",
      },
      500
    );
  }
});

export { filesApi };
