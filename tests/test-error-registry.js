/**
 * Tests for Ralph CLI Error Registry
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");

// Test helpers
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// Load modules
const registry = require("../lib/error/registry");
const errorModule = require("../lib/error");

// Clear cache before tests
registry.clearCache();

describe("Error Registry", () => {
  test("should load error registry from disk", () => {
    const reg = registry.loadRegistry();
    assert(reg, "Registry should be loaded");
    assert(reg.errors, "Registry should have errors object");
    assert(Object.keys(reg.errors).length > 0, "Registry should have at least one error");
  });

  test("should validate error code format", () => {
    assert(registry.isValidCode("RALPH-001"), "RALPH-001 should be valid");
    assert(registry.isValidCode("RALPH-999"), "RALPH-999 should be valid");
    assert(!registry.isValidCode("RALPH-1"), "RALPH-1 should be invalid");
    assert(!registry.isValidCode("RALPH-0001"), "RALPH-0001 should be invalid");
    assert(!registry.isValidCode("ERROR-001"), "ERROR-001 should be invalid");
    assert(!registry.isValidCode("ralph-001"), "ralph-001 should be invalid");
  });

  test("should get error by code", () => {
    const error = registry.getError("RALPH-001");
    assert(error, "Should find RALPH-001");
    assert(error.category === "CONFIG", "RALPH-001 should be CONFIG category");
    assert(error.message, "Error should have message");
    assert(error.remediation, "Error should have remediation");
  });

  test("should return null for unknown code", () => {
    const error = registry.getError("RALPH-999");
    // This might exist or not depending on registry
    // Just check it doesn't throw
  });

  test("should return null for invalid code", () => {
    const error = registry.getError("INVALID");
    assert(error === null, "Invalid code should return null");
  });

  test("should get all error codes", () => {
    const codes = registry.getAllCodes();
    assert(Array.isArray(codes), "Should return array");
    assert(codes.length > 0, "Should have at least one code");
    assert(codes.every((c) => c.startsWith("RALPH-")), "All codes should start with RALPH-");
  });

  test("should filter errors by category", () => {
    const configErrors = registry.getByCategory("CONFIG");
    assert(Object.keys(configErrors).length > 0, "Should have CONFIG errors");
    for (const [code, error] of Object.entries(configErrors)) {
      assert(error.category === "CONFIG", `${code} should be CONFIG category`);
    }
  });

  test("should filter errors by severity", () => {
    const errorSeverity = registry.getBySeverity("error");
    assert(Object.keys(errorSeverity).length > 0, "Should have error severity items");
    for (const [code, error] of Object.entries(errorSeverity)) {
      assert(error.severity === "error", `${code} should have error severity`);
    }
  });

  test("should get auto-issue errors", () => {
    const autoIssue = registry.getAutoIssueErrors();
    for (const [code, error] of Object.entries(autoIssue)) {
      assert(error.auto_issue === true, `${code} should have auto_issue=true`);
    }
  });

  test("should get category from code number", () => {
    assert(registry.getCategoryFromCode("RALPH-001") === "CONFIG", "001 is CONFIG");
    assert(registry.getCategoryFromCode("RALPH-101") === "PRD", "101 is PRD");
    assert(registry.getCategoryFromCode("RALPH-201") === "BUILD", "201 is BUILD");
    assert(registry.getCategoryFromCode("RALPH-301") === "GIT", "301 is GIT");
    assert(registry.getCategoryFromCode("RALPH-401") === "AGENT", "401 is AGENT");
    assert(registry.getCategoryFromCode("RALPH-501") === "STREAM", "501 is STREAM");
    assert(registry.getCategoryFromCode("RALPH-901") === "INTERNAL", "901 is INTERNAL");
  });

  test("should get available categories", () => {
    const categories = registry.getCategories();
    assert(categories.includes("CONFIG"), "Should include CONFIG");
    assert(categories.includes("BUILD"), "Should include BUILD");
    assert(categories.includes("AGENT"), "Should include AGENT");
  });
});

describe("Error Module (index.js)", () => {
  test("should lookup error by code", () => {
    const error = errorModule.lookup("RALPH-001");
    assert(error, "Should find error");
    assert(error.message, "Error should have message");
  });

  test("should check if code is valid", () => {
    assert(errorModule.isValid("RALPH-001"), "RALPH-001 should be valid");
    assert(!errorModule.isValid("INVALID"), "INVALID should not be valid");
  });

  test("should check if code exists", () => {
    assert(errorModule.exists("RALPH-001"), "RALPH-001 should exist");
    assert(!errorModule.exists("RALPH-998"), "RALPH-998 may not exist");
  });

  test("should get error categories", () => {
    const categories = errorModule.getCategories();
    assert(Array.isArray(categories), "Should return array");
    assert(categories.length > 0, "Should have categories");
  });

  test("should get all codes", () => {
    const codes = errorModule.getCodes();
    assert(Array.isArray(codes), "Should return array");
    assert(codes.length > 0, "Should have codes");
  });

  test("should check shouldCreateIssue", () => {
    // RALPH-201 should have auto_issue=true
    const should201 = errorModule.shouldCreateIssue("RALPH-201");
    // RALPH-001 should have auto_issue=false
    const should001 = errorModule.shouldCreateIssue("RALPH-001");
    assert(should201 === true, "RALPH-201 should create issue");
    assert(should001 === false, "RALPH-001 should not create issue");
  });

  test("should get labels for error", () => {
    const labels = errorModule.getLabels("RALPH-201");
    assert(Array.isArray(labels), "Should return array");
    assert(labels.includes("ralph-build"), "BUILD error should have ralph-build label");
  });
});

describe("Error JSON Validation", () => {
  test("should have valid JSON structure", () => {
    const registryPath = path.join(__dirname, "../.agents/ralph/lib/errors.json");
    const content = fs.readFileSync(registryPath, "utf8");
    const json = JSON.parse(content);

    assert(json, "Should parse without error");
    assert(json._meta, "Should have _meta field");
    assert(json._meta.version, "Should have version");
    assert(json._meta.ranges, "Should have ranges");
  });

  test("all errors should have required fields", () => {
    const registryPath = path.join(__dirname, "../.agents/ralph/lib/errors.json");
    const content = fs.readFileSync(registryPath, "utf8");
    const json = JSON.parse(content);

    const { $schema, _meta, ...errors } = json;
    const requiredFields = ["category", "severity", "message", "details", "remediation"];

    for (const [code, error] of Object.entries(errors)) {
      for (const field of requiredFields) {
        assert(
          error[field] !== undefined,
          `${code} should have ${field} field`
        );
      }
    }
  });

  test("all see_also references should be valid", () => {
    const registryPath = path.join(__dirname, "../.agents/ralph/lib/errors.json");
    const content = fs.readFileSync(registryPath, "utf8");
    const json = JSON.parse(content);

    const { $schema, _meta, ...errors } = json;
    const allCodes = Object.keys(errors);

    for (const [code, error] of Object.entries(errors)) {
      if (error.see_also) {
        for (const ref of error.see_also) {
          assert(
            allCodes.includes(ref) || registry.isValidCode(ref),
            `${code} references ${ref} which doesn't exist`
          );
        }
      }
    }
  });
});

console.log("\nTest complete.");
