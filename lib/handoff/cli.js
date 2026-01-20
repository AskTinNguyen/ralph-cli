#!/usr/bin/env node
/**
 * Handoff CLI Helper
 *
 * Low-level CLI interface for handoff operations, used by bash scripts.
 * For user-facing commands, use `ralph handoff` instead.
 *
 * Usage:
 *   node cli.js create <prd-folder> <summary> [reason]
 *   node cli.js load <handoff-id>
 *   node cli.js latest
 *   node cli.js context <handoff-id>
 *   node cli.js list [--limit=N]
 */
const path = require("path");
const handoff = require("./index");

const args = process.argv.slice(2);
const command = args[0];

// Get project root (walk up from script location)
function getProjectRoot() {
  // This script is in lib/handoff/cli.js
  // Project root is two levels up
  return path.resolve(__dirname, "../..");
}

async function main() {
  const projectRoot = process.cwd();

  switch (command) {
    case "create": {
      const summary = args[1] || "Handoff";
      const reason = args[2] || "manual";
      const parentId = args[3] || undefined;

      const result = handoff.createNewHandoff(projectRoot, {
        summary,
        reason,
        parent_id: parentId,
      });

      if (result.success) {
        console.log(JSON.stringify(result.handoff));
        process.exit(0);
      } else {
        console.error(result.error);
        process.exit(1);
      }
      break;
    }

    case "load": {
      const handoffId = args[1];
      if (!handoffId) {
        console.error("Handoff ID required");
        process.exit(1);
      }

      const result = handoff.loadHandoff(projectRoot, handoffId);

      if (result.success) {
        console.log(JSON.stringify(result.handoff));
        process.exit(0);
      } else {
        console.error(result.error);
        process.exit(1);
      }
      break;
    }

    case "latest": {
      const result = handoff.loadLatestHandoff(projectRoot);

      if (result.success) {
        console.log(JSON.stringify(result.handoff));
        process.exit(0);
      } else {
        console.error(result.error);
        process.exit(1);
      }
      break;
    }

    case "context": {
      const handoffId = args[1];
      let loadedHandoff;

      if (handoffId) {
        const result = handoff.loadHandoff(projectRoot, handoffId);
        if (!result.success) {
          console.error(result.error);
          process.exit(1);
        }
        loadedHandoff = result.handoff;
      } else {
        const result = handoff.loadLatestHandoff(projectRoot);
        if (!result.success) {
          console.error(result.error);
          process.exit(1);
        }
        loadedHandoff = result.handoff;
      }

      const context = handoff.generateContextInjection(loadedHandoff);
      console.log(context);
      process.exit(0);
      break;
    }

    case "markdown":
    case "export": {
      const handoffId = args[1];
      let loadedHandoff;

      if (handoffId) {
        const result = handoff.loadHandoff(projectRoot, handoffId);
        if (!result.success) {
          console.error(result.error);
          process.exit(1);
        }
        loadedHandoff = result.handoff;
      } else {
        const result = handoff.loadLatestHandoff(projectRoot);
        if (!result.success) {
          console.error(result.error);
          process.exit(1);
        }
        loadedHandoff = result.handoff;
      }

      const markdown = handoff.generateHandoffMarkdown(loadedHandoff);
      console.log(markdown);
      process.exit(0);
      break;
    }

    case "list": {
      const limitArg = args.find((a) => a.startsWith("--limit="));
      const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 20;

      const result = handoff.listHandoffs(projectRoot, { limit });

      if (result.success) {
        console.log(JSON.stringify(result.handoffs));
        process.exit(0);
      } else {
        console.error(result.error);
        process.exit(1);
      }
      break;
    }

    case "status": {
      const stats = handoff.getThreadStats(projectRoot);
      const latestId = handoff.getLatestHandoff(projectRoot);

      console.log(JSON.stringify({ stats, latest_handoff: latestId }));
      process.exit(0);
      break;
    }

    case "chain": {
      const handoffId = args[1];
      if (!handoffId) {
        console.error("Handoff ID required");
        process.exit(1);
      }

      const chain = handoff.getHandoffChain(projectRoot, handoffId);
      console.log(JSON.stringify(chain));
      process.exit(0);
      break;
    }

    case "check-auto": {
      const contextUsage = parseFloat(args[1] || "0");
      const threshold = parseFloat(args[2] || "90");

      const result = handoff.checkAutoHandoff({
        contextUsagePercent: contextUsage,
        threshold,
      });

      console.log(JSON.stringify(result));
      process.exit(result.shouldHandoff ? 0 : 1);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage:");
      console.error("  node cli.js create <summary> [reason] [parent-id]");
      console.error("  node cli.js load <handoff-id>");
      console.error("  node cli.js latest");
      console.error("  node cli.js context [handoff-id]");
      console.error("  node cli.js export [handoff-id]");
      console.error("  node cli.js list [--limit=N]");
      console.error("  node cli.js status");
      console.error("  node cli.js chain <handoff-id>");
      console.error("  node cli.js check-auto <context-usage> [threshold]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
