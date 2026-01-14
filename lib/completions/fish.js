/**
 * Fish completion generator for ralph CLI
 *
 * Generates a fish completion script that provides:
 * - Command completion with descriptions
 * - Option completion with descriptions
 * - Dynamic PRD number completion from .ralph/PRD-* directories
 * - Follows fish completion conventions
 */

const {
  COMMANDS,
  STREAM_SUBCOMMANDS,
  REGISTRY_SUBCOMMANDS,
  IMPORT_SUBCOMMANDS,
  OPTIMIZE_SUBCOMMANDS,
  AGENTS,
  MODELS,
} = require("./bash");

const { COMMAND_DESCRIPTIONS } = require("./zsh");

/**
 * Stream subcommand descriptions
 */
const STREAM_DESCRIPTIONS = {
  new: "Create new stream",
  list: "List all streams",
  status: "Show stream status",
  init: "Initialize stream worktree",
  build: "Run build in stream",
  merge: "Merge stream to main",
  cleanup: "Remove stream worktree",
};

/**
 * Registry subcommand descriptions
 */
const REGISTRY_DESCRIPTIONS = {
  add: "Add agent to registry",
  list: "List registered agents",
  remove: "Remove agent from registry",
  update: "Update agent registry",
};

/**
 * Import subcommand descriptions
 */
const IMPORT_DESCRIPTIONS = {
  guardrails: "Import guardrails from another project",
};

/**
 * Optimize subcommand descriptions
 */
const OPTIMIZE_DESCRIPTIONS = {
  prompts: "Optimize prompt templates",
};

/**
 * Build command options with descriptions
 */
const BUILD_OPTIONS = {
  "--prd": "Specify PRD number",
  "--agent": "Specify agent (claude/codex/droid)",
  "--no-commit": "Skip git commit",
  "--no-retry": "Disable automatic retry",
  "--resume": "Resume previous run",
};

/**
 * Plan command options
 */
const PLAN_OPTIONS = {
  "--prd": "Specify PRD number",
};

/**
 * PRD command options
 */
const PRD_OPTIONS = {
  "--out": "Output path for PRD file",
};

/**
 * Estimate command options
 */
const ESTIMATE_OPTIONS = {
  "--prd": "Specify PRD number",
  "--json": "Output as JSON",
  "--pricing": "Show pricing breakdown",
  "--model": "Specify model (opus/sonnet/haiku)",
  "--accuracy": "Show accuracy estimates",
};

/**
 * Doctor command options
 */
const DOCTOR_OPTIONS = {
  "--verbose": "Show verbose output",
  "-v": "Show verbose output",
  "--json": "Output as JSON",
  "--fix": "Attempt to fix issues",
};

/**
 * Stats command options
 */
const STATS_OPTIONS = {
  "--global": "Show global stats",
  "-g": "Show global stats",
  "--json": "Output as JSON",
  "--no-cache": "Bypass cache",
  "--tokens": "Show token breakdown",
};

/**
 * Install command options
 */
const INSTALL_OPTIONS = {
  "--skills": "Install skills",
  "--force": "Force overwrite",
  "--import-from": "Import from path",
};

/**
 * Search command options
 */
const SEARCH_OPTIONS = {
  "--project": "Filter by project name",
  "--type": "Filter by entry type",
  "--tags": "Filter by tags",
  "--since": "Filter by date",
  "--limit": "Limit results",
  "--rebuild": "Rebuild search index",
};

/**
 * Diagnose command options
 */
const DIAGNOSE_OPTIONS = {
  "--run": "Specify run ID",
  "--json": "Output as JSON",
  "--limit": "Limit results",
};

/**
 * UI command options
 */
const UI_OPTIONS = {
  "--open": "Open in browser",
};

/**
 * Import guardrails options
 */
const IMPORT_GUARDRAILS_OPTIONS = {
  "--from": "Source path",
  "--all": "Import all guardrails",
};

/**
 * Optimize prompts options
 */
const OPTIMIZE_PROMPTS_OPTIONS = {
  "--apply": "Apply optimizations",
  "--versions": "Show version history",
};

/**
 * Completions command options
 */
const COMPLETIONS_OPTIONS = {
  "--install": "Auto-install completions",
};

