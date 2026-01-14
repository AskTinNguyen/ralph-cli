/**
 * Zsh completion generator for ralph CLI
 *
 * Generates a zsh completion script that provides:
 * - Command completion with descriptions
 * - Grouped option completion
 * - Dynamic PRD number completion from .ralph/PRD-* directories
 * - Oh My Zsh plugin compatibility
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

/**
 * Command descriptions for zsh completion menu
 */
const COMMAND_DESCRIPTIONS = {
  build: "Run build loop iterations",
  plan: "Generate implementation plan from PRD",
  prd: "Create or edit PRD document",
  stream: "Manage parallel execution streams",
  install: "Install ralph to a project",
  ping: "Check ralph installation",
  status: "Show current build status",
  doctor: "Run diagnostic checks",
  init: "Initialize ralph in current directory",
  watch: "Watch for file changes",
  eval: "Evaluate story completion",
  estimate: "Estimate token costs",
  improve: "Suggest improvements",
  registry: "Manage agent registry",
  search: "Search project history",
  import: "Import resources",
  stats: "Show usage statistics",
  optimize: "Optimize prompts and configs",
  diagnose: "Diagnose build failures",
  ui: "Launch web interface",
  checkpoint: "Create checkpoint",
  help: "Show help information",
  log: "Log activity message",
  completions: "Generate shell completions",
};

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
 * Build flag descriptions for grouping
 */
const BUILD_FLAG_DESCRIPTIONS = {
  "--prd": "[PRD number]:PRD number:_ralph_prd_numbers",
  "--agent": "[agent]:Agent name:(claude codex droid)",
  "--no-commit": "Skip git commit",
  "--no-retry": "Disable automatic retry",
  "--resume": "Resume previous run",
};

/**
 * Estimate flag descriptions
 */
const ESTIMATE_FLAG_DESCRIPTIONS = {
  "--prd": "[PRD number]:PRD number:_ralph_prd_numbers",
  "--json": "Output as JSON",
  "--pricing": "Show pricing breakdown",
  "--model": "[model]:Model name:(opus sonnet haiku)",
  "--accuracy": "Show accuracy estimates",
};

/**
 * Doctor flag descriptions
 */
const DOCTOR_FLAG_DESCRIPTIONS = {
  "--verbose": "Show verbose output",
  "-v": "Show verbose output",
  "--json": "Output as JSON",
  "--fix": "Attempt to fix issues",
};

/**
 * Stats flag descriptions
 */
const STATS_FLAG_DESCRIPTIONS = {
  "--global": "Show global stats",
  "-g": "Show global stats",
  "--json": "Output as JSON",
  "--no-cache": "Bypass cache",
  "--tokens": "Show token breakdown",
};

/**
 * Install flag descriptions
 */
const INSTALL_FLAG_DESCRIPTIONS = {
  "--skills": "Install skills",
  "--force": "Force overwrite",
  "--import-from": "[path]:Import from path:_files",
};

/**
 * Search flag descriptions
 */
const SEARCH_FLAG_DESCRIPTIONS = {
  "--project": "[name]:Project name:",
  "--type": "[type]:Entry type:(guardrail progress evaluation run)",
  "--tags": "[tags]:Filter by tags:",
  "--since": "[date]:Since date:",
  "--limit": "[count]:Result limit:",
  "--rebuild": "Rebuild search index",
};

/**
 * Diagnose flag descriptions
 */
const DIAGNOSE_FLAG_DESCRIPTIONS = {
  "--run": "[id]:Run ID:",
  "--json": "Output as JSON",
  "--limit": "[count]:Result limit:",
};

/**
 * Import guardrails flag descriptions
 */
const IMPORT_GUARDRAILS_FLAG_DESCRIPTIONS = {
  "--from": "[path]:Source path:_files",
  "--all": "Import all guardrails",
};

/**
 * Optimize prompts flag descriptions
 */
const OPTIMIZE_PROMPTS_FLAG_DESCRIPTIONS = {
  "--apply": "Apply optimizations",
  "--versions": "Show version history",
};

/**
 * PRD flag descriptions
 */
const PRD_FLAG_DESCRIPTIONS = {
  "--out": "[path]:Output path:_files",
};

/**
 * Plan flag descriptions
 */
const PLAN_FLAG_DESCRIPTIONS = {
  "--prd": "[PRD number]:PRD number:_ralph_prd_numbers",
};

