/**
 * Ralph nightly command
 *
 * AI-powered nightly recommendations system:
 * - Gathers data from configured sources
 * - Uses Opus 4.5 to generate actionable recommendations
 * - Sends email notifications
 * - Stores reports in git
 * - Optionally creates PRs with implementations
 */

const fs = require("fs");
const path = require("path");
const {
  success, error, info, dim, warn, pc,
  hasFlag, parseFlag,
} = require("../cli");

const nightly = require("../nightly");

module.exports = {
  name: "nightly",
  description: "AI-powered nightly recommendations",
  usage: "ralph nightly <command> [options]",

  subcommands: {
    run: "Run nightly analysis and generate recommendations",
    config: "Configure data sources and notification settings",
    schedule: "Set up automated scheduling (cron/launchd/GitHub Actions)",
    status: "Show current configuration and schedule status",
    history: "View past recommendations",
    test: "Test configuration without sending notifications",
  },

  help: `
${pc.bold("ralph nightly")} ${pc.dim("<command> [options]")}

AI-powered nightly recommendations that analyze your data and suggest
one high-impact action item each day.

${pc.bold("Commands:")}
  ${pc.green("run")}         Run analysis and generate recommendation
  ${pc.green("config")}      Configure data sources and notifications
  ${pc.green("schedule")}    Set up automated scheduling
  ${pc.green("status")}      Show current configuration
  ${pc.green("history")}     View past recommendations
  ${pc.green("test")}        Test configuration (dry run)

${pc.bold("Run Options:")}
  ${pc.yellow("--email")}          Send email notification
  ${pc.yellow("--slack")}          Send to Slack webhook
  ${pc.yellow("--no-save")}        Don't save markdown report
  ${pc.yellow("--create-pr")}      Create PR with implementation (Phase 2)
  ${pc.yellow("--auto-implement")} Auto-implement and create PR
  ${pc.yellow("--json")}           Output as JSON

${pc.bold("Schedule Options:")}
  ${pc.yellow("--time=HH:MM")}     Schedule time (default: 00:00)
  ${pc.yellow("--method=X")}       cron, launchd, or github-actions
  ${pc.yellow("--uninstall")}      Remove scheduled job

${pc.bold("Environment Variables:")}
  ${pc.yellow("ANTHROPIC_API_KEY")}     Required for AI analysis
  ${pc.yellow("DATABASE_URL")}          PostgreSQL connection string
  ${pc.yellow("SMTP_HOST")}             Email server host
  ${pc.yellow("SMTP_USER")}             Email server username
  ${pc.yellow("SMTP_PASS")}             Email server password
  ${pc.yellow("RALPH_NOTIFY_EMAIL")}    Recipient email address
  ${pc.yellow("SLACK_WEBHOOK")}         Slack webhook URL

${pc.bold("Examples:")}
  ${pc.dim("ralph nightly run")}                    Run and save report
  ${pc.dim("ralph nightly run --email")}            Run and send email
  ${pc.dim("ralph nightly schedule --time=06:00")} Schedule for 6 AM
  ${pc.dim("ralph nightly config")}                 Interactive setup
  ${pc.dim("ralph nightly history")}                View past recommendations
`,

  async run(args, env, options) {
    const { cwd = process.cwd() } = options;
    const subCmd = args[1];

    // Parse common flags
    const jsonFlag = hasFlag(args, "json");
    const verboseFlag = hasFlag(args, "verbose") || hasFlag(args, "v");

    // Route to subcommand
    switch (subCmd) {
      case "run":
        return cmdRun(args, env, { cwd, json: jsonFlag, verbose: verboseFlag });

      case "config":
        return cmdConfig(args, env, { cwd });

      case "schedule":
        return cmdSchedule(args, env, { cwd });

      case "status":
        return cmdStatus(args, env, { cwd, json: jsonFlag });

      case "history":
        return cmdHistory(args, env, { cwd, json: jsonFlag });

      case "test":
        return cmdTest(args, env, { cwd, json: jsonFlag, verbose: verboseFlag });

      case "help":
      case "--help":
      case "-h":
        console.log(this.help);
        return 0;

      default:
        if (!subCmd) {
          console.log(this.help);
          return 0;
        }
        error(`Unknown nightly command: ${pc.bold(subCmd)}`);
        dim(`Run ${pc.cyan("ralph nightly --help")} for available commands.`);
        return 1;
    }
  },
};

/**
 * Run nightly analysis
 */
