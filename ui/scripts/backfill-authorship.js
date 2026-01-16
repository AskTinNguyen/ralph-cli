#!/usr/bin/env node
/**
 * Backfill Authorship Metadata Script
 *
 * Iterates through all PRD directories and creates authorship metadata
 * for prd.md and plan.md files that don't already have it.
 *
 * All existing content is marked as 'ai:claude' (default author).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeAuthorship, getAuthorshipPath } from '../dist/services/authorship-reader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ralph root directory (ralph-cli/.ralph)
const RALPH_ROOT = path.resolve(__dirname, '../../.ralph');

// Default author for all existing content
const DEFAULT_AUTHOR = 'ai:claude';

// Statistics
const stats = {
  totalPRDs: 0,
  processedPRDs: 0,
  skippedPRDs: 0,
  createdPRDAuthorship: 0,
  createdPlanAuthorship: 0,
  skippedPRDAuthorship: 0, // Already exists
  skippedPlanAuthorship: 0, // Already exists
  errors: 0,
};

/**
 * Process a single PRD file (prd.md or plan.md)
 */
function processFile(filePath, fileType) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return { status: 'missing', message: `${fileType} does not exist` };
    }

    // Check if authorship file already exists
    const authorshipPath = getAuthorshipPath(filePath);
    if (fs.existsSync(authorshipPath)) {
      return { status: 'skip', message: `Authorship file already exists: ${path.basename(authorshipPath)}` };
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');

    // Initialize authorship metadata
    const metadata = initializeAuthorship(content, filePath, DEFAULT_AUTHOR);

    // Save authorship file
    fs.writeFileSync(authorshipPath, JSON.stringify(metadata, null, 2), 'utf-8');

    return {
      status: 'created',
      message: `Created ${path.basename(authorshipPath)}`,
      stats: metadata.stats,
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Error processing ${fileType}: ${error.message}`,
      error,
    };
  }
}

/**
 * Process a single PRD directory
 */
function processPRD(prdDir, prdName) {
  console.log(`\nProcessing ${prdName}...`);

  const prdPath = path.join(prdDir, 'prd.md');
  const planPath = path.join(prdDir, 'plan.md');

  let hasPRD = false;
  let hasPlan = false;

  // Process prd.md
  const prdResult = processFile(prdPath, 'prd.md');
  console.log(`  prd.md: ${prdResult.message}`);

  if (prdResult.status === 'created') {
    stats.createdPRDAuthorship++;
    hasPRD = true;
    console.log(`    Stats: ${prdResult.stats.totalLines} lines, ${prdResult.stats.aiPercentage}% AI`);
  } else if (prdResult.status === 'skip') {
    stats.skippedPRDAuthorship++;
    hasPRD = true;
  } else if (prdResult.status === 'error') {
    stats.errors++;
    console.error(`    Error: ${prdResult.error}`);
  }

  // Process plan.md
  const planResult = processFile(planPath, 'plan.md');
  console.log(`  plan.md: ${planResult.message}`);

  if (planResult.status === 'created') {
    stats.createdPlanAuthorship++;
    hasPlan = true;
    console.log(`    Stats: ${planResult.stats.totalLines} lines, ${planResult.stats.aiPercentage}% AI`);
  } else if (planResult.status === 'skip') {
    stats.skippedPlanAuthorship++;
    hasPlan = true;
  } else if (planResult.status === 'error') {
    stats.errors++;
    console.error(`    Error: ${planResult.error}`);
  }

  // Update PRD stats
  if (hasPRD || hasPlan) {
    stats.processedPRDs++;
  } else {
    stats.skippedPRDs++;
  }
}

/**
 * Main execution
 */
function main() {
  console.log('='.repeat(60));
  console.log('Backfill Authorship Metadata');
  console.log('='.repeat(60));
  console.log(`Ralph Root: ${RALPH_ROOT}`);
  console.log(`Default Author: ${DEFAULT_AUTHOR}`);
  console.log('='.repeat(60));

  // Check if .ralph directory exists
  if (!fs.existsSync(RALPH_ROOT)) {
    console.error(`Error: .ralph directory not found at ${RALPH_ROOT}`);
    process.exit(1);
  }

  // Find all PRD directories
  const entries = fs.readdirSync(RALPH_ROOT, { withFileTypes: true });
  const prdDirs = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('PRD-'))
    .map(entry => ({
      name: entry.name,
      path: path.join(RALPH_ROOT, entry.name),
      number: parseInt(entry.name.replace('PRD-', ''), 10),
    }))
    .sort((a, b) => a.number - b.number);

  stats.totalPRDs = prdDirs.length;
  console.log(`\nFound ${prdDirs.length} PRD directories\n`);

  // Process each PRD directory
  for (const prd of prdDirs) {
    processPRD(prd.path, prd.name);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total PRDs found: ${stats.totalPRDs}`);
  console.log(`PRDs processed: ${stats.processedPRDs}`);
  console.log(`PRDs skipped (no files): ${stats.skippedPRDs}`);
  console.log('');
  console.log(`prd.md authorship created: ${stats.createdPRDAuthorship}`);
  console.log(`prd.md authorship skipped (exists): ${stats.skippedPRDAuthorship}`);
  console.log('');
  console.log(`plan.md authorship created: ${stats.createdPlanAuthorship}`);
  console.log(`plan.md authorship skipped (exists): ${stats.skippedPlanAuthorship}`);
  console.log('');
  console.log(`Errors: ${stats.errors}`);
  console.log('='.repeat(60));

  if (stats.errors > 0) {
    console.log('\nBackfill completed with errors');
    process.exit(1);
  } else {
    console.log('\nBackfill completed successfully');
    process.exit(0);
  }
}

// Run the script
main();
