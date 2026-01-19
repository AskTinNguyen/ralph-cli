/**
 * Ralph CLI - Interactive Onboarding Experience
 *
 * Guides new users through Ralph's features after installation
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { pc } = require("./cli");

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
 * Main onboarding flow
 */
async function runOnboarding(options = {}) {
  const { cwd = process.cwd(), skipWelcome = false } = options;

  // Check if interactive terminal
  if (!process.stdin.isTTY) {
    return; // Skip in non-interactive mode
  }

  try {
    const { intro, outro, select, confirm, note, group, isCancel } = await import("@clack/prompts");

    // Welcome screen
    if (!skipWelcome) {
      console.log("");
      intro(pc.bold(pc.cyan("Welcome to Ralph CLI! 🎉")));
      console.log("");
    }

    // Check if user wants onboarding
    const wantsTour = await confirm({
      message: "Would you like a quick interactive tour?",
      initialValue: true,
    });

    if (isCancel(wantsTour) || !wantsTour) {
      showQuickStart();
      outro(pc.dim("You can run this tour anytime with: ") + pc.cyan("ralph init --tour"));
      return;
    }

    // Main onboarding loop
    let continueOnboarding = true;

    while (continueOnboarding) {
      console.log("");
      const choice = await select({
        message: "What would you like to learn about?",
        options: [
          { value: "overview", label: "📋 Overview - What is Ralph?", hint: "Quick introduction" },
          { value: "workflow", label: "🔄 Workflow - PRD → Plan → Build", hint: "How Ralph works" },
          { value: "prd", label: "📝 PRD Generation", hint: "Create requirements documents" },
          { value: "plan", label: "🗺️  Planning", hint: "Break PRDs into stories" },
          { value: "build", label: "🔨 Build Loops", hint: "Automated implementation" },
          { value: "ui", label: "🖥️  UI Dashboard", hint: "Web interface" },
          { value: "demo", label: "🚀 Try a Demo", hint: "Create a sample PRD" },
          { value: "done", label: "✅ I'm ready to start!", hint: "Exit tutorial" },
        ],
      });

      if (isCancel(choice)) {
        break;
      }

      console.log("");

      switch (choice) {
        case "overview":
          await showOverview();
          break;
        case "workflow":
          await showWorkflow();
          break;
        case "prd":
          await showPRDLesson();
          break;
        case "plan":
          await showPlanLesson();
          break;
        case "build":
          await showBuildLesson();
          break;
        case "ui":
          await showUILesson(options);
          break;
        case "demo":
          await runDemo(cwd);
          break;
        case "done":
          continueOnboarding = false;
          break;
      }
    }

    // Completion
    console.log("");
    showNextSteps(cwd);
    outro(pc.green("Happy building! 🎊"));

  } catch (err) {
    // Silently fail if prompts not available
    console.log(pc.dim("Onboarding skipped (non-interactive mode)"));
  }
}

/**
 * Show overview of Ralph
 */
async function showOverview() {
  const { note } = await import("@clack/prompts");

  note(
    [
      `${pc.bold("Ralph CLI")} is an autonomous coding loop that helps you build features faster.`,
      "",
      `${pc.bold("How it works:")}`,
      `  1. ${pc.cyan("PRD")}   - Define what you want to build`,
      `  2. ${pc.cyan("Plan")}  - Break it into implementation stories`,
      `  3. ${pc.cyan("Build")} - AI agent executes stories iteratively`,
      "",
      `${pc.bold("Key features:")}`,
      `  • Autonomous build iterations with Claude/Codex`,
      `  • Git-based progress tracking`,
      `  • Web UI for monitoring`,
      `  • Parallel execution with worktrees`,
      `  • Built-in guardrails and learnings`,
      "",
      `${pc.dim("Think of Ralph as your AI pair programmer that handles the implementation grind.")}`,
    ].join("\n"),
    "What is Ralph?"
  );

  await pressEnterToContinue();
}

/**
 * Show workflow explanation
 */
