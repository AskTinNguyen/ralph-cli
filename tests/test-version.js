#!/usr/bin/env node
/**
 * Test: ralph --version command
 * Verifies version output includes expected information
 */

const { execSync } = require('child_process');
const assert = require('assert');
const path = require('path');
const pc = require('picocolors');

// Use the bin/ralph directly from the repo
const ralphBin = path.join(__dirname, '..', 'bin', 'ralph');

console.log(pc.cyan('Testing ralph version command...'));

try {
  // Test --version flag
  console.log(pc.dim('  Testing: ralph --version'));
  const output = execSync(`node "${ralphBin}" --version`, { encoding: 'utf8' });
  assert(output.includes('ralph-cli v'), 'Should include "ralph-cli v"');
  assert(output.includes('Node: v'), 'Should include "Node: v"');
  assert(output.includes('Platform:'), 'Should include "Platform:"');
  console.log(pc.green('  ✓ --version flag works'));

  // Test -v shorthand
  console.log(pc.dim('  Testing: ralph -v'));
  const shortOutput = execSync(`node "${ralphBin}" -v`, { encoding: 'utf8' });
  assert(shortOutput.includes('ralph-cli v'), 'Should include "ralph-cli v"');
  assert(shortOutput.includes('Node: v'), 'Should include "Node: v"');
  assert(shortOutput.includes('Platform:'), 'Should include "Platform:"');
  console.log(pc.green('  ✓ -v shorthand works'));

  // Test version command
  console.log(pc.dim('  Testing: ralph version'));
  const cmdOutput = execSync(`node "${ralphBin}" version`, { encoding: 'utf8' });
  assert(cmdOutput.includes('ralph-cli v'), 'Should include "ralph-cli v"');
  console.log(pc.green('  ✓ version command works'));

  // Verify all three produce identical output
  assert.strictEqual(output, shortOutput, '--version and -v should produce identical output');
  assert.strictEqual(output, cmdOutput, '--version and version command should produce identical output');
  console.log(pc.green('  ✓ All version formats produce identical output'));

  console.log('');
  console.log(pc.green('✓ All version command tests passed'));
  process.exit(0);
} catch (err) {
  console.error('');
  console.error(pc.red('✗ Version command tests failed'));
  console.error(pc.red(err.message));
  if (err.stdout) console.error(pc.dim('stdout:'), err.stdout);
  if (err.stderr) console.error(pc.dim('stderr:'), err.stderr);
  process.exit(1);
}
