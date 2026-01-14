/**
 * Shell completions module for ralph CLI
 *
 * Provides:
 * - Shell detection (bash, zsh, fish)
 * - Completion script generation for all supported shells
 * - Auto-installation to appropriate shell config locations
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const bash = require("./bash");
const zsh = require("./zsh");
const fish = require("./fish");

/**
 * Supported shell types
 */
const SHELLS = ["bash", "zsh", "fish"];

/**
 * Detect the current shell type from environment
 * @returns {string|null} Shell type ('bash', 'zsh', 'fish') or null if unknown
 */
function detectShell() {
  const shell = process.env.SHELL || "";
  const shellName = path.basename(shell);

  if (shellName === "bash") return "bash";
  if (shellName === "zsh") return "zsh";
  if (shellName === "fish") return "fish";

  // Fallback: check FISH_VERSION for fish shells that don't set $SHELL
  if (process.env.FISH_VERSION) return "fish";

  // Fallback: check ZSH_VERSION for zsh shells
  if (process.env.ZSH_VERSION) return "zsh";

  // Fallback: check BASH_VERSION for bash shells
  if (process.env.BASH_VERSION) return "bash";

  return null;
}

/**
 * Generate completion script for specified shell
 * @param {string} shell - Shell type ('bash', 'zsh', 'fish')
 * @returns {string} The completion script content
 * @throws {Error} If shell type is not supported
 */
function generate(shell) {
  switch (shell) {
    case "bash":
      return bash.generate();
    case "zsh":
      return zsh.generate();
    case "fish":
      return fish.generate();
    default:
      throw new Error(`Unsupported shell: ${shell}. Supported: ${SHELLS.join(", ")}`);
  }
}

/**
 * Get the default installation path for a shell's completion script
 * @param {string} shell - Shell type
 * @returns {Object} Object with { path, instructions, needsSourceLine }
 */
function getInstallPath(shell) {
  const home = os.homedir();

  switch (shell) {
    case "bash": {
      // Prefer XDG location if it exists, otherwise ~/.bash_completion.d
      const xdgPath = path.join(home, ".local", "share", "bash-completion", "completions", "ralph");
      const xdgDir = path.dirname(xdgPath);
      const legacyDir = path.join(home, ".bash_completion.d");
      const legacyPath = path.join(legacyDir, "ralph");

      // Check if XDG directory exists or can be created
      if (fs.existsSync(xdgDir)) {
        return {
          path: xdgPath,
          instructions: `Completions installed to ${xdgPath}\nRestart your shell or run: source ${xdgPath}`,
          needsSourceLine: false,
        };
      }

      // Check if legacy directory exists
      if (fs.existsSync(legacyDir)) {
        return {
          path: legacyPath,
          instructions: `Completions installed to ${legacyPath}\nRestart your shell or run: source ${legacyPath}`,
          needsSourceLine: false,
        };
      }

      // Default to XDG path but note we'll create the directory
      return {
        path: xdgPath,
        instructions: `Completions installed to ${xdgPath}\nRestart your shell or run: source ${xdgPath}`,
        needsSourceLine: false,
        createDir: true,
      };
    }

    case "zsh": {
      // Check for Oh My Zsh first
      const omzPath = path.join(home, ".oh-my-zsh", "completions", "_ralph");
      const omzDir = path.dirname(omzPath);
      if (fs.existsSync(omzDir)) {
        return {
          path: omzPath,
          instructions: `Completions installed to ${omzPath}\nRestart your shell to activate.`,
          needsSourceLine: false,
        };
      }

      // Standard zsh completions directory
      const zfuncDir = path.join(home, ".zfunc");
      const zfuncPath = path.join(zfuncDir, "_ralph");
      return {
        path: zfuncPath,
        instructions: `Completions installed to ${zfuncPath}\n\nTo activate, add to your ~/.zshrc (if not already present):\n  fpath=(~/.zfunc $fpath)\n  autoload -Uz compinit && compinit\n\nThen restart your shell.`,
        needsSourceLine: false,
        createDir: true,
        postInstallNote: "You may need to add ~/.zfunc to your fpath in ~/.zshrc",
      };
    }

    case "fish": {
      const fishPath = path.join(home, ".config", "fish", "completions", "ralph.fish");
      const fishDir = path.dirname(fishPath);
      return {
        path: fishPath,
        instructions: `Completions installed to ${fishPath}\nRestart your shell to activate.`,
        needsSourceLine: false,
        createDir: !fs.existsSync(fishDir),
      };
    }

    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * Install completion script for specified shell
 * @param {string} shell - Shell type
 * @returns {Object} Result with { success, path, message }
 */
function install(shell) {
  try {
    const script = generate(shell);
    const installInfo = getInstallPath(shell);

    // Create directory if needed
    const dir = path.dirname(installInfo.path);
    if (installInfo.createDir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write the completion script
    fs.writeFileSync(installInfo.path, script, "utf8");

    return {
      success: true,
      path: installInfo.path,
      message: installInfo.instructions,
      postInstallNote: installInfo.postInstallNote || null,
    };
  } catch (err) {
    return {
      success: false,
      path: null,
      message: `Failed to install completions: ${err.message}`,
    };
  }
}

/**
 * Get install instructions for manual setup (without auto-install)
 * @param {string} shell - Shell type
 * @returns {string} Manual installation instructions
 */
function getManualInstructions(shell) {
  switch (shell) {
    case "bash":
      return `# Bash completion installation:
# Option 1: XDG compliant (recommended)
ralph completions bash > ~/.local/share/bash-completion/completions/ralph

# Option 2: Direct to bashrc
ralph completions bash >> ~/.bashrc && source ~/.bashrc

# Option 3: Completion directory
mkdir -p ~/.bash_completion.d
ralph completions bash > ~/.bash_completion.d/ralph
echo 'source ~/.bash_completion.d/ralph' >> ~/.bashrc`;

    case "zsh":
      return `# Zsh completion installation:
# Option 1: Oh My Zsh (if installed)
ralph completions zsh > ~/.oh-my-zsh/completions/_ralph

# Option 2: Standard zsh
mkdir -p ~/.zfunc
ralph completions zsh > ~/.zfunc/_ralph
# Add to ~/.zshrc: fpath=(~/.zfunc $fpath)
# Then run: autoload -Uz compinit && compinit`;

    case "fish":
      return `# Fish completion installation:
ralph completions fish > ~/.config/fish/completions/ralph.fish`;

    default:
      return `Unknown shell: ${shell}. Supported shells: bash, zsh, fish`;
  }
}

module.exports = {
  SHELLS,
  detectShell,
  generate,
  getInstallPath,
  install,
  getManualInstructions,
  // Re-export generators for direct access
  bash,
  zsh,
  fish,
};
