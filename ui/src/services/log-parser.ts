/**
 * Log Parser Service
 *
 * Parses Ralph activity logs and individual run logs.
 * Returns structured LogEntry objects with timestamp, level, message.
 */

import fs from "node:fs";
import path from "node:path";
import type { LogEntry, LogLevel } from "../types.js";
import { getRalphRoot } from "./state-reader.js";

/**
 * Parse a timestamp string from activity log format.
 * Format: [YYYY-MM-DD HH:MM:SS]
 */
function parseTimestamp(timestampStr: string): Date | null {
  // Match [YYYY-MM-DD HH:MM:SS]
  const match = timestampStr.match(/\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\]/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10)
  );
}

/**
 * Determine log level from message content.
 * Defaults to 'info' if no level indicator found.
 */
function detectLogLevel(message: string): LogLevel {
  const lowerMessage = message.toLowerCase();

  // Check for error indicators
  if (
    lowerMessage.includes("error") ||
    lowerMessage.includes("fail") ||
    lowerMessage.includes("exception") ||
    lowerMessage.startsWith("error:")
  ) {
    return "error";
  }

  // Check for warning indicators
  if (
    lowerMessage.includes("warn") ||
    lowerMessage.includes("warning") ||
    lowerMessage.startsWith("warn:")
  ) {
    return "warning";
  }

  // Check for debug indicators
  if (lowerMessage.includes("debug") || lowerMessage.startsWith("debug:")) {
    return "debug";
  }

  return "info";
}

/**
 * Parse a single line from an activity log.
 * Returns null for unparseable or empty lines.
 */
function parseActivityLogLine(line: string): LogEntry | null {
  const trimmed = line.trim();

  // Skip empty lines, comments, and section headers
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) {
    return null;
  }

  // Match event log format: [YYYY-MM-DD HH:MM:SS] message
  const eventMatch = trimmed.match(/^(\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\])\s*(.+)$/);
  if (eventMatch) {
    const timestamp = parseTimestamp(eventMatch[1]);
    const message = eventMatch[2].trim();

    if (timestamp) {
      return {
        timestamp,
        level: detectLogLevel(message),
        message,
        source: "activity",
      };
    }
  }

  return null;
}

/**
 * Parse a run summary line from activity log.
 * Formats:
 * - Build mode: - YYYY-MM-DD HH:MM:SS | run=... | iter=... | mode=build | story=... | duration=... | status=...
 * - Plan mode:  - YYYY-MM-DD HH:MM:SS | run=... | iter=... | mode=plan | duration=... | status=...
 */
function parseRunSummaryLine(line: string): LogEntry | null {
  const trimmed = line.trim();

  // Match run summary format with optional story field
  // Pattern: - DATETIME | run=X | iter=N | mode=M | [story=S |] duration=Ds | status=ST
  const match = trimmed.match(
    /^-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*\|\s*run=(\S+)\s*\|\s*iter=(\d+)\s*\|\s*mode=(\w+)\s*(?:\|\s*story=(\S+)\s*)?\|\s*duration=(\d+)s\s*\|\s*status=(\w+)/
  );

  if (match) {
    const [, dateTimeStr, runId, iteration, mode, story, duration, status] = match;

    // Parse datetime
    const dateTimeParts = dateTimeStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (dateTimeParts) {
      const [, year, month, day, hour, minute, second] = dateTimeParts;
      const timestamp = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hour, 10),
        parseInt(minute, 10),
        parseInt(second, 10)
      );

      // Build message based on whether story is present
      const message = story
        ? `Run ${runId} iteration ${iteration} (${mode}) for ${story}: ${status} (${duration}s)`
        : `Run ${runId} iteration ${iteration} (${mode}): ${status} (${duration}s)`;

      const level: LogLevel =
        status === "success" ? "info" : status === "fail" || status === "error" ? "error" : "warning";

      return {
        timestamp,
        level,
        message,
        source: "run-summary",
        runId,
      };
    }
  }

  return null;
}

/**
 * Parse an activity log file.
 * Returns array of LogEntry objects sorted by timestamp descending (newest first).
 *
 * @param streamId - Optional stream ID (e.g., "3" for PRD-3). If not provided, looks for global activity.log
 * @returns Array of parsed log entries
 */
