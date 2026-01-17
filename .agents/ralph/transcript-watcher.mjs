#!/usr/bin/env node
/**
 * Transcript watcher - monitors for Claude's first text response
 * Speaks the acknowledgment, then starts progress timer
 *
 * Usage: node transcript-watcher.mjs <transcript_path>
 *
 * How it works:
 * 1. Records the current transcript line count when started
 * 2. Polls the transcript file every 200ms for new assistant content
 * 3. When new text content appears, extracts and speaks the first text block
 * 4. Starts progress timer for long-running tasks
 * 5. Exits after speaking the acknowledgment
 */

import { readFileSync, statSync, existsSync } from "fs";
import { execSync, spawn } from "child_process";
import { dirname } from "path";

const POLL_INTERVAL = 200; // ms
const MAX_WAIT = 30000; // 30 seconds max wait time
const MAX_SPEAK_LENGTH = 150; // Max chars before summarization

const transcriptPath = process.argv[2];
const RALPH_ROOT = process.env.RALPH_ROOT || process.cwd();

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  console.log(`[${ts}] [watcher] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countLines(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.trim().split("\n").length;
  } catch (e) {
    return 0;
  }
}

/**
 * Extract text content from assistant message content
 * Filters out tool_use blocks - only returns actual text
 */
function extractText(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();
  }

  return "";
}

/**
 * Clean text for TTS - remove markdown, code blocks, etc.
 */
function cleanForTTS(text) {
  let result = text;

  // Remove code blocks
  result = result.replace(/```[\s\S]*?```/g, "");
  result = result.replace(/`([^`]+)`/g, "$1");

  // Remove markdown formatting
  result = result.replace(/^#{1,6}\s+/gm, "");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/__([^_]+)__/g, "$1");
  result = result.replace(/_([^_]+)_/g, "$1");

  // Remove bullet points
  result = result.replace(/^[\s]*[-*+]\s+/gm, "");
  result = result.replace(/^[\s]*\d+\.\s+/gm, "");

  // Remove URLs
  result = result.replace(/https?:\/\/[^\s]+/g, "");

  // Remove file paths (common in Claude responses)
  result = result.replace(/[\/\w]+\.\w+:\d+/g, "");

  // Normalize whitespace
  result = result.replace(/\s+/g, " ");

  return result.trim();
}

/**
 * Summarize long text using Qwen
 */
async function summarizeForTTS(text) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
  const timeout = 8000;

  const prompt = `You are a TTS summarizer. Convert this AI acknowledgment into a brief spoken phrase (1 short sentence):

"${text.substring(0, 500)}"

Rules:
- Maximum 15 words
- Natural conversational tone
- Focus on what the AI is about to do
- Remove any technical details
- Just the action, not details

Brief phrase:`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          num_predict: 50,
          temperature: 0.3,
          top_p: 0.9,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data = await res.json();
    let summary = (data.response || "").trim();

    // Remove wrapping quotes
    if (
      (summary.startsWith('"') && summary.endsWith('"')) ||
      (summary.startsWith("'") && summary.endsWith("'"))
    ) {
      summary = summary.slice(1, -1);
    }

    return summary || text.substring(0, MAX_SPEAK_LENGTH);
  } catch (error) {
    log(`LLM summarization failed: ${error.message}, using truncation`);
    // Fallback: truncate at sentence boundary
    if (text.length > MAX_SPEAK_LENGTH) {
      const truncated = text.substring(0, MAX_SPEAK_LENGTH);
      const lastPeriod = truncated.lastIndexOf(". ");
      if (lastPeriod > 50) {
        return truncated.substring(0, lastPeriod + 1);
      }
      const lastSpace = truncated.lastIndexOf(" ");
      return truncated.substring(0, lastSpace) + "...";
    }
    return text;
  }
}

/**
 * Escape text for shell command
 */
function escapeShell(text) {
  return text.replace(/'/g, "'\\''");
}

/**
 * Speak text using TTS manager (exclusive playback)
 */
function speak(text) {
  try {
    const escaped = escapeShell(text);
    // Source TTS manager and call speak_exclusive
    const cmd = `source "${RALPH_ROOT}/.agents/ralph/lib/tts-manager.sh" && speak_exclusive '${escaped}'`;
    execSync(cmd, {
      stdio: "ignore",
      cwd: RALPH_ROOT,
      shell: "/bin/bash",
    });
    return true;
  } catch (error) {
    log(`Speak failed: ${error.message}`);
    return false;
  }
}

/**
 * Start the progress timer
 */
function startProgressTimer() {
  const timerScript = `${RALPH_ROOT}/.agents/ralph/progress-timer.sh`;

  if (!existsSync(timerScript)) {
    log(`Progress timer script not found: ${timerScript}`);
    return;
  }

  try {
    const child = spawn(timerScript, ["start"], {
      detached: true,
      stdio: "ignore",
      cwd: RALPH_ROOT,
    });
    child.unref();
    log("Progress timer started");
  } catch (error) {
    log(`Failed to start progress timer: ${error.message}`);
  }
}

async function main() {
  if (!transcriptPath) {
    console.error("Usage: node transcript-watcher.mjs <transcript_path>");
    process.exit(1);
  }

  log(`Watching transcript: ${transcriptPath}`);

  // Record initial line count
  const initialLines = countLines(transcriptPath);
  log(`Initial line count: ${initialLines}`);

  const startTime = Date.now();
  let spoken = false;
  let lastSize = 0;

  // Poll for new assistant content
  while (!spoken && Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL);

    // Check if file has grown
    try {
      const stats = statSync(transcriptPath);
      if (stats.size === lastSize) {
        continue;
      }
      lastSize = stats.size;
    } catch (e) {
      continue;
    }

    // Read new lines
    let content;
    try {
      content = readFileSync(transcriptPath, "utf-8");
    } catch (e) {
      continue;
    }

    const allLines = content.trim().split("\n");
    const newLines = allLines.slice(initialLines);

    if (newLines.length === 0) {
      continue;
    }

    // Process new lines looking for assistant text content
    for (const line of newLines) {
      try {
        const entry = JSON.parse(line);

        // Only look at assistant messages
        if (entry.type !== "assistant" || !entry.message?.content) {
          continue;
        }

        // Extract text content (skip tool_use blocks)
        const text = extractText(entry.message.content);

        if (text && text.length > 0) {
          log(`Found assistant text (${text.length} chars)`);

          // Clean the text
          let toSpeak = cleanForTTS(text);

          if (!toSpeak || toSpeak.length === 0) {
            log("Text empty after cleaning, skipping");
            continue;
          }

          // Summarize if too long
          if (toSpeak.length > MAX_SPEAK_LENGTH) {
            log(`Text too long (${toSpeak.length}), summarizing...`);
            toSpeak = await summarizeForTTS(toSpeak);
          }

          log(`Speaking: "${toSpeak.substring(0, 50)}..."`);

          // Speak the acknowledgment
          if (speak(toSpeak)) {
            spoken = true;

            // Start progress timer for potentially long tasks
            startProgressTimer();
          }

          break;
        }
      } catch (e) {
        // Skip malformed JSON lines
      }
    }
  }

  if (!spoken) {
    log(`No assistant text found within ${MAX_WAIT / 1000}s, exiting`);
  }

  log("Watcher complete");
  process.exit(0);
}

// Handle termination signals
process.on("SIGTERM", () => {
  log("Received SIGTERM, exiting");
  process.exit(0);
});

process.on("SIGINT", () => {
  log("Received SIGINT, exiting");
  process.exit(0);
});

main().catch((error) => {
  log(`Error: ${error.message}`);
  process.exit(1);
});
