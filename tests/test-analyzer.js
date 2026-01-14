#!/usr/bin/env node
/**
 * Test script for lib/parallel/analyzer.js
 * Verifies story parsing, file extraction, dependency detection, and batching
 */

const path = require("path");
const {
  parseStories,
  extractFilePaths,
  detectDependencies,
  buildDependencyGraph,
  getBatches,
} = require("../lib/parallel/analyzer");

// Test using PRD-6 (the current PRD)
const prdPath = path.join(__dirname, "..", ".ralph", "PRD-6", "prd.md");

console.log("Testing Story Dependency Analyzer...\n");

// Test 1: parseStories
console.log("Test 1: parseStories()");
const stories = parseStories(prdPath);
console.log(`  ✓ Parsed ${stories.length} stories`);
console.log(`  Stories found: ${stories.map((s) => s.id).join(", ")}`);
console.log(`  First story: ${stories[0].id} - ${stories[0].title}`);
console.log(`  Status format: [${stories[0].status}] (should be space or x)`);
console.log();

// Test 2: extractFilePaths
console.log("Test 2: extractFilePaths()");
const us001 = stories.find((s) => s.id === "US-001");
if (us001) {
  const files = extractFilePaths(us001.content);
  console.log(`  ✓ US-001 mentions ${files.length} file(s):`);
  files.forEach((f) => console.log(`    - ${f}`));
  if (files.includes("lib/parallel/analyzer.js")) {
    console.log(`  ✓ Correctly extracted lib/parallel/analyzer.js`);
  } else {
    console.log(`  ✗ FAILED: Should have extracted lib/parallel/analyzer.js`);
  }
} else {
  console.log("  ✗ FAILED: US-001 not found");
}
console.log();

// Test 3: detectDependencies
console.log("Test 3: detectDependencies()");
const us002 = stories.find((s) => s.id === "US-002");
if (us002) {
  const deps = detectDependencies(us002.content);
  console.log(`  ✓ US-002 depends on: ${deps.length > 0 ? deps.join(", ") : "none (independent)"}`);
}
const us007 = stories.find((s) => s.id === "US-007");
if (us007) {
  const deps = detectDependencies(us007.content);
  console.log(`  ✓ US-007 depends on: ${deps.length > 0 ? deps.join(", ") : "none"}`);
  // Note: US-007 dependencies might be in the story overview table, not in acceptance criteria
}
console.log();

// Test 4: buildDependencyGraph
console.log("Test 4: buildDependencyGraph()");
const graph = buildDependencyGraph(stories);
console.log(`  ✓ Built graph with ${Object.keys(graph.nodes).length} nodes`);
console.log("\n  Dependency details:");
for (const id of Object.keys(graph.nodes).sort()) {
  const node = graph.nodes[id];
  const deps = graph.edges[id];
  console.log(`    ${id}: ${deps.length > 0 ? deps.join(", ") : "no dependencies"}`);
  if (node.files.length > 0) {
    console.log(
      `      Files: ${node.files.slice(0, 3).join(", ")}${node.files.length > 3 ? "..." : ""}`
    );
  }
}
console.log();

// Test 5: getBatches (topological sort)
console.log("Test 5: getBatches() - Topological Sort");
try {
  const batches = getBatches(graph, stories);
  console.log(`  ✓ Generated ${batches.length} batch(es):`);
  batches.forEach((batch, i) => {
    console.log(`    Batch ${i + 1} (${batch.length} stories, can run in parallel):`);
    batch.forEach((id) => {
      const story = stories.find((s) => s.id === id);
      console.log(`      - ${id}: ${story.title}`);
    });
  });

  // Verify batch ordering respects dependencies
  const processedIds = new Set();
  let valid = true;
  for (const batch of batches) {
    for (const id of batch) {
      const deps = graph.edges[id];
      for (const depId of deps) {
        if (!processedIds.has(depId)) {
          console.log(
            `  ✗ FAILED: ${id} depends on ${depId}, but ${depId} hasn't been processed yet`
          );
          valid = false;
        }
      }
      processedIds.add(id);
    }
  }
  if (valid) {
    console.log(`  ✓ All dependencies are respected in batch ordering`);
  }
} catch (err) {
  console.log(`  ✗ FAILED: ${err.message}`);
}
console.log();

console.log("All tests completed!");
console.log("\nSummary:");
console.log("- parseStories: extracts stories using PRD regex pattern");
console.log("- extractFilePaths: finds file mentions in backticks and text");
console.log("- detectDependencies: finds explicit 'depends on' statements");
console.log("- buildDependencyGraph: combines explicit + implicit (file) deps");
console.log("- getBatches: generates parallel-safe batches via Kahn's algorithm");