async function cmdRun(args, env, options) {
  const { cwd, json, verbose } = options;

  // Parse flags
  const sendEmail = hasFlag(args, "email");
  const sendSlack = hasFlag(args, "slack");
  const noSave = hasFlag(args, "no-save");
  const createPR = hasFlag(args, "create-pr");
  const autoImplement = hasFlag(args, "auto-implement");

  // Load config
  const config = loadConfig(cwd);

  if (!json) {
    console.log("");
    console.log(pc.bold("Nightly AI Recommendations"));
    console.log(pc.dim("═".repeat(50)));
    console.log("");
  }

  // Step 1: Collect data
  if (!json) info("Collecting data from configured sources...");

  const sources = config.sources || [
    { name: "ralph", type: "ralph_metrics", cwd },
  ];

  const collectedData = await nightly.collectAll(sources, { verbose });

  if (collectedData.errors.length > 0 && !json) {
    warn(`${collectedData.errors.length} data source(s) had errors`);
    if (verbose) {
      for (const err of collectedData.errors) {
        dim(`  ${err.source}: ${err.error}`);
      }
    }
  }

  const sourceCount = Object.keys(collectedData.sources).length;
  if (!json) success(`Collected data from ${sourceCount} source(s)`);

  // Step 2: Analyze with Opus 4.5
  if (!json) {
    console.log("");
    info("Analyzing data with Claude Opus 4.5...");
  }

  const analysisResult = await nightly.analyze(collectedData, {
    apiKey: env.ANTHROPIC_API_KEY,
    model: config.model || "claude-opus-4-5-20251101",
    context: config.context || {},
  });

  if (!analysisResult.success) {
    error(`Analysis failed: ${analysisResult.error}`);
    return 1;
  }

  if (!json) {
    success("Analysis complete");
    console.log("");
  }

  // Step 3: Display recommendation
  const { recommendation } = analysisResult;

  if (json) {
    console.log(JSON.stringify({
      recommendation,
      analysis: analysisResult.analysis,
      metadata: analysisResult.metadata,
      usage: analysisResult.usage,
    }, null, 2));
  } else {
    displayRecommendation(recommendation, analysisResult.analysis);
  }

  // Step 4: Save markdown report
  if (!noSave) {
    const markdown = nightly.generateMarkdownReport(analysisResult);
    const saveResult = nightly.saveMarkdownReport(markdown, {
      outputDir: config.outputDir || ".ralph/recommendations",
      cwd,
    });

    if (saveResult.success) {
      if (!json) success(`Report saved: ${pc.cyan(saveResult.relativePath)}`);
    } else {
      if (!json) warn(`Failed to save report: ${saveResult.error}`);
    }
  }

  // Step 5: Send notifications
  if (sendEmail || config.email?.enabled) {
    const emailTo = env.RALPH_NOTIFY_EMAIL || config.email?.to;
    if (emailTo) {
      if (!json) info("Sending email notification...");
      const emailResult = await nightly.sendEmail(analysisResult, {
        to: emailTo,
        from: config.email?.from,
        repoUrl: config.repoUrl,
      });

      if (emailResult.success) {
        if (!json) success("Email sent successfully");
      } else {
        if (!json) warn(`Email failed: ${emailResult.error}`);
      }
    }
  }

  if (sendSlack || config.slack?.enabled) {
    const webhookUrl = env.SLACK_WEBHOOK || config.slack?.webhookUrl;
    if (webhookUrl) {
      if (!json) info("Sending Slack notification...");
      const slackResult = await nightly.sendSlackWebhook(analysisResult, webhookUrl);

      if (slackResult.success) {
        if (!json) success("Slack notification sent");
      } else {
        if (!json) warn(`Slack failed: ${slackResult.error}`);
      }
    }
  }

  // Step 6: Auto-implement (Phase 2)
  if (autoImplement || createPR) {
    if (!json) {
      console.log("");
      info("Creating implementation...");
    }

    const mode = autoImplement
      ? nightly.EXECUTION_MODES.FULL_PR
      : nightly.EXECUTION_MODES.BRANCH_ONLY;

    const execResult = await nightly.execute(recommendation, analysisResult, {
      mode,
      cwd,
      verbose,
      baseBranch: config.baseBranch || "main",
      context: config.implementationContext || {},
      pr: {
        draft: true,
        reviewers: config.pr?.reviewers || [],
        labels: config.pr?.labels || ["nightly-recommendation"],
      },
    });

    if (execResult.success) {
      if (execResult.prUrl) {
        if (!json) success(`PR created: ${pc.cyan(execResult.prUrl)}`);
      } else if (execResult.branchName) {
        if (!json) success(`Branch created: ${pc.cyan(execResult.branchName)}`);
      }
    } else {
      if (!json) warn(`Implementation failed: ${execResult.error}`);
    }
  }

  if (!json) {
    console.log("");
    console.log(pc.dim("═".repeat(50)));
  }

  return 0;
}

