// Unit tests for ralph Python libraries
// Run: node tests/lib-python.mjs

import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const LIB_DIR = join(ROOT_DIR, '.agents/ralph/lib');

// Test counters
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

// Colors
const C_GREEN = '\x1b[32m';
const C_RED = '\x1b[31m';
const C_YELLOW = '\x1b[33m';
const C_RESET = '\x1b[0m';

function pass(msg) {
  testsPassed++;
  console.log(`  ${C_GREEN}✓${C_RESET} ${msg}`);
}

function fail(msg, detail = '') {
  testsFailed++;
  console.log(`  ${C_RED}✗${C_RESET} ${msg}`);
  if (detail) console.log(`    ${C_YELLOW}→ ${detail}${C_RESET}`);
}

function runTest() {
  testsRun++;
}

// ============================================================================
// Test: prd-parser.py
// ============================================================================
function testPrdParser() {
  console.log('\nTesting prd-parser.py...');

  const prdParser = join(LIB_DIR, 'prd-parser.py');

  // Test: Script compiles
  runTest();
  try {
    const result = spawnSync('python3', ['-m', 'py_compile', prdParser], { encoding: 'utf8' });
    if (result.status === 0) {
      pass('prd-parser.py compiles without error');
    } else {
      fail('prd-parser.py compilation failed', result.stderr);
    }
  } catch (e) {
    fail('prd-parser.py compilation error', e.message);
  }

  // Test: Script shows usage when run with unknown command
  runTest();
  try {
    const result = spawnSync('python3', [prdParser, 'unknown_command'], { encoding: 'utf8' });
    // Should print usage info
    if (result.stdout.includes('Commands:') || result.stdout.includes('render_prompt')) {
      pass('prd-parser.py displays usage for unknown commands');
    } else {
      fail('prd-parser.py did not show usage', result.stdout.substring(0, 200));
    }
  } catch (e) {
    fail('prd-parser.py usage check error', e.message);
  }

  // Test: select_story command with PRD
  runTest();
  const tempDir = mkdtempSync(join(tmpdir(), 'ralph-test-'));
  const testPrd = `# Product Requirements Document

## Overview
Test PRD

## User Stories

### [ ] US-001: First story
**As a** user
**I want** feature
**So that** benefit

#### Acceptance Criteria
- [ ] Criterion 1

### [x] US-002: Second story (completed)
**As a** user
**I want** another feature
**So that** benefit

#### Acceptance Criteria
- [x] Criterion 1
`;

  const prdFile = join(tempDir, 'prd.md');
  const metaOut = join(tempDir, 'meta.json');
  const blockOut = join(tempDir, 'block.txt');
  writeFileSync(prdFile, testPrd);

  try {
    const result = spawnSync('python3', [prdParser, 'select_story', prdFile, metaOut, blockOut], { encoding: 'utf8' });
    if (result.status === 0) {
      // Check that meta file was created and contains US-001
      const meta = readFileSync(metaOut, 'utf8');
      if (meta.includes('US-001')) {
        pass('prd-parser.py select_story selects pending story');
      } else {
        fail('prd-parser.py select_story did not select US-001', meta);
      }
    } else {
      fail('prd-parser.py select_story failed', result.stderr);
    }
  } catch (e) {
    fail('prd-parser.py select_story error', e.message);
  }

  // Test: story_field extracts ID
  runTest();
  try {
    const result = spawnSync('python3', [prdParser, 'story_field', metaOut, 'id'], { encoding: 'utf8' });
    if (result.stdout.trim() === 'US-001') {
      pass('prd-parser.py story_field extracts story ID');
    } else {
      fail('prd-parser.py story_field returned wrong ID', result.stdout.trim());
    }
  } catch (e) {
    fail('prd-parser.py story_field error', e.message);
  }

  // Cleanup
  rmSync(tempDir, { recursive: true, force: true });
}