async function showWorkflow() {
  const { note } = await import("@clack/prompts");

  note(
    [
      `${pc.bold("The Ralph Workflow")} - Three simple steps:`,
      "",
      `${pc.cyan("Step 1: Generate PRD")} ${pc.dim("(Product Requirements Document)")}`,
      `  Command: ${pc.bold("ralph prd")}`,
      `  • Describe your feature in natural language`,
      `  • Ralph generates a structured PRD with user stories`,
      `  • Saved in .ralph/PRD-N/prd.md`,
      "",
      `${pc.cyan("Step 2: Create Plan")}`,
      `  Command: ${pc.bold("ralph plan")}`,
      `  • Breaks PRD into ordered implementation stories`,
      `  • Each story has acceptance criteria`,
      `  • Creates .ralph/PRD-N/plan.md`,
      "",
      `${pc.cyan("Step 3: Run Build Iterations")}`,
      `  Command: ${pc.bold("ralph build 5")}`,
      `  • Executes 5 build iterations`,
      `  • Each iteration picks next story, implements it, commits`,
      `  • Progress tracked in .ralph/PRD-N/progress.md`,
      "",
      `${pc.bold("Result:")} Working code, committed to git, ready to test! 🎉`,
    ].join("\n"),
    "Ralph Workflow"
  );

  await pressEnterToContinue();
}

/**
 * Show PRD lesson
 */
async function showPRDLesson() {
  const { note } = await import("@clack/prompts");

  note(
    [
      `${pc.bold("PRD Generation")} - Turn ideas into structured requirements`,
      "",
      `${pc.bold("What is a PRD?")}`,
      `  A Product Requirements Document defines WHAT you want to build and WHY.`,
      `  Ralph uses PRDs as the source of truth for implementation.`,
      "",
      `${pc.bold("How to create a PRD:")}`,
      `  ${pc.cyan("ralph prd")} ${pc.dim('"Build a dashboard with charts and filters"')}`,
      "",
      `${pc.bold("What Ralph generates:")}`,
      `  • Overview of the feature`,
      `  • User stories with acceptance criteria`,
      `  • Technical considerations`,
      `  • Saved in .ralph/PRD-N/prd.md`,
      "",
      `${pc.bold("Pro tips:")}`,
      `  • Be specific about requirements`,
      `  • Mention existing files/patterns if relevant`,
      `  • Review and edit the PRD before planning`,
      "",
      `${pc.dim("Each PRD is isolated (PRD-1, PRD-2, ...) so you can work on multiple features.")}`,
    ].join("\n"),
    "PRD Generation"
  );

  await pressEnterToContinue();
}

/**
 * Show planning lesson
 */
async function showPlanLesson() {
  const { note } = await import("@clack/prompts");

  note(
    [
      `${pc.bold("Planning")} - Break PRDs into actionable stories`,
      "",
      `${pc.bold("Command:")}`,
      `  ${pc.cyan("ralph plan")}          ${pc.dim("# Use latest PRD")}`,
      `  ${pc.cyan("ralph plan --prd=1")}  ${pc.dim("# Plan specific PRD")}`,
      "",
      `${pc.bold("What Ralph creates:")}`,
      `  • Ordered list of implementation stories (US-001, US-002, ...)`,
      `  • Each story has clear acceptance criteria`,
      `  • Stories are designed to be implemented sequentially`,
      `  • Saved in .ralph/PRD-N/plan.md`,
      "",
      `${pc.bold("Story format:")}`,
      `  ${pc.dim("### [ ] US-001: Setup API endpoint")}`,
      `  ${pc.dim("As a developer, I want a REST API endpoint")}`,
      `  ${pc.dim("So that the frontend can fetch data")}`,
      "",
      `${pc.bold("Pro tips:")}`,
      `  • Review the plan before building`,
      `  • You can manually edit plan.md if needed`,
      `  • Stories are marked [x] when completed`,
      "",
      `${pc.dim("Good planning = smoother builds!")}`,
    ].join("\n"),
    "Planning"
  );

  await pressEnterToContinue();
}

/**
 * Show build lesson
 */