/**
 * Configure nightly settings
 */
async function cmdConfig(args, env, options) {
  const { cwd } = options;

  try {
    const { intro, outro, text, select, confirm, multiselect, isCancel } = await import("@clack/prompts");

    intro(pc.cyan("Nightly Recommendations Configuration"));

    // Data sources
    const sources = await multiselect({
      message: "Select data sources to collect from:",
      options: [
        { value: "ralph_metrics", label: "Ralph Metrics", hint: "Build stats, costs, guardrails" },
        { value: "postgresql", label: "PostgreSQL", hint: "User activity, business metrics" },
        { value: "mysql", label: "MySQL", hint: "Database queries" },
        { value: "http_api", label: "HTTP API", hint: "Analytics APIs, custom endpoints" },
      ],
      initialValues: ["ralph_metrics"],
    });

    if (isCancel(sources)) {
      outro("Configuration cancelled");
      return 0;
    }

    const config = {
      sources: [],
      email: { enabled: false },
      slack: { enabled: false },
      context: {},
    };

    // Configure Ralph metrics (always include basic config)
    if (sources.includes("ralph_metrics")) {
      config.sources.push({
        name: "ralph",
        type: "ralph_metrics",
      });
    }

    // Configure database if selected
    if (sources.includes("postgresql") || sources.includes("mysql")) {
      const dbType = sources.includes("postgresql") ? "postgresql" : "mysql";

      console.log("");
      info(`Configure ${dbType.toUpperCase()} connection:`);

      const connectionString = await text({
        message: "Database connection string (or press enter to use env var):",
        placeholder: dbType === "postgresql"
          ? "postgresql://user:pass@host:5432/db"
          : "mysql://user:pass@host:3306/db",
      });

      if (!isCancel(connectionString)) {
        const queries = await text({
          message: "SQL queries (JSON array of {name, sql, description}):",
          placeholder: '[{"name": "daily_users", "sql": "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL 1 DAY"}]',
        });

        config.sources.push({
          name: dbType,
          type: dbType,
          connectionString: connectionString || undefined,
          queries: queries ? JSON.parse(queries) : [],
        });
      }
    }

    // Configure HTTP API if selected
    if (sources.includes("http_api")) {
      console.log("");
      info("Configure HTTP API endpoints:");

      const endpoints = await text({
        message: "API endpoints (JSON array of {name, url, headers, description}):",
        placeholder: '[{"name": "analytics", "url": "https://api.example.com/stats"}]',
      });

      if (!isCancel(endpoints) && endpoints) {
        config.sources.push({
          name: "api",
          type: "http_api",
          endpoints: JSON.parse(endpoints),
        });
      }
    }

    // Email configuration
    console.log("");
    const enableEmail = await confirm({
      message: "Enable email notifications?",
      initialValue: false,
    });

    if (!isCancel(enableEmail) && enableEmail) {
      const emailTo = await text({
        message: "Recipient email address:",
        placeholder: "you@example.com",
      });

      if (!isCancel(emailTo) && emailTo) {
        config.email = {
          enabled: true,
          to: emailTo,
        };
      }
    }

    // Slack configuration
    const enableSlack = await confirm({
      message: "Enable Slack notifications?",
      initialValue: false,
    });

    if (!isCancel(enableSlack) && enableSlack) {
      const webhookUrl = await text({
        message: "Slack webhook URL:",
        placeholder: "https://hooks.slack.com/services/...",
      });

      if (!isCancel(webhookUrl) && webhookUrl) {
        config.slack = {
          enabled: true,
          webhookUrl,
        };
      }
    }

    // Business context
    console.log("");
    const businessType = await select({
      message: "What type of business/product?",
      options: [
        { value: "saas", label: "SaaS Product" },
        { value: "ecommerce", label: "E-commerce" },
        { value: "marketplace", label: "Marketplace" },
        { value: "devtools", label: "Developer Tools" },
        { value: "other", label: "Other" },
      ],
    });

    if (!isCancel(businessType)) {
      config.context = {
        businessType,
        goals: ["growth", "engagement", "retention"],
      };
    }

    // Save config
    const configPath = path.join(cwd, ".ralph", "nightly-config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    outro(pc.green(`Configuration saved to ${pc.cyan(".ralph/nightly-config.json")}`));

    return 0;
  } catch (err) {
    if (err.message?.includes("uv_tty_init")) {
      error("Interactive mode not available. Edit .ralph/nightly-config.json directly.");
      return 1;
    }
    throw err;
  }
}

/**
 * Schedule nightly runs
 */
async function cmdSchedule(args, env, options) {
  const { cwd } = options;

  const uninstall = hasFlag(args, "uninstall");
  const time = parseFlag(args, "time", "00:00");
  const method = parseFlag(args, "method", null);

  if (uninstall) {
    info("Removing scheduled jobs...");

    const cronResult = await nightly.uninstallCron({ projectPath: cwd });
    if (cronResult.success) {
      success(`Cron: ${cronResult.message}`);
    }

    if (process.platform === "darwin") {
      const launchdResult = await nightly.scheduler.uninstallLaunchd({ projectPath: cwd });
      if (launchdResult.success) {
        success(`Launchd: ${launchdResult.message}`);
      }
    }

    return 0;
  }

  // Determine best method
  const effectiveMethod = method || (process.platform === "darwin" ? "launchd" : "cron");

  console.log("");
  console.log(pc.bold("Setting Up Nightly Schedule"));
  console.log(pc.dim("═".repeat(50)));
  console.log("");

  info(`Schedule time: ${pc.bold(time)}`);
  info(`Method: ${pc.bold(effectiveMethod)}`);
  console.log("");

  let result;

  switch (effectiveMethod) {
    case "cron":
      result = await nightly.installCron({ time, projectPath: cwd });
      break;

    case "launchd":
      if (process.platform !== "darwin") {
        error("Launchd is only available on macOS");
        return 1;
      }
      result = await nightly.installLaunchd({ time, projectPath: cwd });
      break;

    case "github-actions":
      const workflow = nightly.generateGitHubActionsWorkflow({ time });
      const workflowPath = path.join(cwd, ".github", "workflows", "nightly-recommendations.yml");
      fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
      fs.writeFileSync(workflowPath, workflow);
      result = {
        success: true,
        method: "github-actions",
        path: workflowPath,
      };
      break;

    default:
      error(`Unknown scheduling method: ${effectiveMethod}`);
      return 1;
  }

  if (result.success) {
    success(`Schedule installed via ${pc.bold(result.method || effectiveMethod)}`);
    if (result.path) {
      dim(`File: ${result.path}`);
    }
    if (result.entry) {
      dim(`Entry: ${result.entry}`);
    }
    console.log("");
    info("The nightly recommendation will run automatically at the scheduled time.");
  } else {
    error(`Failed to install schedule: ${result.error}`);
    return 1;
  }

  return 0;
}

/**
 * Show status
 */
async function cmdStatus(args, env, options) {
  const { cwd, json } = options;

  const config = loadConfig(cwd);
  const scheduleStatus = nightly.getScheduleStatus({ projectPath: cwd });

  if (json) {
    console.log(JSON.stringify({ config, schedule: scheduleStatus }, null, 2));
    return 0;
  }

  console.log("");
  console.log(pc.bold("Nightly Recommendations Status"));
  console.log(pc.dim("═".repeat(50)));

  // Configuration
  console.log("");
  console.log(pc.bold(pc.cyan("Configuration")));

  const configPath = path.join(cwd, ".ralph", "nightly-config.json");
  if (fs.existsSync(configPath)) {
    success(`Config file: ${pc.cyan(".ralph/nightly-config.json")}`);
    dim(`  Sources: ${config.sources?.length || 0} configured`);
    dim(`  Email: ${config.email?.enabled ? pc.green("enabled") : pc.dim("disabled")}`);
    dim(`  Slack: ${config.slack?.enabled ? pc.green("enabled") : pc.dim("disabled")}`);
  } else {
    warn("No configuration file found");
    dim(`  Run ${pc.cyan("ralph nightly config")} to set up`);
  }

  // API Key
  console.log("");
  if (env.ANTHROPIC_API_KEY) {
    success("ANTHROPIC_API_KEY: " + pc.green("set"));
  } else {
    warn("ANTHROPIC_API_KEY: " + pc.red("not set"));
  }

  // Schedule
  console.log("");
  console.log(pc.bold(pc.cyan("Schedule")));

  if (scheduleStatus.cron.installed) {
    success(`Cron: ${pc.green("installed")} at ${scheduleStatus.cron.time || "unknown time"}`);
  } else {
    dim("Cron: not installed");
  }

  if (process.platform === "darwin") {
    if (scheduleStatus.launchd.installed) {
      success(`Launchd: ${pc.green("installed")}`);
    } else {
      dim("Launchd: not installed");
    }
  }

  if (scheduleStatus.githubActions.installed) {
    success(`GitHub Actions: ${pc.green("installed")}`);
    dim(`  Path: ${scheduleStatus.githubActions.path}`);
  } else {
    dim("GitHub Actions: not installed");
  }

  // Recent recommendations
  console.log("");
  console.log(pc.bold(pc.cyan("Recent Recommendations")));

  const recsDir = path.join(cwd, ".ralph", "recommendations");
  if (fs.existsSync(recsDir)) {
    const files = fs.readdirSync(recsDir)
      .filter(f => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, 5);

    if (files.length > 0) {
      for (const file of files) {
        dim(`  ${file}`);
      }
    } else {
      dim("  No recommendations yet");
    }
  } else {
    dim("  No recommendations yet");
  }

  console.log("");
  console.log(pc.dim("═".repeat(50)));

  return 0;
}

/**
 * Show history
 */
async function cmdHistory(args, env, options) {
  const { cwd, json } = options;

  const limitFlag = parseFlag(args, "limit", "10");
  const limit = parseInt(limitFlag, 10);

  const recsDir = path.join(cwd, ".ralph", "recommendations");

  if (!fs.existsSync(recsDir)) {
    if (json) {
      console.log(JSON.stringify({ recommendations: [] }, null, 2));
    } else {
      info("No recommendations found yet.");
      dim(`Run ${pc.cyan("ralph nightly run")} to generate your first recommendation.`);
    }
    return 0;
  }

  const files = fs.readdirSync(recsDir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, limit);

  if (files.length === 0) {
    if (json) {
      console.log(JSON.stringify({ recommendations: [] }, null, 2));
    } else {
      info("No recommendations found yet.");
    }
    return 0;
  }

  const recommendations = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(recsDir, file), "utf-8");

    // Extract title from markdown
    const titleMatch = content.match(/^## .* Recommendation\n\n### (.+)$/m);
    const priorityMatch = content.match(/\*\*Priority:\*\* (\w+)/i);
    const dateMatch = file.match(/recommendation-(\d{4}-\d{2}-\d{2})/);

    recommendations.push({
      file,
      date: dateMatch ? dateMatch[1] : null,
      title: titleMatch ? titleMatch[1] : "Unknown",
      priority: priorityMatch ? priorityMatch[1].toLowerCase() : "medium",
    });
  }

  if (json) {
    console.log(JSON.stringify({ recommendations }, null, 2));
    return 0;
  }

  console.log("");
  console.log(pc.bold("Recommendation History"));
  console.log(pc.dim("═".repeat(60)));
  console.log("");

  const priorityColors = {
    critical: pc.red,
    high: pc.yellow,
    medium: pc.blue,
    low: pc.dim,
  };

  for (const rec of recommendations) {
    const color = priorityColors[rec.priority] || pc.dim;
    console.log(`${pc.dim(rec.date || "unknown")}  ${color(`[${rec.priority.toUpperCase()}]`.padEnd(10))}  ${rec.title}`);
  }

  console.log("");
  console.log(pc.dim("═".repeat(60)));
  dim(`Showing ${files.length} of ${limit} most recent. Use ${pc.cyan("--limit=N")} for more.`);

  return 0;
}