/**
 * Generate fish completion entries for options
 * @param {string} command - The parent command
 * @param {Object} options - Object mapping option flags to descriptions
 * @param {string} condition - Additional condition for the completion
 * @returns {string} Fish completion commands
 */
function generateOptionCompletions(command, options, condition = "") {
  const baseCondition = command
    ? `__fish_seen_subcommand_from ${command}`
    : "__fish_use_subcommand";
  const fullCondition = condition
    ? `${baseCondition}; and ${condition}`
    : baseCondition;

  return Object.entries(options)
    .map(([flag, desc]) => {
      const longFlag = flag.startsWith("--");
      const flagArg = longFlag ? `--long ${flag.slice(2)}` : `--short ${flag.slice(1)}`;
      return `complete -c ralph -n "${fullCondition}" ${flagArg} --description "${desc}"`;
    })
    .join("\n");
}

/**
 * Generate fish completion entries for subcommands
 * @param {string} parentCommand - The parent command
 * @param {Array} subcommands - Array of subcommand names
 * @param {Object} descriptions - Object mapping subcommand to description
 * @returns {string} Fish completion commands
 */
function generateSubcommandCompletions(parentCommand, subcommands, descriptions) {
  const condition = `__fish_seen_subcommand_from ${parentCommand}; and not __fish_seen_subcommand_from ${subcommands.join(" ")}`;
  return subcommands
    .map((cmd) => {
      const desc = descriptions[cmd] || cmd;
      return `complete -c ralph -n "${condition}" --arguments "${cmd}" --description "${desc}"`;
    })
    .join("\n");
}

/**
 * Generate the complete fish completion script
 * @returns {string} The fish completion script
 */
