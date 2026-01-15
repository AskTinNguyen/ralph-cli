# Windows Installation Improvements Proposal

This document outlines proposed improvements to make Ralph CLI installation and usage easier for Windows users.

## Current State Analysis

### What Works
- `npm install && npm link` - Works natively on Windows
- `ralph install` - Node.js file operations work correctly
- Path handling in JavaScript uses `path.join()` - Cross-platform compatible
- Entry point (`bin/ralph`) already detects Windows at line 15

### Critical Issues

| Issue | Impact | Severity |
|-------|--------|----------|
| All execution logic is in bash scripts | Commands like `build`, `plan`, `prd`, `stream` fail without bash | **Critical** |
| No Windows setup documentation | Users don't know prerequisites | **High** |
| Unix-specific commands in scripts | `ps`, `pkill`, `sed`, `grep`, `flock` unavailable | **High** |
| No Windows CI testing | Bugs won't be caught | **Medium** |
| Hardcoded `/tmp/` paths | Temp file operations fail | **Medium** |
| ANSI color codes | Display issues in CMD.exe | **Low** |

---

## Proposed Improvements

### Phase 1: Documentation & Prerequisites (Quick Wins)

**1.1 Add Windows Prerequisites Section to README.md**

```markdown
### Windows Prerequisites

Ralph CLI requires a bash shell on Windows. Choose one option:

**Option A: WSL 2 (Recommended)**
- Best compatibility with Unix tools
- Install: `wsl --install` in PowerShell (Admin)
- Run Ralph commands inside WSL terminal

**Option B: Git Bash**
- Lighter weight, comes with Git for Windows
- Install: https://git-scm.com/download/win
- Run Ralph commands from Git Bash terminal

**Option C: Windows Terminal + Git Bash**
- Modern terminal experience
- Install Windows Terminal from Microsoft Store
- Add Git Bash as a profile
```

**1.2 Create `documentation/WINDOWS_SETUP.md`**

Detailed setup guide covering:
- WSL 2 installation and configuration
- Git Bash setup and PATH configuration
- Claude Code / Codex / Droid installation on Windows
- Common issues and solutions
- Environment variable setup

**1.3 Add Windows Troubleshooting Section**

```markdown
### Windows Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `'bash' is not recognized` | Bash not in PATH | Install Git Bash or WSL |
| `ENOENT: no such file or directory` | Path separator issues | Use Git Bash, not CMD |
| Colors not displaying | ANSI not supported | Use Windows Terminal or Git Bash |
| `flock: command not found` | Missing util-linux | Use WSL or skip concurrent builds |
```

---

### Phase 2: Graceful Fallbacks (Medium Effort)

**2.1 Add Bash Availability Check**

Update `bin/ralph` to check for bash before running scripts:

```javascript
// Add to bin/ralph after line 19
function checkBashAvailable() {
  if (process.platform !== "win32") return true;

  try {
    const result = spawnSync("bash", ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

// Before spawning bash scripts
if (!checkBashAvailable()) {
  error("Bash shell not found. Ralph requires bash to run.");
  console.log("");
  info("Windows setup options:");
  console.log("  1. Install Git for Windows: https://git-scm.com/download/win");
  console.log("  2. Install WSL 2: wsl --install (in PowerShell Admin)");
  console.log("");
  info(`See: ${pc.cyan("https://github.com/AskTinNguyen/ralph-cli/blob/main/documentation/WINDOWS_SETUP.md")}`);
  process.exit(1);
}
```

**2.2 Add `ralph doctor` Windows Checks**

Extend the doctor command to verify Windows requirements:

```javascript
// In lib/commands/doctor.js
if (process.platform === "win32") {
  checks.push({
    name: "Bash shell",
    check: () => {
      const result = spawnSync("bash", ["--version"]);
      return result.status === 0;
    },
    fix: "Install Git for Windows or WSL 2",
  });

  checks.push({
    name: "Git Bash PATH",
    check: () => process.env.PATH?.includes("Git\\bin"),
    fix: "Add Git Bash to PATH: C:\\Program Files\\Git\\bin",
  });
}
```

**2.3 Fix Temp Directory Paths**

Replace hardcoded `/tmp/` with cross-platform equivalent:

```bash
# In shell scripts, replace:
# TEMP_FILE="/tmp/ralph-$$"
# With:
TEMP_FILE="${TMPDIR:-${TMP:-/tmp}}/ralph-$$"
```

Or better, use Node.js for temp file creation and pass paths to scripts.

---

### Phase 3: Windows CI Testing (Medium Effort)

**3.1 Add Windows to GitHub Actions**

Update `.github/workflows/ci.yml`:

```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node-version: [18, 20, 22]

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}

      # Windows-specific: Install Git Bash
      - name: Setup Git Bash (Windows)
        if: runner.os == 'Windows'
        run: |
          # Git Bash comes with GitHub Actions Windows runners
          echo "C:\Program Files\Git\bin" >> $GITHUB_PATH
        shell: bash

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test
        shell: bash
```

**3.2 Create Windows-Specific Test Suite**