async function showBuildLesson() {
  const { note } = await import("@clack/prompts");

  note(
    [
      `${pc.bold("Build Loops")} - Autonomous implementation`,
      "",
      `${pc.bold("Basic command:")}`,
      `  ${pc.cyan("ralph build 5")}        ${pc.dim("# Run 5 iterations")}`,
      `  ${pc.cyan("ralph build 10 --prd=1")}  ${pc.dim("# Build specific PRD")}`,
      "",
      `${pc.bold("What happens in each iteration:")}`,
      `  1. ${pc.dim("Agent reads plan.md and finds next unchecked story")}`,
      `  2. ${pc.dim("Implements the story (reads files, writes code)")}`,
      `  3. ${pc.dim("Tests the changes")}`,
      `  4. ${pc.dim("Commits to git with conventional commit message")}`,
      `  5. ${pc.dim("Marks story as [x] complete")}`,
      `  6. ${pc.dim("Moves to next story")}`,
      "",
      `${pc.bold("Advanced features:")}`,
      `  ${pc.cyan("--no-commit")}         ${pc.dim("# Dry run, no git commits")}`,
      `  ${pc.cyan("--model=opus")}        ${pc.dim("# Force specific model")}`,
      `  ${pc.cyan("--resume")}            ${pc.dim("# Resume from checkpoint")}`,
      "",
      `${pc.bold("Parallel execution:")}`,
      `  ${pc.cyan("ralph stream build 1 5")}  ${pc.dim("# Build PRD-1 in worktree")}`,
      `  ${pc.dim("Enables working on multiple PRDs at once!")}`,
      "",
      `${pc.dim("Ralph handles the grunt work so you can focus on architecture and review.")}`,
    ].join("\n"),
    "Build Loops"
  );

  await pressEnterToContinue();
}

/**
 * Show UI lesson
 */
async function showUILesson(options) {
  const { note, confirm, isCancel } = await import("@clack/prompts");
  const { repoRoot } = options;

  note(
    [
      `${pc.bold("UI Dashboard")} - Monitor your builds visually`,
      "",
      `${pc.bold("Features:")}`,
      `  • View all PRDs and their status`,
      `  • Read/edit PRD, plan, and progress files`,
      `  • Monitor build progress in real-time`,
      `  • View logs and run history`,
      `  • Interactive PRD wizard`,
      "",
      `${pc.bold("Commands:")}`,
      `  ${pc.cyan("ralph ui")}           ${pc.dim("# Start UI server on port 3000")}`,
      `  ${pc.cyan("ralph ui --open")}    ${pc.dim("# Start and open browser")}`,
      `  ${pc.cyan("ralph gui")}          ${pc.dim("# Alias for 'ralph ui --open'")}`,
      "",
      `${pc.bold("Access:")}`,
      `  ${pc.cyan("http://localhost:3000")}`,
      "",
      `${pc.dim("The UI is great for monitoring long-running builds and reviewing results!")}`,
    ].join("\n"),
    "UI Dashboard"
  );

  // Check if UI dependencies are installed
  const uiDir = path.join(repoRoot, "ui");
  const uiNodeModules = path.join(uiDir, "node_modules");

  if (exists(uiNodeModules)) {
    const wantsDemo = await confirm({
      message: "Would you like to start the UI server now?",
      initialValue: false,
    });

    if (!isCancel(wantsDemo) && wantsDemo) {
      console.log("");
      console.log(pc.cyan("Starting UI server..."));
      console.log(pc.dim("Press Ctrl+C to stop the server when done"));
      console.log("");

      try {
        execSync(`ralph ui --open`, { stdio: "inherit", cwd: process.cwd() });
      } catch (err) {
        console.log(pc.yellow("\nUI server stopped"));
      }
    }
  } else {
    console.log("");
    console.log(pc.yellow("⚠️  UI dependencies not installed yet"));
    console.log(pc.dim("Run the following to enable the UI:"));
    console.log(pc.cyan(`  cd ${uiDir}`));
    console.log(pc.cyan("  npm install"));
    console.log("");
  }

  await pressEnterToContinue();
}

/**
 * Run a demo - create sample PRD
 */
