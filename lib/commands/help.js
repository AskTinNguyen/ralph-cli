/**
 * Ralph help command
 * Generate and display help text
 */
const { pc } = require("../cli");

// Help text sections
const HELP_SECTIONS = {
  header: `${pc.bold("ralph")} ${pc.dim("<command>")}

${pc.bold(pc.white("Autonomous coding loop for Claude Code. PRD-based workflow."))}`,

  gettingStarted: `
${pc.bold("━━━ Getting Started ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.green("install")} ${pc.dim("[--skills] [--import-from]")}   Copy .agents/ralph into current repo
  ${pc.green("init")}                                 Interactive setup wizard for new projects
  ${pc.green("ping")}                                 Verify agent connection is working
  ${pc.green("help")}                                 Show this message`,

  coreWorkflow: `
${pc.bold("━━━ Core Workflow (PRD → Plan → Build) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.green("prd")} ${pc.dim('[\"<request>\"] [--out path]')}       Generate a PRD via agent
  ${pc.green("plan")} ${pc.dim("[n]")}                             Create implementation plan from PRD
  ${pc.green("build")} ${pc.dim("[n] [--resume] [--auto-fix]")}    Execute n build iterations
  ${pc.green("eval")} ${pc.dim("[run-id] [--all]")}                Evaluate run quality and generate reports
  ${pc.green("improve")} ${pc.dim("[--generate] [--apply]")}       Review and apply guardrail candidates

  ${pc.dim("Typical flow: ralph prd → ralph plan → ralph build 5")}`,

  streamManagement: `
${pc.bold("━━━ Stream Management (Parallel Execution) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.green("stream list")}                          List all PRD streams
  ${pc.green("stream status")}                        Show detailed status of all streams
  ${pc.green("stream new")}                           Create new stream (PRD-1, PRD-2, ...)
  ${pc.green("stream init")} ${pc.dim("<N>")}                      Initialize worktree for parallel work
  ${pc.green("stream build")} ${pc.dim("<N> [n]")}                 Run n iterations in stream N
  ${pc.green("stream merge")} ${pc.dim("<N>")}                     Merge completed stream to main
  ${pc.green("stream cleanup")} ${pc.dim("<N>")}                   Remove stream worktree

  ${pc.dim("Parallel: ralph stream build 1 & ralph stream build 2 &")}`,

  analytics: `
${pc.bold("━━━ Analytics & Estimation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.green("estimate")} ${pc.dim("[--prd=N] [--json]")}          Estimate time and cost for PRD
  ${pc.green("stats")} ${pc.dim("[--global] [--json] [--tokens]")} Performance metrics dashboard
  ${pc.green("stats switches")} ${pc.dim("[--json]")}              Agent switch analytics
  ${pc.green("routing analyze")} ${pc.dim("[--prd N]")}            Analyze routing outcomes
  ${pc.green("routing suggest")} ${pc.dim("[--prd N]")}            Suggest threshold adjustments
  ${pc.green("routing learn")} ${pc.dim("[--prd N]")}              Generate guardrails from patterns`,

  diagnostics: `
${pc.bold("━━━ Diagnostics & Experimentation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.green("doctor")} ${pc.dim("[--verbose] [--fix]")}           Environment and setup diagnostics
  ${pc.green("diagnose")} ${pc.dim("[--run id] [--json]")}         Detect failure patterns and fixes

  ${pc.green("experiment create")} ${pc.dim("<name>")}             Create a new A/B experiment
  ${pc.green("experiment list")}                      List all experiments
  ${pc.green("experiment status")} ${pc.dim("<name>")}             Show experiment status
  ${pc.green("experiment start")} ${pc.dim("<name>")}              Start an experiment
  ${pc.green("experiment pause")} ${pc.dim("<name>")}              Pause an experiment
  ${pc.green("experiment conclude")} ${pc.dim("<name>")}           Conclude an experiment
  ${pc.green("experiment analyze")} ${pc.dim("<name>")}            Analyze results with statistics`,

  projectManagement: `
${pc.bold("━━━ Project & Knowledge Management ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.green("registry add")} ${pc.dim("[--tags t1,t2]")}          Register current project
  ${pc.green("registry list")} ${pc.dim("[--tags t1,t2]")}         List registered projects
  ${pc.green("registry remove")}                      Remove project from registry
  ${pc.green("registry update")}                      Update project metadata

  ${pc.green("search")} ${pc.dim("<query> [--filters]")}           Search across all registered projects
  ${pc.green("import guardrails")} ${pc.dim("[--from proj]")}      Import guardrails from another project
  ${pc.green("optimize prompts")} ${pc.dim("[--apply]")}           Analyze and improve prompt templates`,

  utilities: `
${pc.bold("━━━ Utilities ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.green("checkpoint list")} ${pc.dim("[--prd=N]")}            List build checkpoints
  ${pc.green("checkpoint clear")} ${pc.dim("[--prd=N|--all]")}     Clear checkpoints
  ${pc.green("watch")} ${pc.dim("[--prd=N] [--build]")}            Watch files for changes
  ${pc.green("ui")} ${pc.dim("[port] [--open]")}                   Start the Ralph UI server
  ${pc.green("log")} ${pc.dim("\\\"<message>\\\"")}                     Append to activity log
  ${pc.green("completions")} ${pc.dim("[bash|zsh|fish]")}          Generate shell completions`,

  globalOptions: `
${pc.bold("━━━ Global Options ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.yellow("--prd")} ${pc.dim("<N|path>")}            Use PRD-N folder or custom path
  ${pc.yellow("--agent")} ${pc.dim("<claude|codex|droid>")}  Override agent runner
  ${pc.yellow("--model")} ${pc.dim("<opus|sonnet|haiku>")}   Model for cost calculation
  ${pc.yellow("--json")}                   Output as JSON (where supported)`,

  buildOptions: `
${pc.bold("━━━ Build Options ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.yellow("--no-commit")}              Skip automatic git commits
  ${pc.yellow("--no-retry")}               Disable automatic retries on failure
  ${pc.yellow("--resume")}                 Resume from last checkpoint
  ${pc.yellow("--skip-risk-check")}        Bypass high-risk story confirmation prompts
  ${pc.yellow("--auto-fix")} ${pc.dim("<none|safe|all>")}  Control automatic error remediation
    ${pc.dim("none: Disable (default) | safe: Lint/format only | all: Include risky fixes")}
  ${pc.yellow("--parallel")} ${pc.dim("<N>")}            Enable parallel story execution with N concurrent agents
    ${pc.dim("Example: ralph build 5 --parallel=3  (run up to 5 stories with 3 agents in parallel)")}`,

  examples: `
${pc.bold("━━━ Examples ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}

  ${pc.dim("# Standard workflow")}
  ralph prd "Add user authentication"
  ralph plan
  ralph build 5

  ${pc.dim("# Parallel streams")}
  ralph stream init 1 && ralph stream init 2
  ralph stream build 1 & ralph stream build 2 &
  ralph stream status
  ralph stream merge 1

  ${pc.dim("# Estimation and analytics")}
  ralph estimate --prd=1 --json
  ralph stats --global --tokens

${pc.dim("Run")} ${pc.green("ralph <command> --help")} ${pc.dim("for command-specific options.")}`,
};

/**
 * Generate full help text
 * @returns {string}
 */
function generateFullHelp() {
  return [
    HELP_SECTIONS.header,
    HELP_SECTIONS.gettingStarted,
    HELP_SECTIONS.coreWorkflow,
    HELP_SECTIONS.streamManagement,
    HELP_SECTIONS.analytics,
    HELP_SECTIONS.diagnostics,
    HELP_SECTIONS.projectManagement,
    HELP_SECTIONS.utilities,
    HELP_SECTIONS.globalOptions,
    HELP_SECTIONS.buildOptions,
    HELP_SECTIONS.examples,
  ].join("\n");
}

module.exports = {
  name: "help",
  description: "Show help message",
  usage: "ralph help",

  HELP_SECTIONS,
  generateFullHelp,

  /**
   * Run the help command
   * @returns {Promise<number>} Exit code
   */
  async run() {
    console.log(generateFullHelp());
    return 0;
  },
};
