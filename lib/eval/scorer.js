/**
 * Run evaluation scorer - computes quality scores for runs
 */
const { parseRunSummary, parseRunLog } = require("./parser");

/**
 * Score a single run based on various metrics
 * @param {string} summaryPath - Path to run summary file
 * @returns {object} Score breakdown and overall score
 */
function scoreRun(summaryPath) {
  const summary = parseRunSummary(summaryPath);
  if (!summary) {
    return null;
  }

  const logData = summary.logPath ? parseRunLog(summary.logPath) : null;

  const scores = {
    runId: summary.runId,
    iteration: summary.iteration,
    mode: summary.mode,
    story: summary.story,
    duration: summary.duration,
    status: summary.status,

    // Individual scores (0-100)
    successScore: 0,
    commitScore: 0,
    verificationScore: 0,
    efficiencyScore: 0,

    // Overall score (0-100)
    overall: 0,

    // Breakdown details
    details: {
      hadCommits: false,
      commitCount: 0,
      changedFilesCount: 0,
      hasUncommittedChanges: false,
      uncommittedCount: 0,
      verificationsPassed: 0,
      verificationsFailed: 0,
      hasCompleteSignal: false,
      errorCount: 0,
    },
  };

  // Success score (0-100): Based on run status
  if (summary.status === "success") {
    scores.successScore = 100;
  } else if (summary.status === "error") {
    scores.successScore = 0;
  } else {
    scores.successScore = 50; // Unknown status
  }

  // Commit quality score (0-100)
  scores.details.commitCount = summary.commits.length;
  scores.details.hadCommits = summary.commits.length > 0;
  scores.details.changedFilesCount = summary.changedFiles.length;
  scores.details.hasUncommittedChanges = summary.uncommittedChanges.length > 0;
  scores.details.uncommittedCount = summary.uncommittedChanges.length;

  if (summary.commits.length > 0) {
    // Good: has commits
    scores.commitScore = 70;

    // Bonus for clean working tree (no uncommitted changes)
    if (!scores.details.hasUncommittedChanges) {
      scores.commitScore += 30;
    } else {
      // Penalty based on number of uncommitted files
      scores.commitScore -= Math.min(20, summary.uncommittedChanges.length * 5);
    }
  } else if (summary.mode === "plan") {
    // Plan mode may not need commits
    scores.commitScore = summary.status === "success" ? 80 : 40;
  } else {
    // Build mode without commits is not ideal
    scores.commitScore = 20;
  }

  // Verification score (0-100)
  if (logData) {
    scores.details.verificationsPassed = logData.passCount;
    scores.details.verificationsFailed = logData.failCount;
    scores.details.hasCompleteSignal = logData.hasComplete;
    scores.details.errorCount = logData.errors.length;

    const totalVerifications = logData.passCount + logData.failCount;
    if (totalVerifications > 0) {
      scores.verificationScore = Math.round((logData.passCount / totalVerifications) * 100);
    } else {
      // No explicit verification found, use status as proxy
      scores.verificationScore = summary.status === "success" ? 70 : 30;
    }

    // Bonus for COMPLETE signal
    if (logData.hasComplete) {
      scores.verificationScore = Math.min(100, scores.verificationScore + 10);
    }

    // Penalty for errors
    if (logData.errors.length > 0) {
      scores.verificationScore = Math.max(
        0,
        scores.verificationScore - Math.min(30, logData.errors.length * 5)
      );
    }
  } else {
    // No log data available
    scores.verificationScore = summary.status === "success" ? 60 : 20;
  }

  // Efficiency score (0-100): Based on duration
  // Benchmarks: <60s = excellent, <120s = good, <300s = average, >300s = slow
  if (summary.duration) {
    if (summary.duration < 60) {
      scores.efficiencyScore = 100;
    } else if (summary.duration < 120) {
      scores.efficiencyScore = 90;
    } else if (summary.duration < 180) {
      scores.efficiencyScore = 80;
    } else if (summary.duration < 300) {
      scores.efficiencyScore = 60;
    } else if (summary.duration < 600) {
      scores.efficiencyScore = 40;
    } else {
      scores.efficiencyScore = 20;
    }
  } else {
    scores.efficiencyScore = 50; // Unknown duration
  }

  // Calculate overall score (weighted average)
  // Weights: success (40%), verification (30%), commit (20%), efficiency (10%)
  scores.overall = Math.round(
    scores.successScore * 0.4 +
      scores.verificationScore * 0.3 +
      scores.commitScore * 0.2 +
      scores.efficiencyScore * 0.1
  );

  return scores;
}

/**
 * Grade a score into a letter grade
 * @param {number} score - Score 0-100
 * @returns {string} Letter grade
 */
function gradeScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Aggregate scores across multiple runs
 * @param {object[]} scores - Array of score objects from scoreRun
 * @returns {object} Aggregated metrics
 */
function aggregateScores(scores) {
  if (!scores || scores.length === 0) {
    return null;
  }

  const validScores = scores.filter((s) => s !== null);
  if (validScores.length === 0) {
    return null;
  }

  const sum = (arr, key) => arr.reduce((acc, s) => acc + (s[key] || 0), 0);
  const avg = (arr, key) => Math.round(sum(arr, key) / arr.length);

  const successRuns = validScores.filter((s) => s.status === "success");
  const errorRuns = validScores.filter((s) => s.status === "error");

  // Calculate duration stats
  const durations = validScores.map((s) => s.duration).filter((d) => d != null);
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;
  const minDuration = durations.length > 0 ? Math.min(...durations) : null;
  const maxDuration = durations.length > 0 ? Math.max(...durations) : null;

  // Identify common failure patterns
  const failurePatterns = {};
  for (const score of errorRuns) {
    if (score.details.errorCount > 0) {
      const key = `errors_${score.details.errorCount}`;
      failurePatterns[key] = (failurePatterns[key] || 0) + 1;
    }
    if (score.details.hasUncommittedChanges) {
      failurePatterns["uncommitted_changes"] = (failurePatterns["uncommitted_changes"] || 0) + 1;
    }
    if (!score.details.hasCompleteSignal && score.mode === "build") {
      failurePatterns["no_complete_signal"] = (failurePatterns["no_complete_signal"] || 0) + 1;
    }
  }

  return {
    totalRuns: validScores.length,
    successCount: successRuns.length,
    errorCount: errorRuns.length,
    successRate: Math.round((successRuns.length / validScores.length) * 100),

    avgOverall: avg(validScores, "overall"),
    avgSuccess: avg(validScores, "successScore"),
    avgCommit: avg(validScores, "commitScore"),
    avgVerification: avg(validScores, "verificationScore"),
    avgEfficiency: avg(validScores, "efficiencyScore"),

    avgDuration,
    minDuration,
    maxDuration,

    failurePatterns: Object.entries(failurePatterns)
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, count]) => ({ pattern, count })),

    grade: gradeScore(avg(validScores, "overall")),
  };
}

module.exports = {
  scoreRun,
  gradeScore,
  aggregateScores,
};
