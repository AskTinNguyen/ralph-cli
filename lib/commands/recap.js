/**
 * Ralph recap command - Extended TTS summarization of Claude's last response
 * On-demand longer summaries with bulleted, concise style
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { success, error, info, dim, pc, warn } = require("../cli");

/**
 * Find the Claude projects directory
 */
function getClaudeProjectsDir() {
  const homeDir = require("os").homedir();
  return path.join(homeDir, ".claude", "projects");
}

/**
 * Encode a path the way Claude Code does it
 */
function encodeProjectPath(projectPath) {
  // Claude encodes paths by replacing / with -
  return projectPath.replace(/\//g, "-");
}

/**
 * Find the current project's transcript directory
 */
function findProjectTranscriptDir() {
  const projectsDir = getClaudeProjectsDir();

  if (!fs.existsSync(projectsDir)) {
    return null;
  }

  // Get current working directory and encode it
  const cwd = process.cwd();
  const encodedPath = encodeProjectPath(cwd);
  const projectDir = path.join(projectsDir, encodedPath);

  if (fs.existsSync(projectDir)) {
    return projectDir;
  }

  // Try to find a matching directory (partial match)
  const dirs = fs.readdirSync(projectsDir);
  const cwdParts = cwd.split("/").filter(Boolean);

  for (const dir of dirs) {
    // Check if directory name contains key parts of our path
    const match = cwdParts.every(part => dir.includes(part));
    if (match) {
      const fullPath = path.join(projectsDir, dir);
      if (fs.statSync(fullPath).isDirectory()) {
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * Find the most recent transcript file in a directory
 */
function findLatestTranscript(transcriptDir) {
  if (!fs.existsSync(transcriptDir)) {
    return null;
  }

  const files = fs.readdirSync(transcriptDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => ({
      name: f,
      path: path.join(transcriptDir, f),
      mtime: fs.statSync(path.join(transcriptDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

/**
 * Run the recap summarizer
 */
async function runRecapSummarizer(transcriptPath, mode) {
  const scriptPath = path.join(__dirname, "../../.agents/ralph/recap-for-tts.mjs");

  if (!fs.existsSync(scriptPath)) {
    throw new Error("Recap summarizer script not found");
  }

  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, transcriptPath, mode], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Summarizer exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Speak text using TTS manager with "summary" usage type
 * This ensures it uses the configured summary voice with language detection
 */
async function speakText(text) {
  const { execSync } = require("child_process");
  const scriptDir = path.join(__dirname, "../../.agents/ralph");

  try {
    // Use TTS manager directly with "summary" usage type
    // This enables per-usage voice selection + automatic language detection
    const cmd = `source "${scriptDir}/lib/tts-manager.sh" && speak_exclusive "${text.replace(/'/g, "'\\''")}" "summary"`;

    execSync(cmd, {
      stdio: "inherit",
      cwd: scriptDir,
      shell: "/bin/bash",
    });

    return 0;
  } catch (err) {
    error(`TTS error: ${err.message}`);
    return 1;
  }
}

module.exports = {
  name: "recap",
  description: "Speak extended summary of Claude's last response",
  usage: "ralph recap [--short|--medium|--full]",

  help: `
${pc.bold("ralph recap")} ${pc.dim("[options]")}

Speak a longer, bulleted summary of Claude's last response.
Unlike auto-speak (short ~20 words), recap gives you more detail.

${pc.bold("Modes:")}
  ${pc.yellow("--short")}     ~30 words, 1-2 sentences (same as auto-speak)
  ${pc.yellow("--medium")}    ~100 words, bulleted list ${pc.dim("(default)")}
  ${pc.yellow("--full")}      ~200 words, detailed bulleted list

${pc.bold("Options:")}
  ${pc.yellow("--preview")}   Show summary text without speaking
  ${pc.yellow("--help")}      Show this help

${pc.bold("Examples:")}
  ${pc.dim("ralph recap")}              ${pc.dim("# Medium summary (default)")}
  ${pc.dim("ralph recap --full")}       ${pc.dim("# Detailed summary")}
  ${pc.dim("ralph recap --preview")}    ${pc.dim("# See text, don't speak")}

${pc.bold("Style:")}
  Recaps use concise, bulleted format:
  ${pc.dim('"Feature completed. One, added login. Two, added logout."')}
  ${pc.dim('"Three, tests passing. Next steps: add rate limiting."')}
`,

  async run(args) {
    // Parse arguments
    let mode = "medium";
    let preview = false;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--short" || arg === "-s") {
        mode = "short";
      } else if (arg === "--medium" || arg === "-m") {
        mode = "medium";
      } else if (arg === "--full" || arg === "-f") {
        mode = "full";
      } else if (arg === "--preview" || arg === "-p") {
        preview = true;
      } else if (arg === "--help" || arg === "-h") {
        console.log(this.help);
        return 0;
      }
    }

    // Find the transcript
    dim("Finding latest transcript...");

    const transcriptDir = findProjectTranscriptDir();
    if (!transcriptDir) {
      error("Could not find Claude project directory");
      info("Make sure you're in a directory where Claude Code has been used");
      return 1;
    }

    const transcriptPath = findLatestTranscript(transcriptDir);
    if (!transcriptPath) {
      error("No transcript found");
      info("Run some commands with Claude Code first");
      return 1;
    }

    dim(`Transcript: ${path.basename(transcriptPath)}`);
    dim(`Mode: ${mode}`);

    // Run summarizer
    try {
      info("Generating recap...");
      const summary = await runRecapSummarizer(transcriptPath, mode);

      if (!summary) {
        warn("No speakable content in last response");
        return 0;
      }

      if (preview) {
        console.log("");
        console.log(pc.bold("Recap preview:"));
        console.log("");
        console.log(summary);
        console.log("");
        info(`${summary.length} characters, ${summary.split(/\s+/).length} words`);
        return 0;
      }

      // Speak the summary
      return await speakText(summary);
    } catch (err) {
      error(`Recap failed: ${err.message}`);
      return 1;
    }
  },
};
