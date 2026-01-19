# ralph-cli

> Autonomous coding agent loop. Define what you want built, walk away, return to committed, working code.

I want you to install Ralph CLI for me. Execute all the steps below autonomously.

## OBJECTIVE

Install Ralph CLI globally and configure it in the current project so the user can run autonomous build iterations with `ralph build`.

## DONE WHEN

- `ralph --version` outputs a version number
- `ralph install` has been run in the target project
- `.agents/ralph/` directory exists in the project
- Running `ralph doctor` shows all checks passing

## TODO

- [ ] Check prerequisites (Node.js 18+, Git, AI agent CLI)
- [ ] Install Ralph CLI globally
- [ ] Navigate to the target project
- [ ] Run `ralph install` to set up project templates
- [ ] Verify installation with `ralph doctor`

## DETAILED STEPS

### Step 1: Verify Prerequisites

You need Node.js 18+ and Git installed. Check with:

```bash
node --version   # Must be v18.0.0 or higher
git --version    # Any recent version
```

You also need at least one AI agent CLI installed. Check for any of these:

```bash
claude --version    # Claude Code (recommended)
codex --version     # OpenAI Codex
droid --version     # Factory.ai Droid
```

If Claude Code is missing, install it:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

### Step 2: Install Ralph CLI

**Option A: One-Command Install (Recommended)**

macOS/Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.sh | bash
```

Windows PowerShell:
```powershell
iwr -useb https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.ps1 | iex
```

**Option B: Manual Install**

```bash
git clone https://github.com/AskTinNguyen/ralph-cli.git
cd ralph-cli
npm install && npm link
```

### Step 3: Verify Global Installation

```bash
ralph --version
```

This must output a version number. If the command is not found, ensure `~/.npm-global/bin` is in your PATH.

### Step 4: Initialize Ralph in Your Project

Navigate to your target project and run:

```bash
cd /path/to/your/project
ralph install
```

This creates the `.agents/ralph/` directory with customizable templates and loop configuration.

When prompted about skills, select the ones you need (commit, dev-browser, prd) or skip for a minimal setup.

### Step 5: Verify Project Setup

Run the health check:

```bash
ralph doctor
```

All checks should pass. If any fail, address the reported issues.

### Step 6: Quick Test (Optional)

Test that Ralph works by running a dry build:

```bash
ralph prd "Add a hello world endpoint"  # Generate a simple PRD
ralph plan                               # Create implementation plan
ralph build 1 --no-commit                # Dry run (no git commits)
```

## SUCCESS VERIFICATION

Run these commands to confirm installation is complete:

```bash
ralph --version          # Should output version
ls .agents/ralph/        # Should list: loop.sh, config.sh, PROMPT_*.md
ralph doctor             # All checks should pass
```

## TROUBLESHOOTING

If you encounter issues, consult the full documentation:

- **Agent Guide**: See `CLAUDE.md` in the repository
- **Web Docs**: Start UI with `cd ui && npm run dev`, then visit http://localhost:3000/docs/

Common issues:
- **Command not found**: Add npm global bin to PATH (`export PATH="$HOME/.npm-global/bin:$PATH"`)
- **Permission denied**: Use `sudo npm link` or configure npm for global installs without sudo
- **Agent not found**: Install Claude Code, Codex, or Droid before running builds

---

**EXECUTE NOW**: Complete the above TODO list to achieve: `ralph --version` outputs a version, `ralph doctor` passes, and `.agents/ralph/` exists in the project.

---

For additional context and full documentation, see: https://github.com/AskTinNguyen/ralph-cli/blob/main/CLAUDE.md
