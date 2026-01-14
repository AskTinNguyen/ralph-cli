#!/usr/bin/env node
/**
 * Test script for lib/risk/analyzer.js
 * Verifies risk factor analysis for story text, file patterns, and dependencies
 */

const {
  analyzeStoryRisk,
  analyzeKeywords,
  analyzeFilePatterns,
  analyzeDependencyRisk,
  analyzeScopeRisk,
  extractFilePaths,
  formatRiskPrompt,
} = require("../lib/risk/analyzer");

console.log("Testing Risk Analyzer Module...\n");

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ FAILED: ${name}`);
    failed++;
  }
}

// Test 1: analyzeKeywords - basic functionality
console.log("Test 1: analyzeKeywords() - Basic Functionality");
const simpleText = "Update the user documentation";
const simpleResult = analyzeKeywords(simpleText);
test("Returns object with score", typeof simpleResult.score === "number");
test("Returns matches array", Array.isArray(simpleResult.matches));
test("Score is between 0-10", simpleResult.score >= 0 && simpleResult.score <= 10);
test("No risk keywords in simple text", simpleResult.matchCount === 0);
console.log();

// Test 2: analyzeKeywords - security keywords
console.log("Test 2: analyzeKeywords() - Security Keywords");
const securityText = "Implement user authentication with password encryption";
const securityResult = analyzeKeywords(securityText);
test("Detects 'authentication' keyword", securityResult.matches.some((m) => m.keyword === "authentication"));
test("Detects 'password' keyword", securityResult.matches.some((m) => m.keyword === "password"));
test("Detects 'encryption' keyword", securityResult.matches.some((m) => m.keyword === "encryption"));
test("Security category populated", securityResult.categories.security !== undefined);
test("Score reflects security keywords (>= 6)", securityResult.score >= 6);
console.log();

// Test 3: analyzeKeywords - payment keywords
console.log("Test 3: analyzeKeywords() - Payment/Financial Keywords");
const paymentText = "Add Stripe payment processing for subscriptions and billing";
const paymentResult = analyzeKeywords(paymentText);
test("Detects 'payment' keyword", paymentResult.matches.some((m) => m.keyword === "payment"));
test("Detects 'stripe' keyword", paymentResult.matches.some((m) => m.keyword === "stripe"));
test("Detects 'subscription' keyword", paymentResult.matches.some((m) => m.keyword === "subscription"));
test("Detects 'billing' keyword", paymentResult.matches.some((m) => m.keyword === "billing"));
test("Financial category populated", paymentResult.categories.financial !== undefined);
test("High score for payment features (>= 7)", paymentResult.score >= 7);
console.log();

// Test 4: analyzeKeywords - database keywords
console.log("Test 4: analyzeKeywords() - Database Keywords");
const databaseText = "Run database migration to update the schema and drop old tables";
const databaseResult = analyzeKeywords(databaseText);
test("Detects 'migration' keyword", databaseResult.matches.some((m) => m.keyword === "migration"));
test("Detects 'database' keyword", databaseResult.matches.some((m) => m.keyword === "database"));
test("Detects 'schema' keyword", databaseResult.matches.some((m) => m.keyword === "schema"));
test("Detects 'drop' keyword", databaseResult.matches.some((m) => m.keyword === "drop"));
test("Database category populated", databaseResult.categories.database !== undefined);
console.log();

// Test 5: analyzeKeywords - edge cases
console.log("Test 5: analyzeKeywords() - Edge Cases");
const nullResult = analyzeKeywords(null);
const emptyResult = analyzeKeywords("");
test("Handles null input", nullResult.score === 0);
test("Handles empty string", emptyResult.score === 0);
test("Null returns empty matches", nullResult.matches.length === 0);
// Note: 'auth' should NOT match 'author' due to word boundary
const authorText = "Update the author name in the documentation";
const authorResult = analyzeKeywords(authorText);
test("Word boundary: 'auth' does not match 'author'", !authorResult.matches.some((m) => m.keyword === "auth"));
console.log();

// Test 6: extractFilePaths
console.log("Test 6: extractFilePaths() - File Path Extraction");
const fileText = "Update `lib/auth.js` and `routes/api.ts` files. Also modify src/config/database.sql";
const filePaths = extractFilePaths(fileText);
test("Extracts backtick-enclosed paths", filePaths.includes("lib/auth.js"));
test("Extracts TypeScript files", filePaths.includes("routes/api.ts"));
test("Extracts SQL files", filePaths.some((p) => p.includes("database.sql")));
test("Returns array", Array.isArray(filePaths));
test("Handles empty input", extractFilePaths("").length === 0);
console.log();

// Test 7: analyzeFilePatterns
console.log("Test 7: analyzeFilePatterns() - File Pattern Risk");
const authFileText = "Modify `src/auth/login.js` and `lib/security/crypto.js`";
const authFileResult = analyzeFilePatterns(authFileText);
test("Returns score", typeof authFileResult.score === "number");
test("Detects auth directory files", authFileResult.matches.some((m) => m.pattern.includes("auth")));
test("Detects security directory files", authFileResult.matches.some((m) => m.pattern.includes("security")));
test("Score reflects high-risk files", authFileResult.score >= 3);

const sqlFileText = "Update `migrations/001_create_users.sql`";
const sqlFileResult = analyzeFilePatterns(sqlFileText);
test("Detects SQL files", sqlFileResult.matches.some((m) => m.pattern.includes(".sql")));
console.log();

// Test 8: analyzeDependencyRisk
console.log("Test 8: analyzeDependencyRisk() - Dependency Risk");
const depText = "Add passport and jsonwebtoken to package.json for authentication";
const depResult = analyzeDependencyRisk(depText);
test("Returns score", typeof depResult.score === "number");
test("Detects dependency changes", depResult.hasDependencyChanges === true);
test("Detects passport library", depResult.matches.some((m) => m.dependency.includes("Authentication")));
test("Detects JWT library", depResult.matches.some((m) => m.dependency.includes("JWT")));

const majorVersionText = "Upgrade to major version 5.0 with breaking changes";
const majorResult = analyzeDependencyRisk(majorVersionText);
test("Detects major version changes", majorResult.majorVersionBonus > 0);
console.log();

// Test 9: analyzeScopeRisk
console.log("Test 9: analyzeScopeRisk() - Scope Risk");
const singleScope = "Fix the typo in README.md";
const singleResult = analyzeScopeRisk(singleScope);
test("Single scope detection", singleResult.scope === "single");
test("Low scope score for single file", singleResult.score <= 2);

const wideScope = "Refactor all files in the codebase throughout the entire project";
const wideResult = analyzeScopeRisk(wideScope);
test("Wide scope detection", wideResult.scope === "wide");
test("High scope score for wide changes", wideResult.score >= 3);

const multiCriteria = `
Story with many criteria:
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
- [ ] Criterion 4
- [ ] Criterion 5
- [ ] Criterion 6
- [ ] Criterion 7
`;
const criteriaResult = analyzeScopeRisk(multiCriteria);
test("Counts acceptance criteria", criteriaResult.criteriaCount === 7);
test("Adds bonus for many criteria", criteriaResult.criteriaBonus > 0);
console.log();

// Test 10: analyzeStoryRisk - simple story
console.log("Test 10: analyzeStoryRisk() - Simple Story");
const simpleStory = `
### US-001: Fix typo
**As a** user
**I want** the typo fixed in the README
**So that** the docs are correct

