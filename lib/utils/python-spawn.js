/**
 * Cross-platform Python spawn utilities for Node.js
 * Detects and spawns Python across Windows, Mac, and Linux
 */

const { spawnSync } = require('child_process');
const os = require('os');

// Cached Python command (detect once per process)
let _pythonCmd = null;

/**
 * Detect available Python command on the system
 * @returns {string|null} Python command ('python3', 'python', 'py') or null if not found
 */
function getPythonCommand() {
  // Return cached result if already detected
  if (_pythonCmd !== null) return _pythonCmd;

  const platform = os.platform();

  // Platform-specific candidate order
  // Windows: try 'python' first (standard), then 'python3', then 'py' launcher
  // Unix/Mac: try 'python3' first (standard), then 'python'
  const candidates = platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  // Try each candidate and return first working command
  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['--version'], {
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 5000 // 5 second timeout
      });

      // Check if command executed successfully
      if (result.status === 0) {
        // Verify it's Python 3.x
        const output = result.stdout || result.stderr || '';
        if (output.match(/Python 3\.\d+/)) {
          _pythonCmd = cmd;
          return cmd;
        }
      }
    } catch (e) {
      // Command not found or execution error, try next candidate
      continue;
    }
  }

  // No Python found
  _pythonCmd = false;
  return null;
}

/**
 * Spawn Python process with arguments
 * @param {string[]} args - Arguments to pass to Python
 * @param {object} options - spawn options (encoding, stdio, etc.)
 * @returns {object} spawnSync result
 * @throws {Error} If Python not found
 */
function spawnPython(args, options = {}) {
  const pythonCmd = getPythonCommand();

  if (!pythonCmd) {
    const platform = os.platform();
    let installMsg = '';

    if (platform === 'win32') {
      installMsg = 'Windows: Download from https://www.python.org/downloads/ and CHECK "Add to PATH"';
    } else if (platform === 'darwin') {
      installMsg = 'Mac: Run `brew install python3` or download from https://www.python.org/downloads/';
    } else {
      installMsg = 'Linux: Run `sudo apt install python3` or `sudo yum install python3`';
    }

    const err = new Error(
      `Python 3.8+ required but not found.\n\n` +
      `${installMsg}\n\n` +
      `After installation, verify with: python --version or python3 --version\n` +
      `For help: https://github.com/AskTinNguyen/ralph-cli#prerequisites`
    );
    err.code = 'EPYTHON_NOT_FOUND';
    throw err;
  }

  // Handle 'py -3' (Windows launcher with space)
  const cmdParts = pythonCmd.split(' ');
  const cmd = cmdParts[0];
  const extraArgs = cmdParts.slice(1);

  // Spawn Python with combined args
  return spawnSync(cmd, [...extraArgs, ...args], options);
}

/**
 * Check if Python is available
 * @returns {boolean} true if Python found, false otherwise
 */
function isPythonAvailable() {
  return getPythonCommand() !== null;
}

module.exports = {
  getPythonCommand,
  spawnPython,
  isPythonAvailable,
  // Legacy compatibility
  get PYTHON_CMD() {
    return getPythonCommand();
  }
};