export function parseActivityLog(streamId?: string): LogEntry[] {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return [];
  }

  // Determine log file path
  let logPath: string;
  if (streamId) {
    // Stream-specific activity log
    logPath = path.join(ralphRoot, `PRD-${streamId}`, "activity.log");
  } else {
    // Global activity log
    logPath = path.join(ralphRoot, "activity.log");
  }

  if (!fs.existsSync(logPath)) {
    // Try stream-specific path if global not found and no streamId given
    if (!streamId) {
      return [];
    }
    return [];
  }

  const entries: LogEntry[] = [];

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      // Try parsing as run summary first
      const runSummary = parseRunSummaryLine(line);
      if (runSummary) {
        entries.push(runSummary);
        continue;
      }

      // Try parsing as event line
      const eventEntry = parseActivityLogLine(line);
      if (eventEntry) {
        entries.push(eventEntry);
      }
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (error) {
    // Handle read errors gracefully by returning empty array
    console.error(`Error reading activity log at ${logPath}:`, error);
  }

  return entries;
}

/**
 * Parse a run log file.
 * Returns structured data including content, verification results, and metadata.
 *
 * @param runId - Full run ID (e.g., "20260113-213257-56849")
 * @param streamId - Stream ID (e.g., "3" for PRD-3)
 * @param iteration - Iteration number
 * @returns Array of log entries, or empty array if not found
 */
export function parseRunLog(runId: string, streamId?: string, iteration?: number): LogEntry[] {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return [];
  }

  // Build the log file path
  // Format: run-YYYYMMDD-HHMMSS-XXXXX-iter-N.log
  let logPath: string | null = null;

  if (streamId && iteration !== undefined) {
    // Try direct path construction in stream-specific directory
    logPath = path.join(ralphRoot, `PRD-${streamId}`, "runs", `run-${runId}-iter-${iteration}.log`);

    // If not found, try centralized runs directory
    if (!fs.existsSync(logPath)) {
      logPath = path.join(ralphRoot, "runs", `run-${runId}-iter-${iteration}.log`);
    }
  } else if (streamId) {
    // Search for the run log in the stream's runs directory
    const streamRunsDir = path.join(ralphRoot, `PRD-${streamId}`, "runs");
    logPath = findRunLog(streamRunsDir, runId);

    // If not found, try centralized runs directory
    if (!logPath) {
      const centralRunsDir = path.join(ralphRoot, "runs");
      logPath = findRunLog(centralRunsDir, runId);
    }
  } else {
    // Search all streams for the run log
    logPath = findRunLogGlobally(ralphRoot, runId);
  }

  if (!logPath || !fs.existsSync(logPath)) {
    return [];
  }

  return parseRunLogFile(logPath, runId);
}

/**
 * Find a run log file by run ID in a specific runs directory.
 */
function findRunLog(runsDir: string, runId: string): string | null {
  if (!fs.existsSync(runsDir)) {
    return null;
  }

  try {
    const entries = fs.readdirSync(runsDir);
    for (const entry of entries) {
      if (entry.endsWith(".log") && entry.includes(runId)) {
        return path.join(runsDir, entry);
      }
    }
  } catch {
    // Ignore read errors
  }

  return null;
}

/**
 * Search all streams for a run log by ID.
 */
function findRunLogGlobally(ralphRoot: string, runId: string): string | null {
  // First check centralized runs directory
  const centralRunsDir = path.join(ralphRoot, "runs");
  const centralLog = findRunLog(centralRunsDir, runId);
  if (centralLog) {
    return centralLog;
  }

  // Then check stream-specific directories
  try {
    const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && /^prd-\d+$/i.test(entry.name)) {
        const runsDir = path.join(ralphRoot, entry.name, "runs");
        const logPath = findRunLog(runsDir, runId);
        if (logPath) {
          return logPath;
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return null;
}

/**
 * Parse a run log file and convert it to log entries.
 */
function parseRunLogFile(logPath: string, runId: string): LogEntry[] {
  const entries: LogEntry[] = [];

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n");

    // Use file modification time as base timestamp since run logs may not have timestamps
    const stats = fs.statSync(logPath);
    const baseTimestamp = stats.mtime;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) {
        continue;
      }

      // Try to detect log level from content
      const level = detectLogLevel(trimmed);

      // Create entry with incremented timestamp to maintain order
      entries.push({
        timestamp: new Date(baseTimestamp.getTime() + i),
        level,
        message: trimmed,
        source: "run-log",
        runId,
      });
    }
  } catch (error) {
    console.error(`Error reading run log at ${logPath}:`, error);
  }

  return entries;
}

/**
 * List all available run logs for a stream.
 *
 * @param streamId - Stream ID (e.g., "3" for PRD-3)
 * @returns Array of run info objects with id, iteration, and log path
 */
