# Ralph CLI - Interactive Onboarding

## Overview

Ralph CLI includes an interactive onboarding experience that helps new users learn about features and workflows through an intuitive terminal-based tutorial.

## When It Appears

The onboarding experience is triggered in two ways:

### 1. Automatic (after installation)

When you run `ralph install` for the first time, you'll see:

```bash
ralph install

# ... installation steps ...

Welcome to Ralph CLI! 🎉

? Would you like a quick interactive tour? (Y/n)
```

### 2. Manual (anytime)

Launch the onboarding tutorial whenever you want:

```bash
ralph init --tour
```

## Features

### Interactive Menu

Choose what you want to learn:

```
? What would you like to learn about?
  ❯ 📋 Overview - What is Ralph?
    🔄 Workflow - PRD → Plan → Build
    📝 PRD Generation
    🗺️  Planning
    🔨 Build Loops
    🖥️  UI Dashboard
    🚀 Try a Demo
    ✅ I'm ready to start!
```

### Comprehensive Lessons

Each topic includes:
- **Clear explanations** of what the feature does
- **Example commands** with syntax highlighting
- **Best practices** for effective use
- **When to use it** guidance

### Hands-On Demo

Try creating a real PRD:
- Creates a sample "Todo List" PRD
- Shows the generated files
- Explains next steps

### Smart Navigation

- **Skip anytime**: Press Ctrl+C to exit
- **Choose your path**: Learn only what you need
- **Replay anytime**: Run `ralph init --tour`

## Topics Covered

### 1. Overview

**What you learn:**
- What Ralph CLI is
- Why use it
- Key features

**Key takeaway:** Ralph is an autonomous coding loop that helps you build features faster with AI agents.

---

### 2. Workflow

**What you learn:**
- The three-step process: PRD → Plan → Build
- How each step connects
- What artifacts are created

**Example flow:**
```bash
ralph prd "Feature description"  # Create PRD
ralph plan                       # Generate plan
ralph build 5                    # Execute 5 iterations
```

---

### 3. PRD Generation

**What you learn:**
- What a PRD is
- How to create one
- What Ralph generates
- Best practices

**Key command:**
```bash
ralph prd "Build a dashboard with charts and filters"
```

**Output:** `.ralph/PRD-N/prd.md` with structured requirements

---

### 4. Planning

**What you learn:**
- How Ralph breaks PRDs into stories
- Story format and structure
- Acceptance criteria
- How to review plans

**Key command:**
```bash
ralph plan          # Use latest PRD
ralph plan --prd=1  # Plan specific PRD
```

**Output:** `.ralph/PRD-N/plan.md` with ordered stories

---

### 5. Build Loops

**What you learn:**
- How autonomous builds work
- What happens in each iteration
- Advanced flags and options
- Parallel execution

**Key command:**
```bash
ralph build 5           # Run 5 iterations
ralph build 10 --prd=1  # Build specific PRD
```

**What happens:**
1. Agent reads plan
2. Implements next story
3. Tests changes
4. Commits to git
5. Marks story complete
6. Repeats

---

### 6. UI Dashboard

**What you learn:**
- Web dashboard features
- How to start the UI
- What you can monitor
- Interactive editing

**Key commands:**
```bash
ralph ui           # Start server
ralph ui --open    # Start and open browser
ralph gui          # Alias for above
```

**Access:** http://localhost:3000

**Demo option:** Launch UI server directly from tutorial (if deps installed)

---

### 7. Try a Demo

**What happens:**
- Creates a sample "Todo List" PRD
- Shows generated PRD file
- Explains next steps

**Why useful:**
- See Ralph in action
- Practice workflow
- Get comfortable with commands

**Note:** Demo PRD can be deleted after practice

---

## Completion

After completing the tour, you'll see:

```
┌  Next Steps
│
│  You're all set! Here's what to do next:
│
│  1. Create your first PRD
│     ralph prd "Your feature description"
│
│  2. Review the documentation
│     CLAUDE.md - Comprehensive guide
│     ralph help - Command reference
│
│  3. Join the community
│     https://github.com/AskTinNguyen/ralph-cli
│
│  4. Explore advanced features
│     • Parallel execution with worktrees
│     • Model routing for cost optimization
│     • Factory mode for complex workflows
│     • Voice notifications (auto-speak)
│
│  Run ralph init --tour anytime to replay this tutorial.
│
└
```

