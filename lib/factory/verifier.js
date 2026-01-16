/**
 * Factory Verification Module
 *
 * Provides tamper-resistant verification gates that cannot be bypassed
 * by agents simply outputting success text or manipulating exit codes.
 *
 * Verification Philosophy:
 * - Trust artifacts, not text
 * - Trust git history, not claims
 * - Trust test runners, not output parsing
 * - Require proof of work, not promises
 *
 * @module lib/factory/verifier
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

/**
 * Verification result structure
 */
const VerificationStatus = {
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
};

/**
 * Built-in verifier types
 */
const VERIFIER_TYPES = {
  // File-based verification
  FILE_EXISTS: "file_exists",
  FILE_CHANGED: "file_changed",
  FILE_CONTAINS: "file_contains",

  // Git-based verification (tamper-resistant)
  GIT_COMMITS: "git_commits",
  GIT_DIFF: "git_diff",
  GIT_FILES_CHANGED: "git_files_changed",

  // Test-based verification (runs actual tests)
  TEST_SUITE: "test_suite",
  TEST_COVERAGE: "test_coverage",

  // Build verification
  BUILD_SUCCESS: "build_success",
  LINT_PASS: "lint_pass",

  // Custom verification command
  CUSTOM: "custom",
};

/**
 * Run a verification check
 * @param {Object} verifier - Verifier configuration
 * @param {Object} context - Execution context
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Verification result
 */
