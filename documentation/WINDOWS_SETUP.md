# Windows Setup Guide

This guide covers installing and running Ralph CLI on Windows.

## Prerequisites

Ralph CLI requires:
- **Node.js 18+** - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/download/win)
- **Bash shell** - Required for script execution (see options below)
- **An AI agent** - Claude Code, Codex, or Droid

## Bash Shell Options

Ralph's execution engine uses bash scripts. Choose one of these options:

### Option A: WSL 2 (Recommended)

Windows Subsystem for Linux provides the best compatibility.

**Install WSL 2:**
```powershell
# Run in PowerShell as Administrator
wsl --install
```

**After installation:**
1. Restart your computer
2. Ubuntu will install automatically on first boot
3. Create a username and password when prompted
4. Run Ralph commands inside the WSL terminal

**Using Ralph with WSL:**
```bash
# Open WSL terminal, then:
cd /mnt/c/Users/YourName/Projects/your-project
ralph build 5
```

### Option B: Git Bash

Git for Windows includes Git Bash, a lighter-weight option.

**Install Git for Windows:**
1. Download from https://git-scm.com/download/win
2. During installation, select:
   - "Use Git and optional Unix tools from the Command Prompt"
   - "Use Windows' default console window" or "Use MinTTY"
3. Complete installation

**Using Ralph with Git Bash:**
1. Open Git Bash from Start Menu
2. Navigate to your project: `cd /c/Users/YourName/Projects/your-project`
3. Run Ralph commands: `ralph build 5`

### Option C: Windows Terminal + Git Bash

For the best terminal experience on Windows:

1. Install Windows Terminal from Microsoft Store
2. Install Git for Windows (Option B above)
3. Open Windows Terminal Settings
4. Add a new profile for Git Bash:
   ```json
   {
     "name": "Git Bash",
     "commandline": "C:\\Program Files\\Git\\bin\\bash.exe --login -i",
     "icon": "C:\\Program Files\\Git\\mingw64\\share\\git\\git-for-windows.ico",
     "startingDirectory": "%USERPROFILE%"
   }
   ```

## Installation

### Step 1: Install Ralph CLI

```bash
# In Git Bash or WSL terminal
git clone https://github.com/AskTinNguyen/ralph-cli.git
cd ralph-cli
npm install && npm link
```

### Step 2: Verify Installation

```bash
ralph --help
ralph doctor
```

### Step 3: Install to Your Project

```bash
cd /path/to/your-project
ralph install
```

## Installing AI Agents on Windows

### Claude Code

```bash
# In Git Bash or WSL
curl -fsSL https://claude.ai/install.sh | bash
```

Or download the installer from https://claude.ai/download

### Codex

```bash
npm install -g @openai/codex
```

### Droid

```bash
curl -fsSL https://app.factory.ai/cli | sh
```

## Common Issues

### "bash is not recognized"

**Cause:** Running from CMD.exe or PowerShell without bash in PATH.

**Solutions:**
1. Run commands from Git Bash terminal instead
2. Or add Git Bash to PATH: `C:\Program Files\Git\bin`
3. Or use WSL terminal

### "ENOENT: no such file or directory"

**Cause:** Path separator issues or file not found.

**Solutions:**
1. Use forward slashes in paths: `/c/Users/...` not `C:\Users\...`
2. Ensure you're in the correct directory
3. Run `ralph doctor` to check setup

### Colors Not Displaying

**Cause:** ANSI escape codes not supported in CMD.exe.

**Solutions:**
1. Use Git Bash or Windows Terminal
2. Or set environment variable: `FORCE_COLOR=1`

### "flock: command not found"

**Cause:** `flock` is Linux-specific, not available in Git Bash.

**Impact:** Concurrent stream builds may have race conditions.

**Solutions:**
1. Use WSL for full compatibility
2. Or run one build at a time (avoid `ralph stream build 1 & ralph stream build 2 &`)

### "sed: invalid option"

**Cause:** Git Bash uses MinGW sed which has different options than GNU sed.

**Solutions:**
1. Use WSL for full GNU tool compatibility
2. Most Ralph operations work fine, but some edge cases may fail

### Permission Denied Errors

**Cause:** Windows file locking or antivirus interference.

**Solutions:**
1. Run terminal as Administrator
2. Add project folder to antivirus exclusions
3. Close other programs that might lock files

## Environment Variables

Set these in your shell profile (`~/.bashrc` for Git Bash or `~/.bashrc` for WSL):

```bash
# Optional: Set default agent
export DEFAULT_AGENT=claude

# Optional: GitHub token for MCP integrations
export GITHUB_TOKEN=your_token_here

# Optional: Notion integration
export NOTION_API_KEY=your_key_here
```

## Path Considerations

| Terminal | Project Path Format |
|----------|-------------------|
| Git Bash | `/c/Users/Name/Projects/myapp` |
| WSL | `/mnt/c/Users/Name/Projects/myapp` |
| CMD/PowerShell | `C:\Users\Name\Projects\myapp` |

**Tip:** Keep your projects in a path without spaces to avoid issues.

## Performance Tips

1. **Use WSL 2** for best performance with file-heavy operations
2. **Store projects in WSL filesystem** (`~/projects/`) rather than `/mnt/c/` for faster I/O
3. **Exclude node_modules** from Windows Defender real-time scanning
4. **Use SSD storage** for project directories

## Verifying Your Setup

Run these commands to verify everything is working:

```bash
# Check Ralph installation
ralph --version

# Run diagnostics
ralph doctor

# Test basic functionality
cd your-project
ralph install
ralph help
```

Expected output from `ralph doctor`:
```
Ralph Doctor
============
✓ Node.js 20.x
✓ Git 2.x
✓ Bash available
✓ AI agent (claude) found
✓ Templates installed
```

## Getting Help

- **GitHub Issues:** https://github.com/AskTinNguyen/ralph-cli/issues
- **Documentation:** https://asktinnguyen.github.io/ralph-cli/
- **Discord:** (if available)

When reporting Windows-specific issues, please include:
- Windows version (`winver`)
- Terminal used (Git Bash, WSL, etc.)
- Output of `ralph doctor`
- Full error message
