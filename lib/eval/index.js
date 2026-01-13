/**
 * Evaluation module - main entry point
 */
const { parseRunSummary, parseRunLog, listRunSummaries, extractRunId } = require("./parser");
const { scoreRun, gradeScore, aggregateScores } = require("./scorer");
const { generateRunReport, generateSummaryReport, saveReport, formatDuration, scoreBar } = require("./reporter");

module.exports = {
  // Parser
  parseRunSummary,
  parseRunLog,
  listRunSummaries,
  extractRunId,
  // Scorer
  scoreRun,
  gradeScore,
  aggregateScores,
  // Reporter
  generateRunReport,
  generateSummaryReport,
  saveReport,
  formatDuration,
  scoreBar,
};