```javascript
// tests/windows-compat.mjs
import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "child_process";
import path from "path";
import os from "os";

describe("Windows Compatibility", { skip: process.platform !== "win32" }, () => {
  it("should detect bash availability", () => {
    const result = spawnSync("bash", ["--version"]);
    assert.strictEqual(result.status, 0, "Bash should be available");
  });

  it("should handle Windows paths correctly", () => {
    const testPath = path.join(os.tmpdir(), "ralph-test");
    assert.ok(!testPath.includes("/") || testPath.includes("\\"));
  });

  it("should run ralph help without bash", () => {
    const result = spawnSync("node", ["bin/ralph", "help"]);
    assert.strictEqual(result.status, 0);
  });
});
```

---

### Phase 4: PowerShell Alternative (Higher Effort)

**4.1 Create PowerShell Wrapper for Core Functions**

For users who can't install bash, provide PowerShell alternatives for basic operations:

```powershell
# .agents/ralph/loop.ps1
param(
    [string]$Command = "build",
    [int]$Iterations = 1
)

$ErrorActionPreference = "Stop"
$RalphDir = Join-Path $PWD ".ralph"

function Get-NextStory {
    # Read plan.md and find next unchecked story
    $plan = Get-Content (Join-Path $RalphDir "plan.md") -Raw
    if ($plan -match '\[ \] (US-\d+)') {
        return $matches[1]
    }
    return $null
}

# ... rest of loop implementation
```

**4.2 Hybrid Approach: Node.js Core with Optional Bash**

Rewrite critical functions in Node.js that can fall back:

```javascript
// lib/loop-core.js
class RalphLoop {
  constructor(options) {
    this.cwd = options.cwd;
    this.ralphDir = path.join(this.cwd, ".ralph");
    this.hasBash = this.checkBash();
  }

  async runIteration() {
    if (this.hasBash) {
      return this.runBashLoop();
    }
    return this.runNodeLoop();
  }

  async runNodeLoop() {
    // Pure Node.js implementation
    const story = await this.getNextStory();
    if (!story) return { done: true };

    await this.executeStory(story);
    await this.markComplete(story);
    await this.commitChanges(story);

    return { done: false, story };
  }
}
```

---

### Phase 5: Native Windows Support (Long-term)

**5.1 Rewrite Shell Scripts in Node.js**

The ultimate solution is rewriting bash scripts as Node.js modules:

| Current File | Node.js Equivalent | Priority |
|--------------|-------------------|----------|
| `loop.sh` | `lib/loop.js` | High |
| `stream.sh` | `lib/stream.js` | High |
| `atomic-write.sh` | `lib/atomic.js` | Medium |
| `output.sh` | Already uses `picocolors` | Done |
| `test-ui.sh` | `lib/test-ui.js` | Low |

**5.2 Use Cross-Platform Alternatives**

| Unix Command | Cross-Platform Alternative |
|--------------|---------------------------|
| `grep` | Node.js `fs.readFileSync` + regex |
| `sed` | Node.js string replace |
| `ps aux` | `ps-list` npm package |
| `pkill` | `tree-kill` npm package |
| `flock` | `proper-lockfile` npm package |
| `mktemp` | `os.tmpdir()` + `crypto.randomUUID()` |
| `date +%s` | `Date.now() / 1000` |

**5.3 Suggested Package Additions**

```json
{
  "dependencies": {
    "proper-lockfile": "^4.1.2",
    "ps-list": "^8.1.0",
    "tree-kill": "^1.2.2",
    "cross-spawn": "^7.0.3"
  }
}
```

---

## Implementation Priority

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Phase 1: Documentation | Low | High | **P0 - Do First** |
| Phase 2: Graceful Fallbacks | Medium | High | **P1 - Soon** |
| Phase 3: Windows CI | Medium | Medium | **P1 - Soon** |
| Phase 4: PowerShell Alternative | High | Medium | P2 - Nice to Have |
| Phase 5: Native Node.js | Very High | Very High | P3 - Long-term |

---

## Quick Start: Minimum Viable Windows Support

To get Windows users running quickly, implement these changes:

1. **README.md** - Add Windows prerequisites section (30 min)
2. **bin/ralph** - Add bash check with helpful error (1 hour)
3. **lib/commands/doctor.js** - Add Windows checks (1 hour)
4. **CI workflow** - Add Windows runner (30 min)

Total estimated effort: ~3 hours for basic Windows support with clear error messages and documentation.

---

## Appendix: Windows User Journey (Current vs Improved)

### Current Experience
```
User: npm install && npm link
→ Success

User: ralph install
→ Success

User: ralph build 5
→ Error: 'bash' is not recognized as an internal or external command
→ User confused, no guidance
```

### Improved Experience
```
User: npm install && npm link
→ Success

User: ralph doctor
→ ✓ Node.js 20.x
→ ✓ Git installed
→ ✗ Bash not found
→   Fix: Install Git for Windows or WSL 2
→   See: documentation/WINDOWS_SETUP.md

User: ralph build 5 (without bash)
→ Error: Bash shell required
→
→ Windows setup options:
→   1. Install Git for Windows: https://git-scm.com/download/win
→   2. Install WSL 2: wsl --install (in PowerShell Admin)
→
→ After installing, run from Git Bash or WSL terminal.
→ See: https://github.com/AskTinNguyen/ralph-cli/blob/main/documentation/WINDOWS_SETUP.md
```