async function runDemo(cwd) {
  const { note, confirm, isCancel } = await import("@clack/prompts");

  note(
    [
      `${pc.bold("Let's create a sample PRD!")}`,
      "",
      `This demo will:`,
      `  1. Generate a sample PRD for a "Todo List" feature`,
      `  2. Show you the generated PRD file`,
      `  3. Let you try planning and building`,
      "",
      `${pc.dim("Don't worry - this is just for practice. You can delete it later.")}`,
    ].join("\n"),
    "Demo Time"
  );

  const wantsDemo = await confirm({
    message: "Create a sample PRD?",
    initialValue: true,
  });

  if (isCancel(wantsDemo) || !wantsDemo) {
    console.log(pc.dim("Skipping demo"));
    return;
  }

  console.log("");
  console.log(pc.cyan("Generating sample PRD..."));
  console.log(pc.dim("(This will take 10-20 seconds)"));
  console.log("");

  try {
    // Create a sample PRD
    const sampleRequest = `
Build a simple todo list application with the following features:
- Add new todos
- Mark todos as complete
- Delete todos
- Filter by status (all/active/completed)
- Save to local storage
`;

    const tmpFile = path.join(require("os").tmpdir(), `ralph-demo-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, sampleRequest);

    // Run ralph prd with the sample
    execSync(`ralph prd --headless < "${tmpFile}"`, {
      stdio: "inherit",
      cwd,
    });

    console.log("");
    console.log(pc.green("✓ Sample PRD created!"));
    console.log("");

    // Find the latest PRD
    const ralphDir = path.join(cwd, ".ralph");
    if (exists(ralphDir)) {
      const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
      const prdFolders = entries
        .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
        .sort((a, b) => {
          const numA = parseInt(a.name.replace(/PRD-/i, ""), 10);
          const numB = parseInt(b.name.replace(/PRD-/i, ""), 10);
          return numB - numA;
        });

      if (prdFolders.length > 0) {
        const latestPRD = prdFolders[0].name;
        const prdFile = path.join(ralphDir, latestPRD, "prd.md");

        note(
          [
            `Your sample PRD is ready!`,
            "",
            `${pc.bold("Location:")} ${pc.cyan(prdFile)}`,
            "",
            `${pc.bold("Next steps:")}`,
            `  ${pc.cyan(`ralph plan`)}        ${pc.dim("# Create implementation plan")}`,
            `  ${pc.cyan(`ralph build 3`)}     ${pc.dim("# Run 3 build iterations")}`,
            `  ${pc.cyan(`ralph ui`)}          ${pc.dim("# Monitor in UI dashboard")}`,
            "",
            `${pc.dim("Feel free to review, edit, or delete this sample PRD.")}`,
          ].join("\n"),
          "Sample PRD Created"
        );
      }
    }

    await pressEnterToContinue();
  } catch (err) {
    console.log("");
    console.log(pc.red("✗ Demo failed: " + err.message));
    console.log(pc.dim("That's okay - you can try the real commands later!"));
    console.log("");
  }
}

/**
 * Show quick start info (when tour is skipped)
 */
function showQuickStart() {
  const { note } = require("@clack/prompts");

  note(
    [
      `${pc.bold("Quick Start:")}`,
      `  ${pc.cyan("ralph prd")}           ${pc.dim("# Generate a PRD")}`,
      `  ${pc.cyan("ralph plan")}          ${pc.dim("# Create implementation plan")}`,
      `  ${pc.cyan("ralph build 5")}       ${pc.dim("# Run 5 build iterations")}`,
      "",
      `${pc.bold("Documentation:")}`,
      `  ${pc.cyan("ralph help")}          ${pc.dim("# Show all commands")}`,
      `  ${pc.cyan("CLAUDE.md")}           ${pc.dim("# Full documentation")}`,
      "",
      `${pc.dim("Happy building!")}`,
    ].join("\n"),
    "Ralph CLI Ready"
  );
}

/**
 * Show next steps after onboarding
 */
function showNextSteps(cwd) {
  const { note } = require("@clack/prompts");

  note(
    [
      `${pc.bold("You're all set! Here's what to do next:")}`,
      "",
      `${pc.bold("1. Create your first PRD")}`,
      `   ${pc.cyan("ralph prd")} ${pc.dim('"Your feature description"')}`,
      "",
      `${pc.bold("2. Review the documentation")}`,
      `   ${pc.cyan("CLAUDE.md")} ${pc.dim("- Comprehensive guide")}`,
      `   ${pc.cyan("ralph help")} ${pc.dim("- Command reference")}`,
      "",
      `${pc.bold("3. Join the community")}`,
      `   ${pc.cyan("https://github.com/AskTinNguyen/ralph-cli")}`,
      "",
      `${pc.bold("4. Explore advanced features")}`,
      `   • Parallel execution with worktrees`,
      `   • Model routing for cost optimization`,
      `   • Factory mode for complex workflows`,
      `   • Voice notifications (auto-speak)`,
      "",
      `${pc.dim("Run")} ${pc.cyan("ralph init --tour")} ${pc.dim("anytime to replay this tutorial.")}`,
    ].join("\n"),
    "Next Steps"
  );
}

/**
 * Wait for user to press Enter
 */
async function pressEnterToContinue() {
  try {
    const { confirm } = await import("@clack/prompts");
    await confirm({
      message: "Press Enter to continue...",
      initialValue: true,
    });
  } catch {
    // Fallback for non-interactive
  }
}

module.exports = {
  runOnboarding,
};