// ============================================================================
// Test: run-meta-writer.py
// ============================================================================
function testRunMetaWriter() {
  console.log('\nTesting run-meta-writer.py...');

  const metaWriter = join(LIB_DIR, 'run-meta-writer.py');

  // Test: Script exists and compiles
  runTest();
  try {
    const result = spawnSync('python3', ['-m', 'py_compile', metaWriter], { encoding: 'utf8' });
    if (result.status === 0) {
      pass('run-meta-writer.py compiles without error');
    } else {
      fail('run-meta-writer.py compilation failed', result.stderr);
    }
  } catch (e) {
    fail('run-meta-writer.py compilation error', e.message);
  }

  // Test: Can generate metadata file
  runTest();
  const tempDir = mkdtempSync(join(tmpdir(), 'ralph-meta-test-'));
  const jsonInput = {
    run_id: 'test-123',
    mode: 'build',
    iter: 1,
    story_id: 'US-001',
    story_title: 'Test story',
    started: '2024-01-01T00:00:00Z',
    ended: '2024-01-01T00:01:00Z',
    duration: 60,
    status: 'success',
    log_file: '/tmp/log.txt',
    head_before: 'abc1234',
    head_after: 'def5678',
    commit_list: '- commit 1',
    changed_files: '- file.txt',
    dirty_files: '',
    input_tokens: 1000,
    output_tokens: 500,
    token_model: 'claude-sonnet',
    token_estimated: false,
    retry_count: 0,
    retry_time: 0
  };

  const jsonFile = join(tempDir, 'input.json');
  const outputFile = join(tempDir, 'output.md');
  writeFileSync(jsonFile, JSON.stringify(jsonInput));

  try {
    const result = spawnSync('python3', [metaWriter, jsonFile, outputFile], { encoding: 'utf8' });
    if (result.status === 0) {
      const content = readFileSync(outputFile, 'utf8');
      if (content.includes('Ralph Run Summary') && content.includes('US-001')) {
        pass('run-meta-writer.py generates valid markdown');
      } else {
        fail('run-meta-writer.py output missing expected content', content.substring(0, 200));
      }
    } else {
      fail('run-meta-writer.py execution failed', result.stderr);
    }
  } catch (e) {
    fail('run-meta-writer.py execution error', e.message);
  }

  // Test: Output contains key sections
  runTest();
  try {
    const content = readFileSync(outputFile, 'utf8');
    const hasGitSection = content.includes('## Git');
    const hasTokenSection = content.includes('Token') || content.includes('token');
    if (hasGitSection && hasTokenSection) {
      pass('run-meta-writer.py output contains required sections');
    } else {
      fail('run-meta-writer.py output missing sections', `Git: ${hasGitSection}, Token: ${hasTokenSection}`);
    }
  } catch (e) {
    fail('run-meta-writer.py section check error', e.message);
  }

  // Cleanup
  rmSync(tempDir, { recursive: true, force: true });
}

// ============================================================================
// Test: Python environment
// ============================================================================
function testPythonEnvironment() {
  console.log('\nTesting Python environment...');

  // Test: Python 3 available
  runTest();
  try {
    const result = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.includes('Python 3')) {
      pass(`Python 3 available (${result.stdout.trim()})`);
    } else {
      fail('Python 3 not available', result.stderr);
    }
  } catch (e) {
    fail('Python 3 check error', e.message);
  }

  // Test: Required modules available
  runTest();
  try {
    const result = spawnSync('python3', ['-c', 'import json, sys, os, re; print("OK")'], { encoding: 'utf8' });
    if (result.stdout.trim() === 'OK') {
      pass('Required Python modules available');
    } else {
      fail('Required Python modules missing', result.stderr);
    }
  } catch (e) {
    fail('Python module check error', e.message);
  }
}

// ============================================================================
// Main
// ============================================================================
function main() {
  console.log('Ralph Python Library Tests');
  console.log('==========================');

  testPythonEnvironment();
  testPrdParser();
  testRunMetaWriter();

  // Summary
  console.log('\n==========================');
  console.log(`Tests run: ${testsRun}`);
  console.log(`${C_GREEN}Passed: ${testsPassed}${C_RESET}`);
  if (testsFailed > 0) {
    console.log(`${C_RED}Failed: ${testsFailed}${C_RESET}`);
    process.exit(1);
  } else {
    console.log('Failed: 0');
    console.log(`\n${C_GREEN}All tests passed!${C_RESET}`);
  }
}

main();
