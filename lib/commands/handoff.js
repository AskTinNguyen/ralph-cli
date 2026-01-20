/**
 * Ralph handoff command
 * Context transfer between AI agent sessions to solve "context drift"
 */
const fs = require("fs");
const path = require("path");
const { error, success, info, dim, warn, pc, hasFlag, parseFlag, hr } = require("../cli");

// Handoff module
const handoff = require("../handoff");

module.exports = {
  name: "handoff",
  description: "Manage context handoffs between AI agent sessions",
  usage: "ralph handoff <subcommand> [options]",

  help: `
${pc.bold("ralph handoff")} - Manage context handoffs between AI agent sessions

Handoffs solve the "context drift" problem by capturing essential state and
transferring it to new agent sessions. Unlike compaction (which summarizes
and loses detail), handoffs preserve critical technical context.

${pc.bold("Subcommands:")}
  ${pc.cyan("create")} [summary]         Create a new handoff from current state
  ${pc.cyan("resume")} [id]              Resume work from a handoff
  ${pc.cyan("list")}                     List all handoffs
  ${pc.cyan("show")} [id]                Show handoff details
  ${pc.cyan("map")}                      Visualize handoff thread graph
  ${pc.cyan("status")}                   Show handoff chain status
  ${pc.cyan("export")} [id]              Export handoff as markdown

${pc.bold("Options:")}
  ${pc.dim("--prd=N")}                   Target specific PRD
  ${pc.dim("--reason=TYPE")}             Handoff reason (manual, context_limit, error, etc.)
  ${pc.dim("--summary=TEXT")}            Summary of work done
  ${pc.dim("--parent=ID")}               Parent handoff ID (for threading)
  ${pc.dim("--root")}                    Create as root handoff (no parent)
  ${pc.dim("--json")}                    Output in JSON format
  ${pc.dim("--mermaid")}                 Output thread map as Mermaid diagram

${pc.bold("Examples:")}
  ${pc.dim('ralph handoff create "Completed auth module, starting API"')}
  ${pc.dim("ralph handoff create --reason=context_limit")}
  ${pc.dim("ralph handoff resume")}                    ${pc.dim("# Resume from latest")}
  ${pc.dim("ralph handoff resume handoff-123456")}     ${pc.dim("# Resume specific")}
  ${pc.dim("ralph handoff list --prd=1")}
  ${pc.dim("ralph handoff map")}
  ${pc.dim("ralph handoff map --mermaid")}

${pc.bold("Auto-Handoff:")}
  Configure auto-handoff in ${pc.dim(".agents/ralph/config.sh")}:
    ${pc.dim("RALPH_AUTO_HANDOFF_THRESHOLD=90")}  # Trigger at 90% context usage
`,

  /**
   * Run the handoff command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd() } = options;

    // Check for help flag
    if (hasFlag(args, "help") || args.length < 2) {
      console.log(this.help);
      return 0;
    }

    const subcommand = args[1];
    const subArgs = args.slice(2);

    switch (subcommand) {
      case "create":
        return this.cmdCreate(subArgs, cwd, options);
      case "resume":
        return this.cmdResume(subArgs, cwd, options);
      case "list":
        return this.cmdList(subArgs, cwd, options);
      case "show":
        return this.cmdShow(subArgs, cwd, options);
      case "map":
        return this.cmdMap(subArgs, cwd, options);
      case "status":
        return this.cmdStatus(subArgs, cwd, options);
      case "export":
        return this.cmdExport(subArgs, cwd, options);
      default:
        error(`Unknown subcommand: ${pc.bold(subcommand)}`);
        info(`Run ${pc.cyan("ralph handoff help")} for available commands.`);
        return 1;
    }
  },

  /**
   * Create a new handoff
   */
  async cmdCreate(args, cwd, options) {
    const summary = args.find((a) => !a.startsWith("--")) || parseFlag(args, "summary");
    const reason = parseFlag(args, "reason") || handoff.HANDOFF_REASONS.MANUAL;
    const parentId = parseFlag(args, "parent");
    const isRoot = hasFlag(args, "root");
    const prdId = parseFlag(args, "prd") || options.prdNumber;
    const json = hasFlag(args, "json");

    // Create handoff
    const result = handoff.createNewHandoff(cwd, {
      summary: summary || undefined,
      reason,
      parent_id: parentId,
      is_root: isRoot,
      prd_id: prdId ? parseInt(prdId, 10) : undefined,
      agent: options.agentOverride || "claude",
      model: options.modelOverride,
    });

    if (!result.success) {
      error(`Failed to create handoff: ${result.error}`);
      return 1;
    }

    // Also save as markdown
    handoff.saveHandoffMarkdown(cwd, result.handoff);

    if (json) {
      console.log(JSON.stringify(result.handoff, null, 2));
      return 0;
    }

    console.log("");
    success("Handoff created successfully!");
    console.log("");
    console.log(`  ${pc.dim("ID:")}      ${pc.bold(result.handoff.id)}`);
    console.log(`  ${pc.dim("Reason:")}  ${result.handoff.reason}`);
    if (result.handoff.parent_id) {
      console.log(`  ${pc.dim("Parent:")}  ${result.handoff.parent_id}`);
    }
    console.log(`  ${pc.dim("Summary:")} ${result.handoff.summary}`);
    console.log(`  ${pc.dim("File:")}    ${pc.cyan(result.path)}`);
    console.log("");

    // Show resume instructions
    dim("To resume from this handoff:");
    console.log(`  ${pc.cyan(`ralph handoff resume ${result.handoff.id}`)}`);
    console.log("");

    return 0;
  },

  /**
   * Resume from a handoff
   */
  async cmdResume(args, cwd, options) {
    const handoffId = args.find((a) => !a.startsWith("--"));
    const json = hasFlag(args, "json");

    // Load handoff
    let result;
    if (handoffId) {
      result = handoff.loadHandoff(cwd, handoffId);
    } else {
      result = handoff.loadLatestHandoff(cwd);
    }

    if (!result.success) {
      if (result.notFound) {
        error("No handoffs found.");
        info(`Create one with: ${pc.cyan("ralph handoff create")}`);
      } else {
        error(`Failed to load handoff: ${result.error}`);
      }
      return 1;
    }

    const loadedHandoff = result.handoff;

    if (json) {
      console.log(JSON.stringify(loadedHandoff, null, 2));
      return 0;
    }

    console.log("");
    console.log(pc.cyan("═".repeat(50)));
    console.log(`${pc.bold("Resuming from Handoff")}`);
    console.log(pc.cyan("═".repeat(50)));
    console.log("");

    // Show handoff details
    console.log(`  ${pc.dim("ID:")}        ${pc.bold(loadedHandoff.id)}`);
    console.log(`  ${pc.dim("Created:")}   ${loadedHandoff.created_at}`);
    console.log(`  ${pc.dim("Reason:")}    ${loadedHandoff.reason}`);
    if (loadedHandoff.prd_id) {
      console.log(`  ${pc.dim("PRD:")}       PRD-${loadedHandoff.prd_id}`);
    }
    if (loadedHandoff.iteration) {
      console.log(`  ${pc.dim("Iteration:")} ${loadedHandoff.iteration}`);
    }
    if (loadedHandoff.story_id) {
      console.log(`  ${pc.dim("Story:")}     ${loadedHandoff.story_id}`);
    }
    console.log("");

    // Show summary
    console.log(pc.bold("Summary:"));
    console.log(`  ${loadedHandoff.summary}`);
    console.log("");

    // Show completed work
    if (loadedHandoff.state?.completed_stories?.length > 0) {
      console.log(pc.bold("Completed Work:"));
      for (const story of loadedHandoff.state.completed_stories.slice(0, 5)) {
        if (typeof story === "object") {
          console.log(`  ${pc.green("✓")} ${story.id}: ${story.title || story.message || ""}`);
        } else {
          console.log(`  ${pc.green("✓")} ${story}`);
        }
      }
      if (loadedHandoff.state.completed_stories.length > 5) {
        dim(`  ... and ${loadedHandoff.state.completed_stories.length - 5} more`);
      }
      console.log("");
    }

    // Show remaining work
    if (loadedHandoff.remaining_work?.length > 0) {
      console.log(pc.bold("Remaining Work:"));
      for (const item of loadedHandoff.remaining_work.slice(0, 5)) {
        if (typeof item === "object") {
          console.log(`  ${pc.dim("○")} ${item.id}: ${item.title || ""}`);
        } else {
          console.log(`  ${pc.dim("○")} ${item}`);
        }
      }
      if (loadedHandoff.remaining_work.length > 5) {
        dim(`  ... and ${loadedHandoff.remaining_work.length - 5} more`);
      }
      console.log("");
    }

    // Show blockers
    if (loadedHandoff.blockers?.length > 0) {
      console.log(pc.bold(pc.yellow("Blockers:")));
      for (const blocker of loadedHandoff.blockers.slice(0, 3)) {
        if (typeof blocker === "object") {
          console.log(`  ${pc.yellow("!")} ${blocker.message || JSON.stringify(blocker)}`);
        } else {
          console.log(`  ${pc.yellow("!")} ${blocker}`);
        }
      }
      console.log("");
    }

    // Show critical files
    if (loadedHandoff.critical_files?.length > 0) {
      console.log(pc.bold("Key Files to Review:"));
      for (const file of loadedHandoff.critical_files.slice(0, 5)) {
        console.log(`  ${pc.dim("-")} ${pc.cyan(file)}`);
      }
      if (loadedHandoff.critical_files.length > 5) {
        dim(`  ... and ${loadedHandoff.critical_files.length - 5} more`);
      }
      console.log("");
    }

    hr("─", 50);
    console.log("");

    // Generate context injection
    const contextInjection = handoff.generateContextInjection(loadedHandoff);

    // Create a new handoff as child of this one
    info("Creating continuation handoff...");

    const newHandoff = handoff.createNewHandoff(cwd, {
      parent_id: loadedHandoff.id,
      reason: handoff.HANDOFF_REASONS.MANUAL,
      summary: `Resumed from: ${loadedHandoff.summary.slice(0, 50)}...`,
      prd_id: loadedHandoff.prd_id,
      iteration: loadedHandoff.iteration,
      story_id: loadedHandoff.story_id,
      agent: options.agentOverride || loadedHandoff.state?.agent || "claude",
    });

    if (newHandoff.success) {
      console.log(`  ${pc.dim("New handoff:")} ${pc.bold(newHandoff.handoff.id)}`);
    }

    console.log("");
    success("Ready to continue work!");
    console.log("");

    // Show context injection preview
    dim("Context to inject (first 20 lines):");
    const previewLines = contextInjection.split("\n").slice(0, 20);
    for (const line of previewLines) {
      console.log(pc.dim(`  ${line}`));
    }
    if (contextInjection.split("\n").length > 20) {
      dim("  ...");
    }
    console.log("");

    return 0;
  },

  /**
   * List all handoffs
   */
  async cmdList(args, cwd, options) {
    const prdId = parseFlag(args, "prd") || options.prdNumber;
    const json = hasFlag(args, "json");
    const limit = parseInt(parseFlag(args, "limit") || "20", 10);

    const result = handoff.listHandoffs(cwd, {
      prd_id: prdId ? parseInt(prdId, 10) : undefined,
      limit,
    });

    if (!result.success) {
      error(`Failed to list handoffs: ${result.error}`);
      return 1;
    }

    if (json) {
      console.log(JSON.stringify(result.handoffs, null, 2));
      return 0;
    }

    if (result.handoffs.length === 0) {
      console.log("");
      info("No handoffs found.");
      dim(`Create one with: ${pc.cyan("ralph handoff create")}`);
      console.log("");
      return 0;
    }

    console.log("");
    console.log(pc.bold("Handoffs"));
    hr("─", 60);
    console.log("");

    for (const h of result.handoffs) {
      const date = new Date(h.created_at);
      const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString();

      console.log(`  ${pc.bold(h.id.slice(0, 24))}...`);
      console.log(`    ${pc.dim("Created:")} ${dateStr}`);
      console.log(`    ${pc.dim("Reason:")}  ${h.reason}`);
      if (h.prd_id) console.log(`    ${pc.dim("PRD:")}     PRD-${h.prd_id}`);
      if (h.story_id) console.log(`    ${pc.dim("Story:")}   ${h.story_id}`);
      console.log(`    ${pc.dim("Summary:")} ${h.summary.slice(0, 50)}${h.summary.length > 50 ? "..." : ""}`);
      if (h.parent_id) console.log(`    ${pc.dim("Parent:")}  ${h.parent_id.slice(0, 20)}...`);
      console.log("");
    }

    dim(`Showing ${result.handoffs.length} handoffs`);
    console.log("");

    return 0;
  },

  /**
   * Show handoff details
   */
  async cmdShow(args, cwd, _options) {
    const handoffId = args.find((a) => !a.startsWith("--"));
    const json = hasFlag(args, "json");

    if (!handoffId) {
      error("Handoff ID required.");
      info(`Usage: ${pc.dim("ralph handoff show <id>")}`);
      return 1;
    }

    const result = handoff.loadHandoff(cwd, handoffId);

    if (!result.success) {
      error(`Failed to load handoff: ${result.error}`);
      return 1;
    }

    if (json) {
      console.log(JSON.stringify(result.handoff, null, 2));
      return 0;
    }

    // Generate and display markdown
    const markdown = handoff.generateHandoffMarkdown(result.handoff);
    console.log(markdown);

    return 0;
  },

  /**
   * Visualize handoff thread map
   */
  async cmdMap(args, cwd, _options) {
    const mermaid = hasFlag(args, "mermaid");
    const json = hasFlag(args, "json");

    if (json) {
      const stats = handoff.getThreadStats(cwd);
      const threadMap = handoff.loadThreadMap(cwd);
      console.log(JSON.stringify({ stats, threads: threadMap.threads }, null, 2));
      return 0;
    }

    if (mermaid) {
      const diagram = handoff.generateMermaidDiagram(cwd);
      console.log(diagram);
      return 0;
    }

    const graph = handoff.visualizeGraph(cwd);
    console.log(graph);

    return 0;
  },

  /**
   * Show handoff chain status
   */
  async cmdStatus(args, cwd, _options) {
    const json = hasFlag(args, "json");

    const stats = handoff.getThreadStats(cwd);
    const latestId = handoff.getLatestHandoff(cwd);

    if (json) {
      console.log(JSON.stringify({ stats, latest_handoff: latestId }, null, 2));
      return 0;
    }

    console.log("");
    console.log(pc.bold("Handoff Status"));
    hr("─", 40);
    console.log("");

    console.log(`  ${pc.dim("Total handoffs:")}  ${pc.bold(stats.total_handoffs)}`);
    console.log(`  ${pc.dim("Total chains:")}    ${stats.total_chains}`);
    console.log(`  ${pc.dim("Max depth:")}       ${stats.max_depth}`);

    if (latestId) {
      console.log(`  ${pc.dim("Latest:")}         ${pc.cyan(latestId)}`);
    }

    if (stats.updated_at) {
      console.log(`  ${pc.dim("Last updated:")}   ${stats.updated_at}`);
    }

    console.log("");

    if (Object.keys(stats.reasons).length > 0) {
      console.log(pc.bold("Handoffs by Reason:"));
      for (const [reason, count] of Object.entries(stats.reasons)) {
        console.log(`  ${reason}: ${count}`);
      }
      console.log("");
    }

    // Show current chain if there is one
    if (latestId) {
      const chain = handoff.getHandoffChain(cwd, latestId);
      if (chain.length > 1) {
        console.log(pc.bold("Current Chain:"));
        for (let i = 0; i < chain.length; i++) {
          const prefix = i === chain.length - 1 ? "└─" : "├─";
          const isLatest = i === chain.length - 1;
          console.log(`  ${prefix} ${isLatest ? pc.cyan(chain[i]) : pc.dim(chain[i])}`);
        }
        console.log("");
      }
    }

    return 0;
  },

  /**
   * Export handoff as markdown
   */
  async cmdExport(args, cwd, _options) {
    let handoffId = args.find((a) => !a.startsWith("--"));
    const outputPath = parseFlag(args, "output") || parseFlag(args, "out");

    // If no ID provided, use latest
    if (!handoffId) {
      handoffId = handoff.getLatestHandoff(cwd);
      if (!handoffId) {
        error("No handoffs found.");
        return 1;
      }
    }

    const result = handoff.loadHandoff(cwd, handoffId);

    if (!result.success) {
      error(`Failed to load handoff: ${result.error}`);
      return 1;
    }

    const markdown = handoff.generateHandoffMarkdown(result.handoff);

    if (outputPath) {
      const absPath = path.isAbsolute(outputPath) ? outputPath : path.join(cwd, outputPath);
      fs.writeFileSync(absPath, markdown);
      success(`Exported to: ${pc.cyan(absPath)}`);
    } else {
      // Output to stdout
      console.log(markdown);
    }

    return 0;
  },
};