#### Acceptance Criteria
- [ ] Fix the typo
`;
const simpleStoryResult = analyzeStoryRisk(simpleStory);
test("Returns score", typeof simpleStoryResult.score === "number");
test("Score is 1-10", simpleStoryResult.score >= 1 && simpleStoryResult.score <= 10);
test("Simple story has low score (1-3)", simpleStoryResult.score <= 3);
test("Risk level is low", simpleStoryResult.riskLevel === "low");
test("Returns factors array", Array.isArray(simpleStoryResult.factors));
test("Returns breakdown object", typeof simpleStoryResult.breakdown === "object");
console.log();

// Test 11: analyzeStoryRisk - high-risk story
console.log("Test 11: analyzeStoryRisk() - High-Risk Story");
const highRiskStory = `
### US-002: Implement Payment Authentication
**As a** user
**I want** secure payment processing
**So that** I can make purchases

This involves adding Stripe integration and password-protected checkout.
Update \`src/payment/checkout.js\` and \`lib/auth/session.js\`.

#### Acceptance Criteria
- [ ] Add Stripe payment processing
- [ ] Implement password verification
- [ ] Secure the checkout flow
- [ ] Add database migration for payment records
- [ ] Update authentication tokens
`;
const highRiskResult = analyzeStoryRisk(highRiskStory);
test("High-risk story detected", highRiskResult.score >= 5);
test("Risk level is high or critical", highRiskResult.riskLevel === "high" || highRiskResult.riskLevel === "critical");
test("Multiple factors identified", highRiskResult.factors.length >= 3);
test("Keyword analysis populated", highRiskResult.analysis.keywords.matchCount > 0);
test("File pattern analysis populated", highRiskResult.analysis.filePatterns.matchCount > 0);
console.log();

// Test 12: formatRiskPrompt
console.log("Test 12: formatRiskPrompt() - CLI Output Format");
const formattedOutput = formatRiskPrompt(highRiskResult);
test("Returns string", typeof formattedOutput === "string");
test("Contains score", formattedOutput.includes("/10"));
test("Contains risk level", formattedOutput.includes("Risk Level:"));
test("Contains factors section", formattedOutput.includes("Factors:"));
test("Lists individual factors", formattedOutput.includes("- "));
console.log();

// Test 13: Risk categories
console.log("Test 13: Risk Categories");
const securityStory = "Implement encryption for user credentials and token management";
const securityStoryResult = analyzeStoryRisk(securityStory);
test("Security category identified", securityStoryResult.factors.some((f) => f.category === "security"));

const financialStory = "Add payment processing with Stripe for billing and invoices";
const financialStoryResult = analyzeStoryRisk(financialStory);
test("Financial category identified", financialStoryResult.factors.some((f) => f.category === "financial"));
console.log();

// Test 14: Edge cases and boundary conditions
console.log("Test 14: Edge Cases");
const nullStoryResult = analyzeStoryRisk(null);
test("Handles null story input", nullStoryResult.score === 1);
test("Null returns low risk level", nullStoryResult.riskLevel === "low");

const emptyStoryResult = analyzeStoryRisk("");
test("Handles empty story input", emptyStoryResult.score === 1);

// Score capping
const extremeStory = `
Authentication security password encryption token session
Payment billing transaction stripe paypal refund
Migration database schema sql delete drop truncate
Production deployment secrets config environment
`;
const extremeResult = analyzeStoryRisk(extremeStory);
test("Score capped at 10", extremeResult.score <= 10);
test("Extreme story is critical", extremeResult.riskLevel === "critical");
console.log();

// Summary
console.log("=".repeat(50));
console.log(`\nTest Summary: ${passed} passed, ${failed} failed`);
console.log();

if (failed > 0) {
  console.log("SOME TESTS FAILED!");
  process.exit(1);
} else {
  console.log("All tests passed!");
  process.exit(0);
}
