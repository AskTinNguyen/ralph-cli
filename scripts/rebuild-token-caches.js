#!/usr/bin/env node
/**
 * Rebuild token caches for all PRD directories
 */

const fs = require('fs');
const path = require('path');
const { rebuildCache } = require('../lib/tokens/cache');

function main() {
  const rootDir = process.cwd();
  const ralphDir = path.join(rootDir, '.ralph');

  if (!fs.existsSync(ralphDir)) {
    console.error('No .ralph directory found. Run this from project root.');
    process.exit(1);
  }

  console.log('🔄 Rebuilding token caches...\n');

  const allEntries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdDirs = allEntries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('PRD-'))
    .map(entry => ({ name: entry.name, path: path.join(ralphDir, entry.name) }));

  let rebuilt = 0;
  let errors = 0;

  for (const { name, path: prdPath } of prdDirs) {
    try {
      const cache = rebuildCache(prdPath);

      if (cache && cache.runs && cache.runs.length > 0) {
        console.log(`✅ ${name}: ${cache.runs.length} runs, ${Object.keys(cache.byModel || {}).length} models`);
        rebuilt++;
      } else {
        console.log(`⊘  ${name}: no metrics found`);
      }
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
      errors++;
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`✅ Rebuilt ${rebuilt} caches`);
  if (errors > 0) {
    console.log(`❌ ${errors} errors`);
  }
  console.log('═══════════════════════════════════════');
}

main();