/**
 * Test configuration (dry run)
 */
async function cmdTest(args, env, options) {
  const { cwd, json, verbose } = options;

  if (!json) {
    console.log("");
    console.log(pc.bold("Testing Nightly Configuration"));
    console.log(pc.dim("═".repeat(50)));
    console.log("");
  }

  // Load config
  const config = loadConfig(cwd);

  // Test data collection
  if (!json) info("Testing data collection...");

  const sources = config.sources || [
    { name: "ralph", type: "ralph_metrics", cwd },
  ];

  const collectedData = await nightly.collectAll(sources, { verbose });

  if (!json) {
    const sourceCount = Object.keys(collectedData.sources).length;
    const errorCount = collectedData.errors.length;

    if (sourceCount > 0) {
      success(`Data collection: ${sourceCount} source(s) OK`);
    }
    if (errorCount > 0) {
      warn(`Data collection: ${errorCount} error(s)`);
      for (const err of collectedData.errors) {
        dim(`  ${err.source}: ${err.error}`);
      }
    }
  }

  // Test API key
  if (!json) {
    console.log("");
    info("Testing Anthropic API...");
  }

  if (!env.ANTHROPIC_API_KEY) {
    if (!json) error("ANTHROPIC_API_KEY not set");
    if (json) {
      console.log(JSON.stringify({
        success: false,
        error: "ANTHROPIC_API_KEY not set",
      }, null, 2));
    }
    return 1;
  }

  // Quick API test with minimal tokens
  const testResult = await nightly.analyze(
    { timestamp: new Date().toISOString(), sources: { test: { data: { ping: "pong" } } } },
    {
      apiKey: env.ANTHROPIC_API_KEY,
      maxTokens: 100,
    }
  );

  if (testResult.success) {
    if (!json) success("API connection: OK");
  } else {
    if (!json) error(`API connection failed: ${testResult.error}`);
    if (json) {
      console.log(JSON.stringify({ success: false, error: testResult.error }, null, 2));
    }
    return 1;
  }

  // Test email config
  if (config.email?.enabled) {
    if (!json) {
      console.log("");
      info("Email configuration:");
      dim(`  To: ${config.email.to || "not set"}`);
      dim(`  SMTP: ${env.SMTP_HOST ? "configured" : "not configured"}`);
    }
  }

  // Test Slack config
  if (config.slack?.enabled) {
    if (!json) {
      console.log("");
      info("Slack configuration:");
      dim(`  Webhook: ${config.slack.webhookUrl ? "configured" : "not configured"}`);
    }
  }

  if (!json) {
    console.log("");
    console.log(pc.dim("═".repeat(50)));
    success("Configuration test complete");
    console.log("");
    dim(`Run ${pc.cyan("ralph nightly run")} to generate a recommendation.`);
  } else {
    console.log(JSON.stringify({
      success: true,
      sources: Object.keys(collectedData.sources),
      errors: collectedData.errors,
      apiConnection: "ok",
    }, null, 2));
  }

  return 0;
}

