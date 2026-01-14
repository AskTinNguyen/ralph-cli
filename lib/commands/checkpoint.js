/**
 * Ralph checkpoint command
 * List and manage build checkpoints
 */
const fs = require("fs");
const path = require("path");
const { success, error, dim, pc, hasFlag } = require("../cli");
const checkpointModule = require("../checkpoint");

/**
 * Check if a path exists
 */
function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  name: "checkpoint",
  description: "List and manage build checkpoints",
  usage: "ralph checkpoint <list|clear> [--prd=N] [--all]",

  subcommands: {
    list: "List build checkpoints",
    clear: "Clear checkpoints",
  },

  help: `
${pc.bold("ralph checkpoint")} ${pc.dim("<command> [options]")}

Manage build checkpoints for resuming interrupted builds.

${pc.bold("Commands:")}
  ${pc.green("list")} ${pc.dim("[--prd=N]")}      List all checkpoints or specific PRD
  ${pc.green("clear")} ${pc.dim("[--prd=N]")}     Clear checkpoint for specific PRD
  ${pc.green("clear --all")}           Clear all checkpoints

${pc.bold("Examples:")}
  ${pc.dim("ralph checkpoint list")}           List all checkpoints
  ${pc.dim("ralph checkpoint list --prd=1")}   List checkpoint for PRD-1
  ${pc.dim("ralph checkpoint clear --prd=1")}  Clear PRD-1 checkpoint
  ${pc.dim("ralph checkpoint clear --all")}    Clear all checkpoints
`,

  /**
   * Run the checkpoint command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd, prdNumber
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd(), prdNumber } = options;
    const ralphDir = path.join(cwd, ".ralph");
    const subCmd = args[1];

    // Helper to get PRD folders sorted by number
    const getPRDFolders = () => {
      if (!exists(ralphDir)) return [];
      const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
        .map((e) => ({
          name: e.name,
          path: path.join(ralphDir, e.name),
          number: parseInt(e.name.replace(/PRD-/i, ""), 10),
        }))
        .sort((a, b) => a.number - b.number);
    };

    // Helper to get a specific PRD folder
    const getPRDFolder = (num) => {
      const upperPath = path.join(ralphDir, `PRD-${num}`);
      const lowerPath = path.join(ralphDir, `prd-${num}`);
      if (exists(upperPath)) return { path: upperPath, name: `PRD-${num}`, number: parseInt(num, 10) };
      if (exists(lowerPath)) return { path: lowerPath, name: `prd-${num}`, number: parseInt(num, 10) };
      return null;
    };

    if (subCmd === "list") {
      if (!exists(ralphDir)) {
        dim("No .ralph directory found. Run `ralph prd` to create one.");
        return 0;
      }

      let checkpoints = [];

      if (prdNumber) {
        // List checkpoint for specific PRD
        const prdFolder = getPRDFolder(prdNumber);
        if (!prdFolder) {
          error(`PRD-${prdNumber} not found.`);
          return 1;
        }
        const result = checkpointModule.loadCheckpoint(prdFolder.path);
        if (result.success && result.checkpoint) {
          checkpoints.push({
            prdFolder: prdFolder.name,
            prdPath: prdFolder.path,
            ...result.checkpoint,
          });
        }
      } else {
        // List all checkpoints
        const result = checkpointModule.listCheckpoints(ralphDir);
        if (result.success) {
          checkpoints = result.checkpoints;
        } else {
          error(result.error);
          return 1;
        }
      }

      if (checkpoints.length === 0) {
        dim("No checkpoints found.");
        return 0;
      }

      // Display checkpoints
      console.log("");
      console.log(pc.bold("Checkpoints"));
      console.log(pc.dim("-".repeat(80)));
      console.log(pc.dim(`${"PRD".padEnd(10)} ${"Iteration".padEnd(12)} ${"Story".padEnd(12)} ${"Git SHA".padEnd(10)} ${"Created"}`));
      console.log(pc.dim("-".repeat(80)));

      for (const cp of checkpoints) {
        const prdName = cp.prdFolder || `PRD-${cp.prd_id}`;
        const iteration = String(cp.iteration || "?").padEnd(12);
        const story = (cp.story_id || "?").padEnd(12);
        const gitSha = (cp.git_sha || "?").slice(0, 8).padEnd(10);
        const created = cp.created_at ? new Date(cp.created_at).toLocaleString() : "?";

        console.log(`${pc.cyan(prdName.padEnd(10))} ${iteration} ${story} ${pc.dim(gitSha)} ${pc.dim(created)}`);
      }
      console.log("");
      success(`Found ${pc.bold(checkpoints.length)} checkpoint(s).`);
      return 0;
    }

    if (subCmd === "clear") {
      const clearAll = hasFlag(args, "all");

      if (clearAll) {
        // Clear all checkpoints
        const prdFolders = getPRDFolders();
        if (prdFolders.length === 0) {
          dim("No PRD folders found.");
          return 0;
        }

        let clearedCount = 0;
        for (const prdFolder of prdFolders) {
          if (checkpointModule.hasCheckpoint(prdFolder.path)) {
            const result = checkpointModule.clearCheckpoint(prdFolder.path);
            if (result.success) {
              clearedCount++;
              dim(`Cleared checkpoint from ${prdFolder.name}`);
            }
          }
        }

        if (clearedCount > 0) {
          success(`Cleared ${pc.bold(clearedCount)} checkpoint(s).`);
        } else {
          dim("No checkpoints to clear.");
        }
        return 0;
      }

      // Clear specific PRD or latest
      let prdFolder;
      if (prdNumber) {
        prdFolder = getPRDFolder(prdNumber);
        if (!prdFolder) {
          error(`PRD-${prdNumber} not found.`);
          return 1;
        }
      } else {
        // Find latest PRD folder
        const prdFolders = getPRDFolders();
        if (prdFolders.length === 0) {
          dim("No PRD folders found.");
          return 0;
        }
        prdFolder = prdFolders[prdFolders.length - 1]; // Latest
      }

      if (!checkpointModule.hasCheckpoint(prdFolder.path)) {
        dim(`No checkpoint found in ${prdFolder.name}.`);
        return 0;
      }

      const result = checkpointModule.clearCheckpoint(prdFolder.path);
      if (result.success) {
        success(`Cleared checkpoint from ${pc.cyan(prdFolder.name)}.`);
      } else {
        error(result.error);
        return 1;
      }
      return 0;
    }

    // Unknown subcommand
    error(`Unknown checkpoint command: ${pc.bold(subCmd || "(none)")}`);
    console.log("");
    console.log("Available checkpoint commands:");
    dim("  checkpoint list [--prd=N]   - List checkpoints");
    dim("  checkpoint clear [--prd=N]  - Clear checkpoint for current/specific PRD");
    dim("  checkpoint clear --all      - Clear all checkpoints");
    return 1;
  },
};
