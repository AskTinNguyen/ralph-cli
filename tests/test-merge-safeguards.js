/**
 * Unit tests for merge safeguards
 * Verifies that Ralph has proper safeguards against auto-merging
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

describe('Merge Safeguards', () => {
  describe('loop.sh - No Auto-Merge Logic', () => {
    it('should not execute "ralph stream merge" commands', () => {
      const loopPath = path.join(ROOT, '.agents/ralph/loop.sh');
      const content = fs.readFileSync(loopPath, 'utf8');

      // Should not execute merge commands (but can mention in help text)
      // Check for actual command execution patterns, not printf/echo instructions
      const lines = content.split('\n');
      const executionLines = lines.filter(line => {
        // Skip comment lines
        if (line.trim().startsWith('#')) return false;
        // Skip printf/echo lines (these are user instructions)
        if (line.includes('printf') || line.includes('echo')) return false;
        // Check remaining lines for ralph stream merge
        return line.includes('ralph stream merge');
      });

      assert.strictEqual(
        executionLines.length,
        0,
        'loop.sh must not execute "ralph stream merge" commands (found in: ' +
        executionLines.slice(0, 3).join('; ') + ')'
      );

      // Should not call merge functions directly
      assert.ok(
        !content.includes('cmd_merge(') || content.includes('# cmd_merge('),
        'loop.sh must not call cmd_merge() directly'
      );
    });

    it('should have context-aware completion messaging functions', () => {
      const loopPath = path.join(ROOT, '.agents/ralph/loop.sh');
      const content = fs.readFileSync(loopPath, 'utf8');

      // Should have helper functions
      assert.ok(
        content.includes('in_worktree_context()'),
        'loop.sh must have in_worktree_context() function'
      );

      assert.ok(
        content.includes('show_completion_instructions()'),
        'loop.sh must have show_completion_instructions() function'
      );
    });

    it('should call show_completion_instructions on completion', () => {
      const loopPath = path.join(ROOT, '.agents/ralph/loop.sh');
      const content = fs.readFileSync(loopPath, 'utf8');

      // Should call the function on completion
      assert.ok(
        content.includes('show_completion_instructions'),
        'loop.sh must call show_completion_instructions() on completion'
      );
    });

    it('should contain "Manual Merge Required" messaging', () => {
      const loopPath = path.join(ROOT, '.agents/ralph/loop.sh');
      const content = fs.readFileSync(loopPath, 'utf8');

      assert.ok(
        content.includes('MANUAL MERGE REQUIRED'),
        'loop.sh must contain "MANUAL MERGE REQUIRED" messaging'
      );
    });
  });

  describe('PROMPT_build.md - Agent Merge Prohibition', () => {
    it('should have "Critical Merge Policy" section', () => {
      const promptPath = path.join(ROOT, '.agents/ralph/PROMPT_build.md');
      const content = fs.readFileSync(promptPath, 'utf8');

      assert.ok(
        content.includes('## Critical Merge Policy'),
        'PROMPT_build.md must have "Critical Merge Policy" section'
      );
    });

    it('should explicitly prohibit merge commands', () => {
      const promptPath = path.join(ROOT, '.agents/ralph/PROMPT_build.md');
      const content = fs.readFileSync(promptPath, 'utf8');

      // Should prohibit merge
      assert.ok(
        content.includes('MUST NOT'),
        'PROMPT_build.md must contain "MUST NOT" prohibition'
      );

      assert.ok(
        content.includes('ralph stream merge'),
        'PROMPT_build.md must mention "ralph stream merge" in prohibition'
      );
    });

    it('should explain the WHY behind merge policy', () => {
      const promptPath = path.join(ROOT, '.agents/ralph/PROMPT_build.md');
      const content = fs.readFileSync(promptPath, 'utf8');

      assert.ok(
        content.includes('**WHY**'),
        'PROMPT_build.md must explain WHY merges are prohibited'
      );

      assert.ok(
        content.includes('explicit human validation'),
        'PROMPT_build.md must mention "explicit human validation"'
      );
    });

    it('should define correct agent role', () => {
      const promptPath = path.join(ROOT, '.agents/ralph/PROMPT_build.md');
      const content = fs.readFileSync(promptPath, 'utf8');

      assert.ok(
        content.includes('**YOUR ROLE**'),
        'PROMPT_build.md must define agent role'
      );

      assert.ok(
        content.includes('<promise>COMPLETE</promise>'),
        'PROMPT_build.md must mention COMPLETE signal as agent output'
      );
    });
  });

  describe('config.sh - Merge Policy Configuration', () => {
    it('should have merge policy configuration section', () => {
      const configPath = path.join(ROOT, '.agents/ralph/config.sh');
      const content = fs.readFileSync(configPath, 'utf8');

      assert.ok(
        content.includes('# Merge Policy Configuration'),
        'config.sh must have "Merge Policy Configuration" section'
      );
    });

    it('should define RALPH_MERGE_REQUIRE_CONFIRM', () => {
      const configPath = path.join(ROOT, '.agents/ralph/config.sh');
      const content = fs.readFileSync(configPath, 'utf8');

      assert.ok(
        content.includes('RALPH_MERGE_REQUIRE_CONFIRM=true'),
        'config.sh must define RALPH_MERGE_REQUIRE_CONFIRM=true by default'
      );
    });

    it('should document CRITICAL no-auto-merge guarantee', () => {
      const configPath = path.join(ROOT, '.agents/ralph/config.sh');
      const content = fs.readFileSync(configPath, 'utf8');

      assert.ok(
        content.includes('CRITICAL'),
        'config.sh must contain CRITICAL warning'
      );

      assert.ok(
        content.includes('NEVER auto-merges'),
        'config.sh must state "NEVER auto-merges" guarantee'
      );
    });
  });

  describe('stream.sh - Merge Confirmation Prompt', () => {
    it('should have --yes flag support', () => {
      const streamPath = path.join(ROOT, '.agents/ralph/stream.sh');
      const content = fs.readFileSync(streamPath, 'utf8');

      // Should parse --yes flag
      assert.ok(
        content.includes('--yes|-y)'),
        'stream.sh must support --yes and -y flags'
      );

      assert.ok(
        content.includes('skip_confirm=true'),
        'stream.sh must set skip_confirm=true for --yes flag'
      );
    });

    it('should check RALPH_MERGE_REQUIRE_CONFIRM', () => {
      const streamPath = path.join(ROOT, '.agents/ralph/stream.sh');
      const content = fs.readFileSync(streamPath, 'utf8');

      assert.ok(
        content.includes('RALPH_MERGE_REQUIRE_CONFIRM'),
        'stream.sh must check RALPH_MERGE_REQUIRE_CONFIRM config'
      );
    });

    it('should have merge confirmation prompt', () => {
      const streamPath = path.join(ROOT, '.agents/ralph/stream.sh');
      const content = fs.readFileSync(streamPath, 'utf8');

      assert.ok(
        content.includes('Merge Confirmation'),
        'stream.sh must have "Merge Confirmation" header'
      );

      assert.ok(
        content.includes('Proceed with merge?'),
        'stream.sh must prompt "Proceed with merge?"'
      );
    });

    it('should show commit summary before merge', () => {
      const streamPath = path.join(ROOT, '.agents/ralph/stream.sh');
      const content = fs.readFileSync(streamPath, 'utf8');

      assert.ok(
        content.includes('Commits to be merged'),
        'stream.sh must show "Commits to be merged" summary'
      );

      assert.ok(
        content.includes('git log --oneline'),
        'stream.sh must show git log output'
      );
    });

    it('should allow cancellation of merge', () => {
      const streamPath = path.join(ROOT, '.agents/ralph/stream.sh');
      const content = fs.readFileSync(streamPath, 'utf8');

      assert.ok(
        content.includes('Merge cancelled by user'),
        'stream.sh must allow merge cancellation'
      );
    });
  });

  describe('Documentation Updates', () => {
    it('CLAUDE.md should emphasize manual merge in Workflow section', () => {
      const claudePath = path.join(ROOT, 'CLAUDE.md');
      const content = fs.readFileSync(claudePath, 'utf8');

      assert.ok(
        content.includes('**Merge** → **MANUAL STEP**'),
        'CLAUDE.md must emphasize manual merge step'
      );

      assert.ok(
        content.includes('Builds NEVER auto-merge'),
        'CLAUDE.md must state "Builds NEVER auto-merge"'
      );
    });

    it('CLAUDE.md should have merge safety section in Parallel Workflow', () => {
      const claudePath = path.join(ROOT, 'CLAUDE.md');
      const content = fs.readFileSync(claudePath, 'utf8');

      assert.ok(
        content.includes('**Merge Safety**'),
        'CLAUDE.md must have "Merge Safety" section'
      );

      assert.ok(
        content.includes('requires human confirmation'),
        'CLAUDE.md must mention "requires human confirmation"'
      );
    });

    it('agent-guide.html should have Critical Merge Policy warning', () => {
      const guidePath = path.join(ROOT, 'ui/public/docs/agent-guide.html');
      const content = fs.readFileSync(guidePath, 'utf8');

      assert.ok(
        content.includes('🚨 CRITICAL: Manual Merge Policy'),
        'agent-guide.html must have "CRITICAL: Manual Merge Policy" warning'
      );

      assert.ok(
        content.includes('❌ NEVER DO (Prohibited)'),
        'agent-guide.html must have "NEVER DO" section'
      );

      assert.ok(
        content.includes('✅ CORRECT AGENT WORKFLOW'),
        'agent-guide.html must have "CORRECT AGENT WORKFLOW" section'
      );
    });
  });
});
