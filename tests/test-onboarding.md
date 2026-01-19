# Onboarding Experience Test

## Quick Test

To test the onboarding experience after implementing it:

### Method 1: Via `ralph install`

```bash
# Create test project
mkdir /tmp/test-onboarding && cd /tmp/test-onboarding
git init

# Run ralph install (onboarding will trigger at the end)
ralph install
```

**What to expect:**
1. Installation prompts (skills, UI)
2. Auto-speak setup guidance
3. **NEW**: Onboarding prompt: "Would you like a quick interactive tour?"

### Method 2: Via `ralph init --tour`

```bash
# Launch onboarding directly
ralph init --tour
```

**What to expect:**
- Welcome screen
- Interactive menu with learning options
- Detailed explanations and examples

## Onboarding Flow

### 1. Welcome & Tour Prompt

```
Welcome to Ralph CLI! 🎉

? Would you like a quick interactive tour? (Y/n)
```

### 2. Interactive Menu

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

### 3. Feature Lessons

Each lesson includes:
- Clear explanation of the feature
- Example commands
- Best practices
- When to use it

### 4. Interactive Demo

Option to:
- Create a sample "Todo List" PRD
- See the generated PRD file
- Learn next steps (plan, build)

### 5. Completion

Shows:
- Next steps
- Documentation links
- Community resources
- How to replay the tour

## What to Test

### ✅ User Experience

- [ ] Welcome message is clear and friendly
- [ ] Menu navigation is intuitive
- [ ] Each lesson is informative but concise
- [ ] Commands are properly formatted and highlighted
- [ ] Demo creates a real PRD successfully
- [ ] User can exit at any time
- [ ] Tour can be replayed with `ralph init --tour`

### ✅ Technical Validation

- [ ] Works in interactive terminal (TTY)
- [ ] Skips gracefully in non-interactive mode
- [ ] All imports resolve correctly
- [ ] @clack/prompts displays properly
- [ ] Sample PRD generation works
- [ ] UI demo launches correctly (if deps installed)

### ✅ Content Validation

- [ ] Overview explains Ralph clearly
- [ ] Workflow shows PRD → Plan → Build
- [ ] PRD lesson explains purpose and usage
- [ ] Plan lesson shows story structure
- [ ] Build lesson explains iteration loop
- [ ] UI lesson covers dashboard features
- [ ] Demo is practical and helpful
- [ ] Next steps are actionable

## Manual Test Script

```bash
# 1. Setup
mkdir /tmp/ralph-onboarding-test
cd /tmp/ralph-onboarding-test
git init
git config user.name "Test User"
git config user.email "test@example.com"

# 2. Run installation
ralph install

# Expected prompts:
# - Install skills? → Choose Y or N
# - Install UI? → Choose Y or N
# - Auto-speak setup? → Choose N (skip)
# - Would you like a tour? → Choose Y

# 3. Test the onboarding
# Navigate through each menu option:
# - Overview
# - Workflow
# - PRD Generation
# - Planning
# - Build Loops
# - UI Dashboard
# - Try a Demo (optional)
# - I'm ready to start!

# 4. Verify demo works (if you chose it)
# - Check that PRD was created in .ralph/PRD-N/
# - Read the generated PRD
cat .ralph/PRD-*/prd.md

# 5. Test replay
ralph init --tour

# Should launch the tutorial again

# 6. Cleanup
cd ..
rm -rf /tmp/ralph-onboarding-test
```

## Expected Output Samples

### Overview Lesson

```
┌  What is Ralph?
│
│  Ralph CLI is an autonomous coding loop that helps you build features faster.
│
│  How it works:
│    1. PRD   - Define what you want to build
│    2. Plan  - Break it into implementation stories
│    3. Build - AI agent executes stories iteratively
│
│  Key features:
│    • Autonomous build iterations with Claude/Codex
│    • Git-based progress tracking
│    • Web UI for monitoring
│    • Parallel execution with worktrees
│    • Built-in guardrails and learnings
│
│  Think of Ralph as your AI pair programmer that handles the implementation grind.
│
└  Press Enter to continue...
```

### Workflow Lesson

```
┌  Ralph Workflow
│
│  The Ralph Workflow - Three simple steps:
│
│  Step 1: Generate PRD (Product Requirements Document)
│    Command: ralph prd
│    • Describe your feature in natural language
│    • Ralph generates a structured PRD with user stories
│    • Saved in .ralph/PRD-N/prd.md
│
│  Step 2: Create Plan
│    Command: ralph plan
│    • Breaks PRD into ordered implementation stories
│    • Each story has acceptance criteria
│    • Creates .ralph/PRD-N/plan.md
│
│  Step 3: Run Build Iterations
│    Command: ralph build 5
│    • Executes 5 build iterations
│    • Each iteration picks next story, implements it, commits
│    • Progress tracked in .ralph/PRD-N/progress.md
│
│  Result: Working code, committed to git, ready to test! 🎉
│
└  Press Enter to continue...
```

## Success Criteria

✅ **Onboarding is successful if:**

1. **Accessible**: Easy to trigger (`ralph install` or `ralph init --tour`)
2. **Informative**: Teaches core concepts clearly
3. **Interactive**: Users can choose what to learn
4. **Practical**: Demo creates real artifacts
5. **Non-intrusive**: Can be skipped or exited anytime
6. **Replayable**: `ralph init --tour` works anytime

✅ **User understands:**

- What Ralph is and why to use it
- The PRD → Plan → Build workflow
- How to create their first PRD
- How to use the UI dashboard
- Where to find help and documentation

## Troubleshooting

### Issue: Prompts don't appear

**Cause**: Non-interactive terminal or missing @clack/prompts

**Fix**:
- Ensure running in actual terminal (not piped)
- Check that @clack/prompts is installed: `npm list @clack/prompts`

### Issue: Demo fails

**Cause**: `ralph prd` command not working

**Fix**:
- Verify ralph is properly installed: `ralph --version`
- Check that agent (Claude/Codex) is configured
- Ensure git is initialized in test directory

### Issue: UI demo doesn't work

**Cause**: UI dependencies not installed

**Fix**:
- Check if UI deps exist: `ls <ralph-cli>/ui/node_modules`
- Install manually: `cd <ralph-cli>/ui && npm install`

## Next Steps After Testing

1. **Gather feedback**
   - Ask beta users to try the onboarding
   - Collect feedback on clarity and helpfulness
   - Iterate on content and flow

2. **Update documentation**
   - Add onboarding section to README
   - Update CLAUDE.md with tour instructions
   - Create video walkthrough (optional)

3. **Enhance content**
   - Add more examples
   - Include common troubleshooting
   - Link to advanced features

4. **Track metrics** (optional)
   - How many users complete the tour?
   - Which sections are most visited?
   - Where do users drop off?