## Skipping the Tour

If you prefer to skip the onboarding:

### During Installation

```
? Would you like a quick interactive tour? (Y/n)
→ Press N
```

You'll see quick start commands instead:

```
┌  Ralph CLI Ready
│
│  Quick Start:
│    ralph prd           # Generate a PRD
│    ralph plan          # Create implementation plan
│    ralph build 5       # Run 5 build iterations
│
│  Documentation:
│    ralph help          # Show all commands
│    CLAUDE.md           # Full documentation
│
│  Happy building!
│
└
```

### Running the Tour Later

You can always run the tour manually:

```bash
ralph init --tour
```

## Benefits

### For New Users

- **Guided learning**: Step-by-step introduction to features
- **Interactive**: Choose your own learning path
- **Practical**: Try real commands and see results
- **Confidence**: Understand how Ralph works before diving in

### For Experienced Users

- **Quick reference**: Refresh your memory on commands
- **Discover features**: Learn about features you haven't tried
- **Share knowledge**: Easy way to onboard team members

## Technical Details

### Implementation

- Built with **@clack/prompts** for beautiful terminal UI
- Modular design in `lib/onboarding.js`
- Integrated into `ralph install` and `ralph init --tour`

### Requirements

- Interactive terminal (TTY)
- Node.js 18+
- Ralph CLI installed

### Non-Interactive Mode

The onboarding automatically skips in non-interactive environments:
- CI/CD pipelines
- Scripted installations
- When stdin is not a TTY

## Customization

### For Maintainers

To modify onboarding content:

1. Edit `lib/onboarding.js`
2. Update lesson functions:
   - `showOverview()`
   - `showWorkflow()`
   - `showPRDLesson()`
   - `showPlanLesson()`
   - `showBuildLesson()`
   - `showUILesson()`

3. Test changes:
```bash
ralph init --tour
```

### Adding New Lessons

To add a new lesson:

1. Create a new function in `lib/onboarding.js`:
```javascript
async function showNewLesson() {
  const { note } = await import("@clack/prompts");

  note(
    [
      `${pc.bold("Lesson Title")}`,
      "",
      "Lesson content here...",
    ].join("\n"),
    "Lesson Name"
  );

  await pressEnterToContinue();
}
```

2. Add menu option in `runOnboarding()`:
```javascript
{
  value: "new-lesson",
  label: "🎯 New Feature",
  hint: "Learn about new feature"
}
```

3. Add case in switch statement:
```javascript
case "new-lesson":
  await showNewLesson();
  break;
```

## Troubleshooting

### Prompts Don't Appear

**Symptoms:**
- No interactive menu
- Commands run but no prompts

**Solutions:**
1. Verify interactive terminal: `tty`
2. Check @clack/prompts: `npm list @clack/prompts`
3. Try explicit TTY: `script -q /dev/null ralph init --tour`

### Demo Fails

**Symptoms:**
- Sample PRD creation fails
- Error during demo

**Solutions:**
1. Verify ralph works: `ralph --version`
2. Check agent config: `.agents/ralph/config.sh`
3. Ensure git initialized: `git status`

### UI Demo Doesn't Launch

**Symptoms:**
- UI demo option fails
- Server doesn't start

**Solutions:**
1. Check UI deps: `ls <ralph-cli>/ui/node_modules`
2. Install manually: `cd <ralph-cli>/ui && npm install`
3. Try standalone: `ralph ui`

## Feedback

We'd love to hear about your onboarding experience!

- **GitHub Issues**: Report bugs or suggest improvements
- **Discussions**: Share feedback and ideas
- **Pull Requests**: Contribute enhancements

## Related Documentation

- [Installation Guide](../CLAUDE.md#quick-reference) - Getting started
- [Tutorial](../docs/guides/testing/TESTING.md) - Comprehensive tutorial
- [Command Reference](../CLAUDE.md) - Full command documentation
- [FAQ](../FAQ.md) - Common questions

---

**Made with ❤️ for the Ralph CLI community**