/**
 * Load nightly config
 */
function loadConfig(cwd) {
  const configPath = path.join(cwd, ".ralph", "nightly-config.json");

  if (!fs.existsSync(configPath)) {
    return {
      sources: [{ name: "ralph", type: "ralph_metrics" }],
      email: { enabled: false },
      slack: { enabled: false },
      context: {},
    };
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {
      sources: [{ name: "ralph", type: "ralph_metrics" }],
      email: { enabled: false },
      slack: { enabled: false },
      context: {},
    };
  }
}

/**
 * Display recommendation in terminal
 */
function displayRecommendation(recommendation, analysis) {
  const priorityColors = {
    critical: pc.red,
    high: pc.yellow,
    medium: pc.blue,
  };

  const priorityEmoji = {
    critical: "🚨",
    high: "⚡",
    medium: "💡",
  };

  const color = priorityColors[recommendation?.priority] || pc.blue;
  const emoji = priorityEmoji[recommendation?.priority] || "💡";

  console.log(pc.bold(pc.cyan("Recommendation")));
  console.log(pc.dim("─".repeat(50)));
  console.log("");
  console.log(`${emoji} ${pc.bold(recommendation?.title || "Action Item")}`);
  console.log("");
  console.log(`Priority: ${color(recommendation?.priority?.toUpperCase() || "MEDIUM")}`);
  console.log(`Effort: ${recommendation?.effort || "medium"}`);
  console.log("");
  console.log(pc.dim("Summary:"));
  console.log(`  ${recommendation?.summary || ""}`);
  console.log("");

  if (recommendation?.details) {
    console.log(pc.dim("Details:"));
    const details = recommendation.details.split("\n");
    for (const line of details) {
      console.log(`  ${line}`);
    }
    console.log("");
  }

  if (recommendation?.dataPoints?.length > 0) {
    console.log(pc.dim("Key Data Points:"));
    for (const point of recommendation.dataPoints) {
      console.log(`  • ${point}`);
    }
    console.log("");
  }

  if (recommendation?.nextSteps?.length > 0) {
    console.log(pc.dim("Next Steps:"));
    recommendation.nextSteps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step}`);
    });
    console.log("");
  }

  if (analysis?.keyInsights?.length > 0) {
    console.log(pc.dim("─".repeat(50)));
    console.log(pc.bold(pc.cyan("Key Insights")));
    for (const insight of analysis.keyInsights) {
      console.log(`  💡 ${insight}`);
    }
    console.log("");
  }
}
