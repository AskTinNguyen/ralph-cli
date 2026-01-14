/**
 * Ralph watch command
 * Watch files for changes
 */
const fs = require("fs");
const path = require("path");
const { error, pc } = require("../cli");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "watch",
  description: "Watch files for changes",
  usage: "ralph watch [--prd=N] [--build]",

  help: `
${pc.bold("ralph watch")} ${pc.dim("[options]")}

Watch PRD and plan files for changes with automatic actions.

${pc.bold("Options:")}
  ${pc.yellow("--prd")} ${pc.dim("<N>")}        Watch specific PRD folder
  ${pc.yellow("--build")}           Enable build mode (auto-build on plan changes)

${pc.bold("Keyboard Shortcuts:")}
  ${pc.cyan("q")}     Quit watcher
  ${pc.cyan("r")}     Reload configuration
  ${pc.cyan("b")}     Trigger manual build (build mode only)
  ${pc.cyan("Enter")} Resume paused build

${pc.bold("Examples:")}
  ${pc.dim("ralph watch")}              Watch most recent PRD
  ${pc.dim("ralph watch --prd=1")}      Watch PRD-1
  ${pc.dim("ralph watch --build")}      Watch with auto-build enabled
`,

  async run(args, env, options) {
    const { cwd, prdNumber: initialPrdNumber, watchBuildMode } = options;
    const watchModule = require("../watch");
    const ralphDir = path.join(cwd, ".ralph");

    let prdNumber = initialPrdNumber;
    let prdFolder = null;

    if (prdNumber) {
      prdFolder = path.join(ralphDir, `PRD-${prdNumber}`);
      if (!exists(prdFolder)) {
        error(`PRD-${prdNumber} not found at ${pc.cyan(prdFolder)}`);
        return 1;
      }
    } else {
      const prdFolders = [];
      if (exists(ralphDir)) {
        for (const item of fs.readdirSync(ralphDir)) {
          if (item.match(/^PRD-\d+$/i)) {
            const folder = path.join(ralphDir, item);
            const planPath = path.join(folder, "plan.md");
            if (exists(planPath)) {
              const stat = fs.statSync(folder);
              prdFolders.push({ folder, mtime: stat.mtime, number: item.match(/\d+/)[0] });
            }
          }
        }
      }

      if (prdFolders.length === 0) {
        error(`No PRD found with plan.md. Run ${pc.cyan("ralph plan")} first.`);
        return 1;
      }

      prdFolders.sort((a, b) => b.mtime - a.mtime);
      prdFolder = prdFolders[0].folder;
      prdNumber = prdFolders[0].number;
    }

    const customConfig = watchModule.loadCustomConfig(cwd);

    const watcher = new watchModule.FileWatcher({
      debounceMs: customConfig?.debounce || 500,
    });

    if (watchBuildMode) {
      watchModule.enableBuildMode();
    }

    const triggerManualBuild = () => {
      if (!watchBuildMode || watchModule.getBuildState().isRunning) return;

      const event = {
        planPath: path.join(prdFolder, "plan.md"),
        prdNumber,
        timestamp: new Date(),
      };

      dashboard.setCurrentAction("plan_build");
      dashboard.setBuildRunning(true);

      watchModule.executeAction("plan_build", event, actionOptions).then((result) => {
        dashboard.setCurrentAction(null);
        if (result.success && result.result) {
          const { success: buildSuccess, paused, exitCode } = result.result;
          dashboard.setBuildPaused(paused || false, exitCode);
          if (buildSuccess) {
            dashboard.addFileChange({
              file: "build",
              action: "run",
              result: "completed",
              resultIcon: "✓",
            });
          } else {
            dashboard.addFileChange({
              file: "build",
              action: "run",
              result: `failed (${exitCode})`,
              resultIcon: "✗",
            });
          }
        }
      });
    };

    const resumeBuild = () => {
      watchModule.resetBuildPause();
      dashboard.clearBuildOutput();
    };

    const dashboard = watchModule.createDashboard({
      projectRoot: cwd,
      maxRecentChanges: 8,
      onQuit: () => {
        watcher.stop();
        process.exit(0);
      },
      onReload: () => {
        watchModule.clearCustomActions();
        watchModule.loadCustomConfig(cwd);
        if (watchBuildMode) {
          watchModule.enableBuildMode();
        }
      },
      onBuild: triggerManualBuild,
      onResume: resumeBuild,
    });

    const actionOptions = {
      projectRoot: cwd,
      prdNumber,
      onOutput: () => {},
      onBuildStart: () => {
        dashboard.setBuildRunning(true);
      },
      onBuildEnd: (success, exitCode) => {
        dashboard.setBuildPaused(!success, exitCode);
        dashboard.refreshPRDStatus();
      },
      onBuildOutput: (line) => {
        dashboard.addBuildOutput(line);
      },
    };

    watcher.on("started", (event) => {
      dashboard.init({
        prdNumber,
        prdPath: prdFolder,
        watchedPaths: event.paths,
        buildMode: watchBuildMode,
      });
      dashboard.start();
    });

    watcher.on("prd_changed", async (event) => {
      dashboard.setCurrentAction("prd_regenerate_plan");

      const results = await watchModule.executeActionsForTrigger("prd_changed", event, actionOptions);

      let resultText = "";
      let resultIcon = "";
      for (const result of results) {
        if (result.success && result.result?.message) {
          resultText = "offer plan";
          resultIcon = "→";
        }
      }

      dashboard.addFileChange({
        file: "prd.md",
        action: event.changeType,
        result: resultText,
        resultIcon,
      });
      dashboard.setCurrentAction(null);
    });

    watcher.on("plan_changed", async (event) => {
      const actionName = watchBuildMode ? "plan_build" : "plan_validate";
      dashboard.setCurrentAction(actionName);

      const results = await watchModule.executeActionsForTrigger("plan_changed", event, actionOptions);

      let resultText = "";
      let resultIcon = "";
      let buildResult = null;

      for (const result of results) {
        if (result.success && result.result) {
          if (result.result.exitCode !== undefined) {
            buildResult = result.result;
            if (result.result.success) {
              resultText = "build completed";
              resultIcon = "✓";
            } else if (result.result.paused) {
              resultText = `build failed (${result.result.exitCode})`;
              resultIcon = "✗";
            } else if (result.result.reason === "already_running") {
              resultText = "build skipped (busy)";
              resultIcon = "→";
            } else if (result.result.reason === "validation_failed") {
              resultText = "validation failed";
              resultIcon = "✗";
            }
          } else if (result.result.valid !== undefined) {
            const { valid, warnings } = result.result;
            if (valid && (!warnings || warnings.length === 0)) {
              resultText = "validated";
              resultIcon = "✓";
            } else if (valid) {
              resultText = `${warnings.length} warning(s)`;
              resultIcon = "⚠";
            } else {
              resultText = "validation failed";
              resultIcon = "✗";
            }
          }
        }
      }

      dashboard.addFileChange({
        file: "plan.md",
        action: event.changeType,
        result: resultText,
        resultIcon,
      });

      if (buildResult) {
        dashboard.setBuildPaused(buildResult.paused || false, buildResult.exitCode);
      }

      dashboard.setCurrentAction(null);
    });

    watcher.on("config_changed", async (event) => {
      const filename = path.basename(event.configPath);
      dashboard.setCurrentAction("config_reload");

      const results = await watchModule.executeActionsForTrigger("config_changed", event, actionOptions);

      let resultText = "";
      let resultIcon = "";
      for (const result of results) {
        if (result.success && result.result) {
          const { valid } = result.result;
          if (valid) {
            resultText = "reloaded";
            resultIcon = "✓";
          }
        }
      }

      dashboard.addFileChange({
        file: filename,
        action: event.changeType,
        result: resultText,
        resultIcon,
      });

      if (filename === "watch.config.js") {
        watchModule.clearCustomActions();
        watchModule.loadCustomConfig(cwd);
      }
      dashboard.setCurrentAction(null);
    });

    watcher.on("file_changed", async (event) => {
      const filename = event.filename;
      if (!filename.endsWith("prd.md") && !filename.endsWith("plan.md")) {
        await watchModule.executeActionsForTrigger("file_changed", event, actionOptions);

        dashboard.addFileChange({
          file: filename,
          action: event.changeType,
          result: "",
          resultIcon: "",
        });
      }
    });

    watcher.on("error", (err) => {
      dashboard.setStatus(`Error: ${err.message}`);
    });

    const started = watcher.start(prdFolder);
    if (!started) {
      error("Failed to start file watcher.");
      return 1;
    }

    const cleanup = () => {
      dashboard.stop();
      watcher.stop();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Keep the process running - this command doesn't return normally
  },
};
