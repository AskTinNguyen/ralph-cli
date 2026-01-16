/**
 * Ralph budget command (US-008)
 * Set, view, and manage build budgets for PRDs
 */
const fs = require("fs");
const path = require("path");
const { success, error, info, dim, pc, hasFlag } = require("../cli");

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

/**
 * Get PRD folders sorted by number
 */
function getPRDFolders(ralphDir) {
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
}

/**
 * Get a specific PRD folder
 */
function getPRDFolder(ralphDir, num) {
  const upperPath = path.join(ralphDir, `PRD-${num}`);
  const lowerPath = path.join(ralphDir, `prd-${num}`);
  if (exists(upperPath)) return { path: upperPath, name: `PRD-${num}`, number: parseInt(num, 10) };
  if (exists(lowerPath)) return { path: lowerPath, name: `prd-${num}`, number: parseInt(num, 10) };
  return null;
}

/**
 * Load budget config from PRD folder
 */
function loadBudget(prdPath) {
  const budgetPath = path.join(prdPath, ".budget.json");
  if (!exists(budgetPath)) return null;

  try {
    const content = fs.readFileSync(budgetPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save budget config to PRD folder
 */
function saveBudget(prdPath, budget) {
  const budgetPath = path.join(prdPath, ".budget.json");
  fs.writeFileSync(budgetPath, JSON.stringify(budget, null, 2) + "\n");
}

/**
 * Load cost data from PRD folder
 */
function loadCost(prdPath) {
  const costPath = path.join(prdPath, ".cost.json");
  if (!exists(costPath)) return { total_cost: 0 };

  try {
    const content = fs.readFileSync(costPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return { total_cost: 0 };
  }
}

/**
 * Clear budget from PRD folder
 */
function clearBudget(prdPath) {
  const budgetPath = path.join(prdPath, ".budget.json");
  if (exists(budgetPath)) {
    fs.unlinkSync(budgetPath);
    return true;
  }
  return false;
}

/**
 * Format percentage with color based on threshold
 */
function formatPercentage(percentage) {
  if (percentage >= 100) {
    return pc.red(`${percentage}%`);
  } else if (percentage >= 90) {
    return pc.bold(pc.yellow(`${percentage}%`));
  } else if (percentage >= 75) {
    return pc.yellow(`${percentage}%`);
  }
  return pc.green(`${percentage}%`);
}

module.exports = {
  name: "budget",
  description: "Set and manage build budgets",
  usage: "ralph budget <set|show|clear> [amount] [--prd=N]",

  subcommands: {
    set: "Set budget limit",
    show: "Show current budget",
    clear: "Clear budget",
  },

  help: `
${pc.bold("ralph budget")} ${pc.dim("<command> [options]")}

Set and manage cost budgets for builds.

${pc.bold("Commands:")}
  ${pc.green("set")} ${pc.dim("<amount> [--prd=N]")}     Set budget limit (e.g., 5.00)
  ${pc.green("show")} ${pc.dim("[--prd=N]")}             Show current budget status
  ${pc.green("clear")} ${pc.dim("[--prd=N]")}            Remove budget limit

${pc.bold("Options:")}
  ${pc.yellow("--prd=N")}               Target specific PRD (default: latest)
  ${pc.yellow("--enforce")}             Enable build pause at limit (default: true)
  ${pc.yellow("--no-enforce")}          Warn only, don't pause builds

${pc.bold("Examples:")}
  ${pc.dim("ralph budget set 5.00")}         Set $5.00 budget for latest PRD
  ${pc.dim("ralph budget set 10 --prd=1")}   Set $10.00 budget for PRD-1
  ${pc.dim("ralph budget show")}             Show budget status
  ${pc.dim("ralph budget clear")}            Remove budget limit

${pc.bold("Budget Thresholds:")}
  ${pc.yellow("⚠ 75%")}  Warning displayed in CLI
  ${pc.bold(pc.yellow("⚠ 90%"))}  Warning displayed in CLI (bold)
  ${pc.red("⛔ 100%")} Build pauses (if enforce enabled)
`,

  /**
   * Run the budget command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd, prdNumber
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd(), prdNumber } = options;
    const ralphDir = path.join(cwd, ".ralph");
    const subCmd = args[1];

    // Get target PRD folder
    const getTargetPRD = () => {
      if (prdNumber) {
        return getPRDFolder(ralphDir, prdNumber);
      }
      // Find latest PRD folder
      const prdFolders = getPRDFolders(ralphDir);
      if (prdFolders.length === 0) return null;
      return prdFolders[prdFolders.length - 1];
    };

    // === HELP ===
    if (subCmd === "--help" || subCmd === "-h" || subCmd === "help") {
      console.log(this.help);
      return 0;
    }

    // === SET ===
    if (subCmd === "set") {
      const amount = args[2];

      if (!amount || isNaN(parseFloat(amount))) {
        error("Please provide a budget amount.");
        console.log("");
        dim(`Usage: ${pc.cyan("ralph budget set <amount> [--prd=N]")}`);
        dim(`Example: ${pc.cyan("ralph budget set 5.00")}`);
        return 1;
      }

      const limit = parseFloat(amount);
      if (limit <= 0) {
        error("Budget amount must be greater than 0.");
        return 1;
      }

      const prdFolder = getTargetPRD();
      if (!prdFolder) {
        if (prdNumber) {
          error(`PRD-${prdNumber} not found.`);
        } else {
          error("No PRD folder found. Run `ralph prd` to create one.");
        }
        return 1;
      }

      // Check for --no-enforce flag
      const enforce = !hasFlag(args, "no-enforce");

      const budget = {
        limit,
        warnings: [0.75, 0.90],
        enforce,
        created_at: new Date().toISOString(),
      };

      saveBudget(prdFolder.path, budget);

      console.log("");
      success(`Budget set for ${pc.cyan(prdFolder.name)}`);
      console.log(pc.dim("─".repeat(50)));
      console.log(`  ${pc.bold("Limit:")}   ${pc.green("$" + limit.toFixed(2))}`);
      console.log(`  ${pc.bold("Enforce:")} ${enforce ? pc.yellow("Yes (build pauses at limit)") : pc.dim("No (warnings only)")}`);
      console.log(pc.dim("─".repeat(50)));
      console.log("");
      dim("Budget warnings will appear at 75% and 90% thresholds.");
      if (enforce) {
        dim("Build will pause for confirmation when limit is reached.");
      }
      return 0;
    }

    // === SHOW ===
    if (subCmd === "show" || !subCmd) {
      if (!exists(ralphDir)) {
        dim("No .ralph directory found.");
        return 0;
      }

      let prdFolders;
      if (prdNumber) {
        const prdFolder = getPRDFolder(ralphDir, prdNumber);
        if (!prdFolder) {
          error(`PRD-${prdNumber} not found.`);
          return 1;
        }
        prdFolders = [prdFolder];
      } else {
        prdFolders = getPRDFolders(ralphDir);
      }

      if (prdFolders.length === 0) {
        dim("No PRD folders found.");
        return 0;
      }

      // Collect budget data
      const budgetData = prdFolders
        .map((prd) => ({
          prd,
          budget: loadBudget(prd.path),
          cost: loadCost(prd.path),
        }))
        .filter((d) => d.budget !== null);

      if (budgetData.length === 0) {
        dim("No budgets configured.");
        console.log("");
        info(`Set a budget with: ${pc.cyan("ralph budget set <amount>")}`);
        return 0;
      }

      console.log("");
      console.log(pc.bold("Budget Status"));
      console.log(pc.dim("═".repeat(70)));
      console.log(
        pc.dim(
          `${"PRD".padEnd(12)} ${"Limit".padEnd(10)} ${"Used".padEnd(12)} ${"Remaining".padEnd(12)} ${"Status".padEnd(10)} Enforce`
        )
      );
      console.log(pc.dim("─".repeat(70)));

      for (const { prd, budget, cost } of budgetData) {
        const limit = budget.limit || 0;
        const used = cost.total_cost || 0;
        const remaining = Math.max(0, limit - used);
        const percentage = limit > 0 ? Math.round((used / limit) * 100) : 0;

        // Status indicator
        let statusIcon;
        if (percentage >= 100) {
          statusIcon = pc.red("⛔ OVER");
        } else if (percentage >= 90) {
          statusIcon = pc.bold(pc.yellow("⚠ 90%+"));
        } else if (percentage >= 75) {
          statusIcon = pc.yellow("⚠ 75%+");
        } else {
          statusIcon = pc.green("✓ OK");
        }

        const enforceStr = budget.enforce !== false ? pc.green("Yes") : pc.dim("No");

        console.log(
          `${pc.cyan(prd.name.padEnd(12))} ` +
            `${("$" + limit.toFixed(2)).padEnd(10)} ` +
            `${("$" + used.toFixed(4)).padEnd(12)} ` +
            `${("$" + remaining.toFixed(2)).padEnd(12)} ` +
            `${statusIcon.padEnd(18)} ` +
            enforceStr
        );
      }
      console.log(pc.dim("═".repeat(70)));
      return 0;
    }

    // === CLEAR ===
    if (subCmd === "clear") {
      const prdFolder = getTargetPRD();
      if (!prdFolder) {
        if (prdNumber) {
          error(`PRD-${prdNumber} not found.`);
        } else {
          error("No PRD folder found.");
        }
        return 1;
      }

      if (clearBudget(prdFolder.path)) {
        success(`Budget cleared from ${pc.cyan(prdFolder.name)}.`);
      } else {
        dim(`No budget was set for ${prdFolder.name}.`);
      }
      return 0;
    }

    // Unknown subcommand
    error(`Unknown budget command: ${pc.bold(subCmd || "(none)")}`);
    console.log("");
    console.log("Available budget commands:");
    dim("  budget set <amount>   - Set budget limit");
    dim("  budget show           - Show budget status");
    dim("  budget clear          - Remove budget limit");
    return 1;
  },
};
