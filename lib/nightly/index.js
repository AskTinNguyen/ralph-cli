/**
 * Nightly AI Recommendations Module
 *
 * Main entry point for the nightly recommendations system.
 */

const collector = require("./collector");
const analyzer = require("./analyzer");
const reporter = require("./reporter");
const scheduler = require("./scheduler");
const executor = require("./executor");

module.exports = {
  // Data collection
  ...collector,

  // AI analysis
  analyze: analyzer.analyze,
  ANALYSIS_PROMPTS: analyzer.ANALYSIS_PROMPTS,

  // Reporting
  generateMarkdownReport: reporter.generateMarkdownReport,
  sendEmail: reporter.sendEmail,
  saveMarkdownReport: reporter.saveMarkdownReport,
  sendSlackWebhook: reporter.sendSlackWebhook,
  sendDiscordWebhook: reporter.sendDiscordWebhook,

  // Scheduling
  installCron: scheduler.installCron,
  uninstallCron: scheduler.uninstallCron,
  installLaunchd: scheduler.installLaunchd,
  generateGitHubActionsWorkflow: scheduler.generateGitHubActionsWorkflow,
  getScheduleStatus: scheduler.getScheduleStatus,

  // Execution
  execute: executor.execute,
  EXECUTION_MODES: executor.EXECUTION_MODES,

  // Submodules for direct access
  collector,
  analyzer,
  reporter,
  scheduler,
  executor,
};
