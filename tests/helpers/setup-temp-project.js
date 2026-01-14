/**
 * Helper for setting up temporary test projects
 *
 * Creates isolated temp directories with Ralph installed for testing.
 * Reuses patterns from tests/integration.mjs.
 *
 * Usage:
 *   import { setupTempProject, setupTempProjectWithPRD } from './tests/helpers/setup-temp-project.js';
 *
 *   const project = setupTempProject();
 *   // ... run tests ...
 *   project.cleanup();
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = path.join(repoRoot, 'bin', 'ralph');

/**
 * Setup a temporary project with Ralph installed
 * @param {Object} [options] - Setup options
 * @param {boolean} [options.skipInstall=false] - Skip running ralph install
 * @returns {{dir: string, cleanup: Function}}
 */
export function setupTempProject(options = {}) {
  const { skipInstall = false } = options;

  // Create temp directory
  const dir = mkdtempSync(path.join(tmpdir(), 'ralph-test-'));

  // Run ralph install unless skipped
  if (!skipInstall) {
    const result = spawnSync(process.execPath, [cliPath, 'install'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, RALPH_DRY_RUN: '1' }
    });

    if (result.status !== 0) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(`Failed to install ralph: ${result.stderr}`);
    }
  }

  // Create .ralph directory
  mkdirSync(path.join(dir, '.ralph'), { recursive: true });

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

/**
 * Setup a temporary project with a PRD folder
 * @param {Object} [options] - Setup options
 * @param {number} [options.prdNumber=1] - PRD number
 * @param {string} [options.prdContent] - PRD content (defaults to simple PRD)
 * @returns {{dir: string, prdDir: string, cleanup: Function}}
 */
export function setupTempProjectWithPRD(options = {}) {
  const { prdNumber = 1, prdContent } = options;

  // Setup base project
  const project = setupTempProject();

  // Create PRD folder
  const prdDir = path.join(project.dir, '.ralph', `PRD-${prdNumber}`);
  mkdirSync(prdDir, { recursive: true });
  mkdirSync(path.join(prdDir, 'runs'), { recursive: true });

  // Write PRD
  const defaultPRD = `# PRD: Test Feature

## Overview
Test PRD for integration testing.

## User Stories

### [ ] US-001: Test Story

**As a** developer
**I want** a test feature
**So that** testing works

#### Acceptance Criteria
- [ ] Test passes
`;

  writeFileSync(
    path.join(prdDir, 'prd.md'),
    prdContent || defaultPRD,
    'utf-8'
  );

  // Write plan.md
  writeFileSync(
    path.join(prdDir, 'plan.md'),
    '# Implementation Plan\n\n## Tasks\n\n### US-001: Test Story\n\n- [ ] Implement test\n',
    'utf-8'
  );

  // Write progress.md
  writeFileSync(
    path.join(prdDir, 'progress.md'),
    '# Progress Log\n\n',
    'utf-8'
  );

  return {
    ...project,
    prdDir
  };
}

/**
 * Setup multiple PRD folders for stream testing
 * @param {number} count - Number of PRDs to create
 * @returns {{dir: string, prdDirs: string[], cleanup: Function}}
 */
export function setupTempProjectWithMultiplePRDs(count) {
  const project = setupTempProject();
  const prdDirs = [];

  for (let i = 1; i <= count; i++) {
    const prdDir = path.join(project.dir, '.ralph', `PRD-${i}`);
    mkdirSync(prdDir, { recursive: true });
    mkdirSync(path.join(prdDir, 'runs'), { recursive: true });

    writeFileSync(
      path.join(prdDir, 'prd.md'),
      `# PRD-${i}: Test Feature ${i}\n\n## User Stories\n\n### [ ] US-001: Story ${i}\n`,
      'utf-8'
    );

    writeFileSync(
      path.join(prdDir, 'plan.md'),
      `# Plan ${i}\n\n## Tasks\n\n### US-001\n\n- [ ] Task ${i}\n`,
      'utf-8'
    );

    prdDirs.push(prdDir);
  }

  return {
    ...project,
    prdDirs
  };
}

/**
 * Run ralph command in temp project
 * @param {string} dir - Project directory
 * @param {string[]} args - Command arguments
 * @param {Object} [options] - Spawn options
 * @returns {{status: number, stdout: string, stderr: string}}
 */
export function ralphInDir(dir, args, options = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, RALPH_DRY_RUN: '1', ...options.env },
    ...options
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

/**
 * Quick test helper
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Testing temp project setup...');

  const project = setupTempProject();
  console.log(`✓ Created temp project: ${project.dir}`);

  const prdProject = setupTempProjectWithPRD({ prdNumber: 1 });
  console.log(`✓ Created PRD project: ${prdProject.prdDir}`);

  const multiProject = setupTempProjectWithMultiplePRDs(3);
  console.log(`✓ Created ${multiProject.prdDirs.length} PRDs`);

  // Cleanup
  project.cleanup();
  prdProject.cleanup();
  multiProject.cleanup();
  console.log('✓ All projects cleaned up');
}