/**
 * UI flag descriptions
 */
const UI_FLAG_DESCRIPTIONS = {
  "--open": "Open in browser",
};

/**
 * Completions flag descriptions
 */
const COMPLETIONS_FLAG_DESCRIPTIONS = {
  "--install": "Auto-install completions",
};

/**
 * Generate zsh _arguments spec from flag descriptions
 */
function generateFlagSpecs(flagDescriptions) {
  return Object.entries(flagDescriptions)
    .map(([flag, desc]) => {
      if (desc.startsWith("[")) {
        // Flag with argument
        return `'${flag}=${desc}'`;
      } else {
        // Boolean flag
        return `'${flag}[${desc}]'`;
      }
    })
    .join(" \\\n    ");
}

/**
 * Generate command completion entries with descriptions
 */
function generateCommandEntries() {
  return COMMANDS.map(
    (cmd) => `'${cmd}:${COMMAND_DESCRIPTIONS[cmd] || cmd}'`
  ).join(" \\\n      ");
}

/**
 * Generate subcommand entries with descriptions
 */
function generateSubcommandEntries(subcommands, descriptions) {
  return subcommands
    .map((cmd) => `'${cmd}:${descriptions[cmd] || cmd}'`)
    .join(" \\\n        ");
}

/**
 * Generate the complete zsh completion script
 * @returns {string} The zsh completion script
 */