export function listRunLogs(
  streamId: string
): Array<{ runId: string; iteration: number; logPath: string; hasSummary: boolean }> {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return [];
  }

  const runs: Array<{ runId: string; iteration: number; logPath: string; hasSummary: boolean }> =
    [];

  // Helper function to scan a runs directory
  const scanRunsDir = (runsDir: string) => {
    if (!fs.existsSync(runsDir)) {
      return;
    }

    try {
      const entries = fs.readdirSync(runsDir);

      for (const entry of entries) {
        // Match run log files: run-YYYYMMDD-HHMMSS-XXXXX-iter-N.log
        const match = entry.match(/^run-(\d{8}-\d{6}-\d+)-iter-(\d+)\.log$/);
        if (match) {
          const runId = match[1];
          const iteration = parseInt(match[2], 10);
          const logPath = path.join(runsDir, entry);
          const summaryPath = logPath.replace(".log", ".md");
          const hasSummary = fs.existsSync(summaryPath);

          // Check if run belongs to this stream by looking for PRD-{streamId} references in log
          try {
            const logContent = fs.readFileSync(logPath, "utf-8");
            const prdMarker = `PRD-${streamId}`;
            if (logContent.includes(prdMarker)) {
              runs.push({ runId, iteration, logPath, hasSummary });
            }
          } catch {
            // If we can't read the log, skip it
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  };

  // Check stream-specific runs directory first
  const streamRunsDir = path.join(ralphRoot, `PRD-${streamId}`, "runs");
  scanRunsDir(streamRunsDir);

  // Also check centralized runs directory
  const centralRunsDir = path.join(ralphRoot, "runs");
  scanRunsDir(centralRunsDir);

  // Remove duplicates (same runId + iteration)
  const uniqueRuns = runs.filter(
    (run, index, self) =>
      index === self.findIndex((r) => r.runId === run.runId && r.iteration === run.iteration)
  );

  // Sort by run ID descending (newest first)
  uniqueRuns.sort((a, b) => b.runId.localeCompare(a.runId));

  return uniqueRuns;
}

/**
 * Get the content and metadata from a run summary file.
 *
 * @param runId - Full run ID
 * @param streamId - Stream ID
 * @param iteration - Iteration number
 * @returns Parsed summary data or null if not found
 */
export function getRunSummary(
  runId: string,
  streamId: string,
  iteration: number
): {
  runId: string;
  iteration: number;
  mode: string;
  story: string;
  startedAt: string;
  endedAt: string;
  duration: number;
  status: string;
  commits: string[];
  changedFiles: string[];
} | null {
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return null;
  }

  const summaryPath = path.join(
    ralphRoot,
    `PRD-${streamId}`,
    "runs",
    `run-${runId}-iter-${iteration}.md`
  );

  if (!fs.existsSync(summaryPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(summaryPath, "utf-8");
    const lines = content.split("\n");

    const result: {
      runId: string;
      iteration: number;
      mode: string;
      story: string;
      startedAt: string;
      endedAt: string;
      duration: number;
      status: string;
      commits: string[];
      changedFiles: string[];
    } = {
      runId,
      iteration,
      mode: "",
      story: "",
      startedAt: "",
      endedAt: "",
      duration: 0,
      status: "",
      commits: [],
      changedFiles: [],
    };

    let section: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Parse header metadata
      if (trimmed.startsWith("- Run ID:")) {
        result.runId = trimmed.replace("- Run ID:", "").trim();
      } else if (trimmed.startsWith("- Iteration:")) {
        result.iteration = parseInt(trimmed.replace("- Iteration:", "").trim(), 10);
      } else if (trimmed.startsWith("- Mode:")) {
        result.mode = trimmed.replace("- Mode:", "").trim();
      } else if (trimmed.startsWith("- Story:")) {
        result.story = trimmed.replace("- Story:", "").trim();
      } else if (trimmed.startsWith("- Started:")) {
        result.startedAt = trimmed.replace("- Started:", "").trim();
      } else if (trimmed.startsWith("- Ended:")) {
        result.endedAt = trimmed.replace("- Ended:", "").trim();
      } else if (trimmed.startsWith("- Duration:")) {
        const durationStr = trimmed.replace("- Duration:", "").trim();
        result.duration = parseInt(durationStr.replace("s", ""), 10);
      } else if (trimmed.startsWith("- Status:")) {
        result.status = trimmed.replace("- Status:", "").trim();
      }

      // Track sections
      if (trimmed === "### Commits") {
        section = "commits";
      } else if (trimmed === "### Changed Files (commits)") {
        section = "changedFiles";
      } else if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
        section = null;
      }

      // Parse section items
      if (section && trimmed.startsWith("- ") && trimmed !== "- (none)") {
        const item = trimmed.replace("- ", "");
        if (section === "commits") {
          result.commits.push(item);
        } else if (section === "changedFiles") {
          result.changedFiles.push(item);
        }
      }
    }

    return result;
  } catch {
    return null;
  }
}
