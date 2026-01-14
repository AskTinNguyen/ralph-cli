/**
 * Risk Configuration - Default settings for risk assessment
 *
 * This file defines the default risk assessment configuration for Ralph.
 * Projects can override these settings by creating a .ralph/risk.config.js file.
 *
 * Usage:
 *   - Copy this file to .ralph/risk.config.js for per-project customization
 *   - Modify threshold, patterns, and behavior to match your risk tolerance
 */

module.exports = {
  // Risk threshold: scores at or above this value are considered "high risk"
  // Range: 1-10, where 10 is maximum risk
  threshold: 7,

  // High-risk keyword patterns to detect in story text
  // Each pattern is a regex that matches risk-related terminology
  highRiskPatterns: [
    /\bauth\b/i,          // Authentication
    /\bsecurity\b/i,      // Security-related
    /\bpayment\b/i,       // Payment processing
    /\bmigration\b/i,     // Database migrations
    /\bpassword\b/i,      // Password handling
    /\bcredential/i,      // Credentials
    /\bencrypt/i,         // Encryption
    /\bdatabase\b/i,      // Database operations
    /\bschema\b/i,        // Schema changes
    /\bproduction\b/i,    // Production environment
    /\bpii\b/i,           // Personal identifiable information
    /\bgdpr\b/i,          // GDPR compliance
  ],

  // High-risk file patterns - files matching these patterns increase risk score
  // Uses glob-style patterns
  highRiskFiles: [
    "**/auth/**",         // Authentication code
    "**/security/**",     // Security modules
    "**/*.sql",           // SQL files
    "**/migrations/**",   // Database migrations
    "**/payment/**",      // Payment processing
    "**/billing/**",      // Billing systems
    "**/.env*",           // Environment configuration
    "**/secrets/**",      // Secrets storage
  ],

  // Pause execution and prompt user for high-risk stories
  // Set to false to log warnings but continue automatically
  pauseOnHighRisk: true,

  // Risk factor weights for scoring calculation
  // Total must add up to 1.0
  weights: {
    keyword: 0.3,         // Weight for keyword matches
    filePattern: 0.3,     // Weight for file pattern matches
    dependency: 0.2,      // Weight for dependency changes
    scope: 0.2,           // Weight for change scope (file count)
  },

  // Risk level thresholds for categorization
  levels: {
    critical: 8,          // Score >= 8 is critical
    high: 7,              // Score >= 7 is high (default threshold)
    medium: 4,            // Score >= 4 is medium
    low: 0,               // Score < 4 is low
  },
};