function runVerification(verifier, context, projectRoot) {
  const startTime = Date.now();

  try {
    let result;

    switch (verifier.type) {
      case VERIFIER_TYPES.FILE_EXISTS:
        result = verifyFileExists(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.FILE_CHANGED:
        result = verifyFileChanged(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.FILE_CONTAINS:
        result = verifyFileContains(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.GIT_COMMITS:
        result = verifyGitCommits(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.GIT_DIFF:
        result = verifyGitDiff(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.GIT_FILES_CHANGED:
        result = verifyGitFilesChanged(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.TEST_SUITE:
        result = verifyTestSuite(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.TEST_COVERAGE:
        result = verifyTestCoverage(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.BUILD_SUCCESS:
        result = verifyBuildSuccess(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.LINT_PASS:
        result = verifyLintPass(verifier, context, projectRoot);
        break;

      case VERIFIER_TYPES.CUSTOM:
        result = verifyCustom(verifier, context, projectRoot);
        break;

      default:
        result = {
          status: VerificationStatus.FAILED,
          error: `Unknown verifier type: ${verifier.type}`,
        };
    }

    result.duration = Date.now() - startTime;
    result.verifier = verifier.id || verifier.type;

    return result;
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: err.message,
      duration: Date.now() - startTime,
      verifier: verifier.id || verifier.type,
    };
  }
}

/**
 * Verify file exists
 */
function verifyFileExists(verifier, context, projectRoot) {
  const files = Array.isArray(verifier.files) ? verifier.files : [verifier.files];
  const missing = [];

  for (const file of files) {
    const resolvedPath = resolveFilePath(file, context, projectRoot);
    if (!fs.existsSync(resolvedPath)) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    return {
      status: VerificationStatus.FAILED,
      error: `Missing files: ${missing.join(", ")}`,
      details: { missing },
    };
  }

  return {
    status: VerificationStatus.PASSED,
    details: { verified_files: files.length },
  };
}

/**
 * Verify file was modified (using git or mtime)
 */
function verifyFileChanged(verifier, context, projectRoot) {
  const files = Array.isArray(verifier.files) ? verifier.files : [verifier.files];
  const since = verifier.since || context.started_at;
  const unchanged = [];

  for (const file of files) {
    const resolvedPath = resolveFilePath(file, context, projectRoot);

    if (!fs.existsSync(resolvedPath)) {
      unchanged.push(`${file} (not found)`);
      continue;
    }

    // Check git status first (more reliable)
    try {
      const gitStatus = execSync(`git status --porcelain "${resolvedPath}"`, {
        cwd: projectRoot,
        encoding: "utf8",
      }).trim();

      // If file shows in git status, it was modified
      if (!gitStatus) {
        // Check if file was committed since start
        const gitLog = execSync(
          `git log --since="${since}" --oneline -- "${resolvedPath}"`,
          { cwd: projectRoot, encoding: "utf8" }
        ).trim();

        if (!gitLog) {
          unchanged.push(file);
        }
      }
    } catch {
      // Fall back to mtime check
      const stats = fs.statSync(resolvedPath);
      const sinceTime = new Date(since).getTime();
      if (stats.mtimeMs < sinceTime) {
        unchanged.push(file);
      }
    }
  }

  if (unchanged.length > 0) {
    return {
      status: VerificationStatus.FAILED,
      error: `Files not modified: ${unchanged.join(", ")}`,
      details: { unchanged },
    };
  }

  return {
    status: VerificationStatus.PASSED,
    details: { verified_files: files.length },
  };
}

/**
 * Verify file contains specific content
 */
function verifyFileContains(verifier, context, projectRoot) {
  const file = resolveFilePath(verifier.file, context, projectRoot);
  const patterns = Array.isArray(verifier.contains)
    ? verifier.contains
    : [verifier.contains];

  if (!fs.existsSync(file)) {
    return {
      status: VerificationStatus.FAILED,
      error: `File not found: ${verifier.file}`,
    };
  }

  const content = fs.readFileSync(file, "utf8");
  const missing = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern);
    if (!regex.test(content)) {
      missing.push(pattern);
    }
  }

  if (missing.length > 0) {
    return {
      status: VerificationStatus.FAILED,
      error: `Required patterns not found: ${missing.join(", ")}`,
      details: { missing_patterns: missing },
    };
  }

  return {
    status: VerificationStatus.PASSED,
    details: { verified_patterns: patterns.length },
  };
}

/**
 * Verify git commits exist (TAMPER-RESISTANT)
 * This is the strongest verification - checks actual git history
 */
function verifyGitCommits(verifier, context, projectRoot) {
  const minCommits = verifier.min_commits || 1;
  const since = verifier.since || context.started_at;
  const pattern = verifier.message_pattern || null;
  const author = verifier.author || null;

  try {
    // Build git log command
    let cmd = `git log --since="${since}" --oneline`;

    if (pattern) {
      cmd += ` --grep="${pattern}"`;
    }

    if (author) {
      cmd += ` --author="${author}"`;
    }

    const output = execSync(cmd, {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();

    const commits = output ? output.split("\n") : [];

    if (commits.length < minCommits) {
      return {
        status: VerificationStatus.FAILED,
        error: `Expected at least ${minCommits} commits, found ${commits.length}`,
        details: {
          expected: minCommits,
          found: commits.length,
          commits: commits.slice(0, 10),
        },
      };
    }

    return {
      status: VerificationStatus.PASSED,
      details: {
        commit_count: commits.length,
        commits: commits.slice(0, 10),
      },
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Git verification failed: ${err.message}`,
    };
  }
}

/**
 * Verify git diff shows actual changes
 */
function verifyGitDiff(verifier, context, projectRoot) {
  const minLines = verifier.min_lines_changed || 1;
  const paths = verifier.paths || ["."];

  try {
    const pathsArg = paths.join(" ");
    const output = execSync(`git diff --stat HEAD~1 -- ${pathsArg}`, {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();

    // Parse stat output for line changes
    const statMatch = output.match(/(\d+) insertions?\(\+\), (\d+) deletions?\(-\)/);
    const insertions = statMatch ? parseInt(statMatch[1], 10) : 0;
    const deletions = statMatch ? parseInt(statMatch[2], 10) : 0;
    const totalChanges = insertions + deletions;

    if (totalChanges < minLines) {
      return {
        status: VerificationStatus.FAILED,
        error: `Expected at least ${minLines} lines changed, found ${totalChanges}`,
        details: { insertions, deletions, total: totalChanges },
      };
    }

    return {
      status: VerificationStatus.PASSED,
      details: { insertions, deletions, total: totalChanges },
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Git diff verification failed: ${err.message}`,
    };
  }
}

/**
 * Verify specific files were changed in git
 */
function verifyGitFilesChanged(verifier, context, projectRoot) {
  const requiredFiles = Array.isArray(verifier.files)
    ? verifier.files
    : [verifier.files];
  const since = verifier.since || context.started_at;

  try {
    const output = execSync(
      `git diff --name-only HEAD~5 HEAD`,
      { cwd: projectRoot, encoding: "utf8" }
    ).trim();

    const changedFiles = new Set(output.split("\n").filter(Boolean));
    const missing = [];

    for (const file of requiredFiles) {
      // Support glob patterns
      if (file.includes("*")) {
        const regex = new RegExp(
          "^" + file.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        );
        const found = [...changedFiles].some((f) => regex.test(f));
        if (!found) {
          missing.push(file);
        }
      } else if (!changedFiles.has(file)) {
        missing.push(file);
      }
    }

    if (missing.length > 0) {
      return {
        status: VerificationStatus.FAILED,
        error: `Required files not changed: ${missing.join(", ")}`,
        details: { missing, changed: [...changedFiles].slice(0, 20) },
      };
    }

    return {
      status: VerificationStatus.PASSED,
      details: { verified_files: requiredFiles.length },
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Git files verification failed: ${err.message}`,
    };
  }
}

/**
 * Verify test suite passes (TAMPER-RESISTANT)
 * Actually runs the test command and parses real results
 */
function verifyTestSuite(verifier, context, projectRoot) {
  const command = verifier.command || "npm test";
  const minPassing = verifier.min_passing || 1;
  const maxFailing = verifier.max_failing || 0;
  const timeout = verifier.timeout || 300000; // 5 min default

  try {
    // Run actual test command
    const result = spawnSync("bash", ["-c", command], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const output = (result.stdout || "") + (result.stderr || "");

    // Parse test results from actual test runner output
    const testResults = parseTestResults(output);

    // Verify test requirements
    const errors = [];

    if (testResults.passed < minPassing) {
      errors.push(
        `Expected at least ${minPassing} passing tests, got ${testResults.passed}`
      );
    }

    if (testResults.failed > maxFailing) {
      errors.push(
        `Expected at most ${maxFailing} failing tests, got ${testResults.failed}`
      );
    }

    // Exit code must be 0 for tests to pass
    if (result.status !== 0 && maxFailing === 0) {
      errors.push(`Test command exited with code ${result.status}`);
    }

    if (errors.length > 0) {
      return {
        status: VerificationStatus.FAILED,
        error: errors.join("; "),
        details: {
          ...testResults,
          exit_code: result.status,
          output_snippet: output.slice(-1000),
        },
      };
    }

    return {
      status: VerificationStatus.PASSED,
      details: {
        ...testResults,
        exit_code: result.status,
      },
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Test execution failed: ${err.message}`,
    };
  }
}

/**
 * Verify test coverage meets threshold
 */
function verifyTestCoverage(verifier, context, projectRoot) {
  const command = verifier.command || "npm run test:coverage";
  const minCoverage = verifier.min_coverage || 80;
  const timeout = verifier.timeout || 300000;

  try {
    const result = spawnSync("bash", ["-c", command], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const output = (result.stdout || "") + (result.stderr || "");

    // Parse coverage from output (supports multiple formats)
    const coverage = parseCoverageResults(output);

    if (coverage === null) {
      return {
        status: VerificationStatus.FAILED,
        error: "Could not parse coverage results",
        details: { output_snippet: output.slice(-500) },
      };
    }

    if (coverage < minCoverage) {
      return {
        status: VerificationStatus.FAILED,
        error: `Coverage ${coverage}% is below minimum ${minCoverage}%`,
        details: { coverage, min_required: minCoverage },
      };
    }

    return {
      status: VerificationStatus.PASSED,
      details: { coverage, min_required: minCoverage },
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Coverage verification failed: ${err.message}`,
    };
  }
}

/**
 * Verify build succeeds
 */
function verifyBuildSuccess(verifier, context, projectRoot) {
  const command = verifier.command || "npm run build";
  const timeout = verifier.timeout || 300000;

  try {
    const result = spawnSync("bash", ["-c", command], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0) {
      return {
        status: VerificationStatus.FAILED,
        error: `Build failed with exit code ${result.status}`,
        details: {
          exit_code: result.status,
          stderr: (result.stderr || "").slice(-1000),
        },
      };
    }

    // Optionally verify build artifacts exist
    if (verifier.artifacts) {
      const artifactResult = verifyFileExists(
        { files: verifier.artifacts },
        context,
        projectRoot
      );
      if (artifactResult.status === VerificationStatus.FAILED) {
        return {
          status: VerificationStatus.FAILED,
          error: `Build artifacts missing: ${artifactResult.error}`,
          details: artifactResult.details,
        };
      }
    }

    return {
      status: VerificationStatus.PASSED,
      details: { exit_code: 0 },
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Build verification failed: ${err.message}`,
    };
  }
}

/**
 * Verify linting passes
 */
function verifyLintPass(verifier, context, projectRoot) {
  const command = verifier.command || "npm run lint";
  const maxWarnings = verifier.max_warnings || 0;
  const timeout = verifier.timeout || 120000;

  try {
    const result = spawnSync("bash", ["-c", command], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const output = (result.stdout || "") + (result.stderr || "");

    // Parse lint results
    const lintResults = parseLintResults(output);

    if (result.status !== 0 || lintResults.errors > 0) {
      return {
        status: VerificationStatus.FAILED,
        error: `Lint failed: ${lintResults.errors} errors, ${lintResults.warnings} warnings`,
        details: lintResults,
      };
    }

    if (lintResults.warnings > maxWarnings) {
      return {
        status: VerificationStatus.FAILED,
        error: `Too many lint warnings: ${lintResults.warnings} (max: ${maxWarnings})`,
        details: lintResults,
      };
    }

    return {
      status: VerificationStatus.PASSED,
      details: lintResults,
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Lint verification failed: ${err.message}`,
    };
  }
}

/**
 * Custom verification command
 * Runs a command and checks exit code - use for project-specific checks
 */
function verifyCustom(verifier, context, projectRoot) {
  if (!verifier.command) {
    return {
      status: VerificationStatus.FAILED,
      error: "Custom verifier requires a command",
    };
  }

  const timeout = verifier.timeout || 60000;
  const expectExitCode = verifier.expect_exit_code || 0;

  try {
    const result = spawnSync("bash", ["-c", verifier.command], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== expectExitCode) {
      return {
        status: VerificationStatus.FAILED,
        error: `Command exited with ${result.status}, expected ${expectExitCode}`,
        details: {
          exit_code: result.status,
          stdout: (result.stdout || "").slice(-500),
          stderr: (result.stderr || "").slice(-500),
        },
      };
    }

    return {
      status: VerificationStatus.PASSED,
      details: {
        exit_code: result.status,
        stdout: (result.stdout || "").slice(-200),
      },
    };
  } catch (err) {
    return {
      status: VerificationStatus.FAILED,
      error: `Custom verification failed: ${err.message}`,
    };
  }
}

/**
 * Run all verifiers for a stage
 * ALL verifiers must pass for the stage to pass
 * @param {Array} verifiers - Array of verifier configurations
 * @param {Object} context - Execution context
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Combined verification result
 */
function runAllVerifications(verifiers, context, projectRoot) {
  if (!verifiers || verifiers.length === 0) {
    return {
      status: VerificationStatus.PASSED,
      results: [],
      message: "No verifiers configured",
    };
  }

  const results = [];
  const failures = [];

  for (const verifier of verifiers) {
    const result = runVerification(verifier, context, projectRoot);
    results.push(result);

    if (result.status === VerificationStatus.FAILED) {
      failures.push({
        verifier: result.verifier,
        error: result.error,
      });
    }
  }

  if (failures.length > 0) {
    return {
      status: VerificationStatus.FAILED,
      results,
      failures,
      message: `${failures.length} verification(s) failed`,
    };
  }

  return {
    status: VerificationStatus.PASSED,
    results,
    message: `All ${results.length} verification(s) passed`,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve file path with variable substitution
 */
function resolveFilePath(filePath, context, projectRoot) {
  // Replace {{ variables }}
  let resolved = filePath.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return context[key] || "";
  });

  // Make absolute if relative
  if (!path.isAbsolute(resolved)) {
    resolved = path.join(projectRoot, resolved);
  }

  return resolved;
}

/**
 * Parse test results from various test runner outputs
 */
function parseTestResults(output) {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: null,
  };

  // Jest format - parse from the "Tests:" line specifically
  // Format can be: "Tests: 21 passed, 21 total" or "Tests: 8 failed, 13 passed, 21 total"
  const testsLine = output.match(/Tests:\s*([^\n]+)/i);
  if (testsLine) {
    const line = testsLine[1];
    const totalMatch = line.match(/(\d+)\s*total/i);
    const passedMatch = line.match(/(\d+)\s*passed/i);
    const failedMatch = line.match(/(\d+)\s*failed/i);
    const skippedMatch = line.match(/(\d+)\s*skipped/i);

    if (totalMatch) {
      results.total = parseInt(totalMatch[1], 10) || 0;
      results.passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
      results.failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
      results.skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
      return results;
    }
  }

  // Mocha format: X passing, Y failing
  const mochaPassMatch = output.match(/(\d+)\s+passing/i);
  const mochaFailMatch = output.match(/(\d+)\s+failing/i);
  const mochaPendMatch = output.match(/(\d+)\s+pending/i);

  if (mochaPassMatch || mochaFailMatch) {
    results.passed = mochaPassMatch ? parseInt(mochaPassMatch[1], 10) : 0;
    results.failed = mochaFailMatch ? parseInt(mochaFailMatch[1], 10) : 0;
    results.skipped = mochaPendMatch ? parseInt(mochaPendMatch[1], 10) : 0;
    results.total = results.passed + results.failed + results.skipped;
    return results;
  }

  // TAP format: # tests X, # pass Y, # fail Z
  const tapTestsMatch = output.match(/# tests\s+(\d+)/i);
  const tapPassMatch = output.match(/# pass\s+(\d+)/i);
  const tapFailMatch = output.match(/# fail\s+(\d+)/i);

  if (tapTestsMatch) {
    results.total = parseInt(tapTestsMatch[1], 10);
    results.passed = tapPassMatch ? parseInt(tapPassMatch[1], 10) : 0;
    results.failed = tapFailMatch ? parseInt(tapFailMatch[1], 10) : 0;
    return results;
  }

  // Generic: look for "X tests" or "X specs"
  const genericMatch = output.match(/(\d+)\s+(tests?|specs?)/i);
  if (genericMatch) {
    results.total = parseInt(genericMatch[1], 10);
    // Assume all passed if no failures mentioned
    const failMatch = output.match(/(\d+)\s+(fail|error)/i);
    results.failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    results.passed = results.total - results.failed;
  }

  return results;
}

/**
 * Parse coverage results from output
 */
function parseCoverageResults(output) {
  // Istanbul/NYC format: All files | XX.XX |
  const istanbulMatch = output.match(/All files[^|]*\|\s*([\d.]+)/);
  if (istanbulMatch) {
    return parseFloat(istanbulMatch[1]);
  }

  // Generic percentage: Coverage: XX% or XX% coverage
  const genericMatch = output.match(/(?:coverage[:\s]*)?(\d+(?:\.\d+)?)\s*%/i);
  if (genericMatch) {
    return parseFloat(genericMatch[1]);
  }

  return null;
}

/**
 * Parse lint results from output
 */
function parseLintResults(output) {
  const results = {
    errors: 0,
    warnings: 0,
    files: 0,
  };

  // ESLint format: X problems (Y errors, Z warnings)
  const eslintMatch = output.match(
    /(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i
  );
  if (eslintMatch) {
    results.errors = parseInt(eslintMatch[2], 10);
    results.warnings = parseInt(eslintMatch[3], 10);
    return results;
  }

  // Count error/warning keywords
  const errorMatches = output.match(/\berror\b/gi);
  const warningMatches = output.match(/\bwarning\b/gi);

  results.errors = errorMatches ? errorMatches.length : 0;
  results.warnings = warningMatches ? warningMatches.length : 0;

  return results;
}

module.exports = {
  VerificationStatus,
  VERIFIER_TYPES,
  runVerification,
  runAllVerifications,
  // Export individual verifiers for direct use
  verifyFileExists,
  verifyFileChanged,
  verifyFileContains,
  verifyGitCommits,
  verifyGitDiff,
  verifyGitFilesChanged,
  verifyTestSuite,
  verifyTestCoverage,
  verifyBuildSuccess,
  verifyLintPass,
  verifyCustom,
  // Helpers
  parseTestResults,
  parseCoverageResults,
};