function generate() {
  // Generate command completions
  const commandCompletions = COMMANDS.map((cmd) => {
    const desc = COMMAND_DESCRIPTIONS[cmd] || cmd;
    return `complete -c ralph -n "__fish_use_subcommand" --arguments "${cmd}" --description "${desc}"`;
  }).join("\n");

  return `# Fish completion for ralph CLI
# Generated by ralph completions fish
#
# Installation:
#   ralph completions fish > ~/.config/fish/completions/ralph.fish
#   # Completions load automatically on next shell start

# Disable file completions by default for ralph
complete -c ralph -f

# Helper function to get PRD numbers
function __ralph_get_prd_numbers
    set -l ralph_dir ".ralph"
    if test -d "$ralph_dir"
        for dir in $ralph_dir/PRD-*
            if test -d "$dir"
                basename "$dir" | string replace 'PRD-' ''
            end
        end
    end
end

# Helper function to get worktree PRD numbers
function __ralph_get_worktree_prds
    set -l worktrees_dir ".ralph/worktrees"
    if test -d "$worktrees_dir"
        for dir in $worktrees_dir/PRD-*
            if test -d "$dir"
                basename "$dir" | string replace 'PRD-' ''
            end
        end
    end
end

# Helper function to check if we need PRD number completion
function __ralph_needs_prd_number
    set -l cmd (commandline -opc)
    # Check for --prd= style
    set -l last_token (commandline -ct)
    if string match -q -- '--prd=*' "$last_token"
        return 0
    end
    # Check if previous token was --prd
    if test (count $cmd) -ge 2
        if test "$cmd[-1]" = "--prd"
            return 0
        end
    end
    return 1
end

# Helper function to check if we need agent completion
function __ralph_needs_agent
    set -l cmd (commandline -opc)
    set -l last_token (commandline -ct)
    if string match -q -- '--agent=*' "$last_token"
        return 0
    end
    if test (count $cmd) -ge 2
        if test "$cmd[-1]" = "--agent"
            return 0
        end
    end
    return 1
end

# Helper function to check if we need model completion
function __ralph_needs_model
    set -l cmd (commandline -opc)
    set -l last_token (commandline -ct)
    if string match -q -- '--model=*' "$last_token"
        return 0
    end
    if test (count $cmd) -ge 2
        if test "$cmd[-1]" = "--model"
            return 0
        end
    end
    return 1
end

# Global options
complete -c ralph -n "__fish_use_subcommand" --long help --description "Show help information"
complete -c ralph -n "__fish_use_subcommand" --long version --description "Show version"

# Commands
${commandCompletions}

# Build command options
${generateOptionCompletions("build", BUILD_OPTIONS)}
complete -c ralph -n "__fish_seen_subcommand_from build; and __ralph_needs_prd_number" --arguments "(__ralph_get_prd_numbers)" --description "PRD number"
complete -c ralph -n "__fish_seen_subcommand_from build; and __ralph_needs_agent" --arguments "${AGENTS.join(" ")}" --description "Agent name"

# Plan command options
${generateOptionCompletions("plan", PLAN_OPTIONS)}
complete -c ralph -n "__fish_seen_subcommand_from plan; and __ralph_needs_prd_number" --arguments "(__ralph_get_prd_numbers)" --description "PRD number"

# PRD command options
${generateOptionCompletions("prd", PRD_OPTIONS)}

# Stream subcommands
${generateSubcommandCompletions("stream", STREAM_SUBCOMMANDS, STREAM_DESCRIPTIONS)}
# Stream subcommand arguments (PRD numbers for init/build/merge/cleanup)
complete -c ralph -n "__fish_seen_subcommand_from stream; and __fish_seen_subcommand_from init build merge cleanup" --arguments "(__ralph_get_prd_numbers)" --description "PRD number"

# Registry subcommands
${generateSubcommandCompletions("registry", REGISTRY_SUBCOMMANDS, REGISTRY_DESCRIPTIONS)}

# Import subcommands
${generateSubcommandCompletions("import", IMPORT_SUBCOMMANDS, IMPORT_DESCRIPTIONS)}
# Import guardrails options
${generateOptionCompletions("guardrails", IMPORT_GUARDRAILS_OPTIONS, "__fish_seen_subcommand_from import")}

# Optimize subcommands
${generateSubcommandCompletions("optimize", OPTIMIZE_SUBCOMMANDS, OPTIMIZE_DESCRIPTIONS)}
# Optimize prompts options
${generateOptionCompletions("prompts", OPTIMIZE_PROMPTS_OPTIONS, "__fish_seen_subcommand_from optimize")}

# Estimate command options
${generateOptionCompletions("estimate", ESTIMATE_OPTIONS)}
complete -c ralph -n "__fish_seen_subcommand_from estimate; and __ralph_needs_prd_number" --arguments "(__ralph_get_prd_numbers)" --description "PRD number"
complete -c ralph -n "__fish_seen_subcommand_from estimate; and __ralph_needs_model" --arguments "${MODELS.join(" ")}" --description "Model name"

# Doctor command options
${generateOptionCompletions("doctor", DOCTOR_OPTIONS)}

# Stats command options
${generateOptionCompletions("stats", STATS_OPTIONS)}

# Search command options
${generateOptionCompletions("search", SEARCH_OPTIONS)}
complete -c ralph -n "__fish_seen_subcommand_from search; and string match -q -- '--type=*' (commandline -ct)" --arguments "guardrail progress evaluation run" --description "Entry type"

# Install command options
${generateOptionCompletions("install", INSTALL_OPTIONS)}

# Diagnose command options
${generateOptionCompletions("diagnose", DIAGNOSE_OPTIONS)}

# UI command options
${generateOptionCompletions("ui", UI_OPTIONS)}

# Completions command options
${generateOptionCompletions("completions", COMPLETIONS_OPTIONS)}
complete -c ralph -n "__fish_seen_subcommand_from completions; and not __fish_seen_subcommand_from bash zsh fish" --arguments "bash zsh fish" --description "Shell type"
`;
}

module.exports = {
  generate,
  STREAM_DESCRIPTIONS,
  REGISTRY_DESCRIPTIONS,
  IMPORT_DESCRIPTIONS,
  OPTIMIZE_DESCRIPTIONS,
  BUILD_OPTIONS,
  ESTIMATE_OPTIONS,
  DOCTOR_OPTIONS,
  STATS_OPTIONS,
  SEARCH_OPTIONS,
  INSTALL_OPTIONS,
  DIAGNOSE_OPTIONS,
  UI_OPTIONS,
  COMPLETIONS_OPTIONS,
};