function generate() {
  return `#compdef ralph
# Zsh completion for ralph CLI
# Generated by ralph completions zsh
#
# Installation:
#   ralph completions zsh > ~/.zfunc/_ralph
#   # Then add to .zshrc: fpath=(~/.zfunc $fpath) && autoload -Uz compinit && compinit
#
# Oh My Zsh:
#   ralph completions zsh > ~/.oh-my-zsh/completions/_ralph
#   # Completions load automatically

# Dynamic PRD number completion
_ralph_prd_numbers() {
  local -a prd_nums
  local ralph_dir=".ralph"

  if [[ -d "$ralph_dir" ]]; then
    prd_nums=(\${(f)"\$(for dir in $ralph_dir/PRD-*; do
      [[ -d "$dir" ]] && basename "$dir" | sed 's/PRD-//'
    done)"})
  fi

  _describe -t prd-numbers 'PRD number' prd_nums
}

# Dynamic worktree PRD completion
_ralph_worktree_prds() {
  local -a prd_nums
  local worktrees_dir=".ralph/worktrees"

  if [[ -d "$worktrees_dir" ]]; then
    prd_nums=(\${(f)"\$(for dir in $worktrees_dir/PRD-*; do
      [[ -d "$dir" ]] && basename "$dir" | sed 's/PRD-//'
    done)"})
  fi

  _describe -t prd-numbers 'PRD number' prd_nums
}

# Build command completion
_ralph_build() {
  _arguments -s \\
    ${generateFlagSpecs(BUILD_FLAG_DESCRIPTIONS)} \\
    '1:iterations:'
}

# Plan command completion
_ralph_plan() {
  _arguments -s \\
    ${generateFlagSpecs(PLAN_FLAG_DESCRIPTIONS)}
}

# PRD command completion
_ralph_prd() {
  _arguments -s \\
    ${generateFlagSpecs(PRD_FLAG_DESCRIPTIONS)}
}

# Stream command completion
_ralph_stream() {
  local -a stream_cmds
  stream_cmds=(
    ${generateSubcommandEntries(STREAM_SUBCOMMANDS, STREAM_DESCRIPTIONS)}
  )

  _arguments -s \\
    '1:subcommand:->subcmd' \\
    '*::args:->args'

  case "$state" in
    subcmd)
      _describe -t commands 'stream subcommand' stream_cmds
      ;;
    args)
      case "$words[1]" in
        init|build|merge|cleanup)
          _ralph_prd_numbers
          ;;
      esac
      ;;
  esac
}

# Registry command completion
_ralph_registry() {
  local -a registry_cmds
  registry_cmds=(
    ${generateSubcommandEntries(REGISTRY_SUBCOMMANDS, REGISTRY_DESCRIPTIONS)}
  )

  _arguments -s \\
    '1:subcommand:->subcmd' \\
    '*::args:->args'

  case "$state" in
    subcmd)
      _describe -t commands 'registry subcommand' registry_cmds
      ;;
  esac
}

# Import command completion
_ralph_import() {
  local -a import_cmds
  import_cmds=(
    ${generateSubcommandEntries(IMPORT_SUBCOMMANDS, IMPORT_DESCRIPTIONS)}
  )

  _arguments -s \\
    '1:subcommand:->subcmd' \\
    '*::args:->args'

  case "$state" in
    subcmd)
      _describe -t commands 'import subcommand' import_cmds
      ;;
    args)
      case "$words[1]" in
        guardrails)
          _arguments -s \\
            ${generateFlagSpecs(IMPORT_GUARDRAILS_FLAG_DESCRIPTIONS)}
          ;;
      esac
      ;;
  esac
}

# Optimize command completion
_ralph_optimize() {
  local -a optimize_cmds
  optimize_cmds=(
    ${generateSubcommandEntries(OPTIMIZE_SUBCOMMANDS, OPTIMIZE_DESCRIPTIONS)}
  )

  _arguments -s \\
    '1:subcommand:->subcmd' \\
    '*::args:->args'

  case "$state" in
    subcmd)
      _describe -t commands 'optimize subcommand' optimize_cmds
      ;;
    args)
      case "$words[1]" in
        prompts)
          _arguments -s \\
            ${generateFlagSpecs(OPTIMIZE_PROMPTS_FLAG_DESCRIPTIONS)}
          ;;
      esac
      ;;
  esac
}

# Estimate command completion
_ralph_estimate() {
  _arguments -s \\
    ${generateFlagSpecs(ESTIMATE_FLAG_DESCRIPTIONS)}
}

# Doctor command completion
_ralph_doctor() {
  _arguments -s \\
    ${generateFlagSpecs(DOCTOR_FLAG_DESCRIPTIONS)}
}

# Stats command completion
_ralph_stats() {
  _arguments -s \\
    ${generateFlagSpecs(STATS_FLAG_DESCRIPTIONS)}
}

# Search command completion
_ralph_search() {
  _arguments -s \\
    ${generateFlagSpecs(SEARCH_FLAG_DESCRIPTIONS)} \\
    '*:query:'
}

# Install command completion
_ralph_install() {
  _arguments -s \\
    ${generateFlagSpecs(INSTALL_FLAG_DESCRIPTIONS)}
}

# Diagnose command completion
_ralph_diagnose() {
  _arguments -s \\
    ${generateFlagSpecs(DIAGNOSE_FLAG_DESCRIPTIONS)}
}

# UI command completion
_ralph_ui() {
  _arguments -s \\
    ${generateFlagSpecs(UI_FLAG_DESCRIPTIONS)}
}

# Completions command completion
_ralph_completions() {
  _arguments -s \\
    ${generateFlagSpecs(COMPLETIONS_FLAG_DESCRIPTIONS)} \\
    '1:shell:(bash zsh fish)'
}

# Main completion function
_ralph() {
  local -a commands
  commands=(
    ${generateCommandEntries()}
  )

  _arguments -s \\
    '(- *)--help[Show help information]' \\
    '(- *)--version[Show version]' \\
    '1:command:->cmd' \\
    '*::args:->args'

  case "$state" in
    cmd)
      _describe -t commands 'ralph command' commands
      ;;
    args)
      case "$words[1]" in
        build)
          _ralph_build
          ;;
        plan)
          _ralph_plan
          ;;
        prd)
          _ralph_prd
          ;;
        stream)
          _ralph_stream
          ;;
        registry)
          _ralph_registry
          ;;
        import)
          _ralph_import
          ;;
        optimize)
          _ralph_optimize
          ;;
        estimate)
          _ralph_estimate
          ;;
        doctor)
          _ralph_doctor
          ;;
        stats)
          _ralph_stats
          ;;
        search)
          _ralph_search
          ;;
        install)
          _ralph_install
          ;;
        diagnose)
          _ralph_diagnose
          ;;
        ui)
          _ralph_ui
          ;;
        completions)
          _ralph_completions
          ;;
      esac
      ;;
  esac
}

# Register the completion function
_ralph "$@"
`;
}

module.exports = {
  generate,
  COMMAND_DESCRIPTIONS,
  STREAM_DESCRIPTIONS,
  REGISTRY_DESCRIPTIONS,
  IMPORT_DESCRIPTIONS,
  OPTIMIZE_DESCRIPTIONS,
};
