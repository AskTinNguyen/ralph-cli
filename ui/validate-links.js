#!/usr/bin/env node

/**
 * Link Validation Script for Ralph CLI Documentation Website
 *
 * Validates all internal href targets in HTML files to ensure no broken links.
 * Usage: node validate-links.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

// Find all HTML files
function findHtmlFiles(dir) {
  const files = [];

  function walkDir(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(fullPath);
      }
    }
  }

  walkDir(dir);
  return files;
}

// Extract all links from an HTML file
function extractLinks(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const dom = new JSDOM(content);
  const doc = dom.window.document;
  const links = [];

  const anchors = doc.querySelectorAll("a[href]");
  const buttons = doc.querySelectorAll("button[href]");
  const forms = doc.querySelectorAll("form[action]");

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (href) {
      links.push({
        href,
        file: path.relative(publicDir, filePath),
        line: 0, // JSDOM doesn't preserve line numbers
        text: anchor.textContent?.trim() || "",
      });
    }
  });

  buttons.forEach((button) => {
    const href = button.getAttribute("href");
    if (href) {
      links.push({
        href,
        file: path.relative(publicDir, filePath),
        line: 0,
        text: button.textContent?.trim() || "",
      });
    }
  });

  forms.forEach((form) => {
    const action = form.getAttribute("action");
    if (action) {
      links.push({
        href: action,
        file: path.relative(publicDir, filePath),
        line: 0,
        text: form.getAttribute("id") || "form",
      });
    }
  });

  return links;
}

// Check if a link is external
function isExternalLink(href) {
  return (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  );
}

// Check if a file exists
function fileExists(filePath) {
  return fs.existsSync(path.join(publicDir, filePath));
}

// Normalize href to file path
function normalizeHref(href) {
  // Remove query strings and fragments
  const withoutFragment = href.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];

  // If it ends with /, assume it's a directory and look for index.html
  if (withoutQuery.endsWith("/")) {
    return withoutQuery + "index.html";
  }

  return withoutQuery || "index.html";
}

// Main validation function
function validateLinks() {
  log(colors.blue, "\n=== Ralph CLI Link Validator ===\n");

  const htmlFiles = findHtmlFiles(publicDir);
  log(colors.green, `Found ${htmlFiles.length} HTML files\n`);

  const allLinks = [];
  const linkMap = new Map();

  // Extract all links
  for (const file of htmlFiles) {
    const links = extractLinks(file);
    allLinks.push(...links);
  }

  log(colors.green, `Extracted ${allLinks.length} links\n`);

  // Group links by href and track which files reference them
  for (const link of allLinks) {
    const existing = linkMap.get(link.href);
    const isExternal = isExternalLink(link.href);

    if (existing) {
      existing.files.push(link.file);
    } else {
      linkMap.set(link.href, {
        href: link.href,
        isExternal,
        exists: !isExternal, // Mark external as "exists" by default
        files: [link.file],
      });
    }
  }

  // Validate internal links
  const results = Array.from(linkMap.values());
  let brokenCount = 0;
  let externalCount = 0;
  let validCount = 0;

  log(colors.yellow, "=== VALIDATION RESULTS ===\n");

  for (const result of results) {
    if (result.isExternal) {
      externalCount++;
      log(colors.blue, `✓ External: ${result.href}`);
    } else {
      const normalized = normalizeHref(result.href);
      const exists = fileExists(normalized);

      if (exists) {
        validCount++;
        log(colors.green, `✓ ${result.href}`);
      } else {
        brokenCount++;
        log(colors.red, `✗ BROKEN: ${result.href}`);
        log(colors.yellow, `  Referenced in:`);
        result.files.forEach((file) => {
          log(colors.yellow, `    - ${file}`);
        });
      }
    }
  }

  // Summary
  log(colors.blue, "\n=== SUMMARY ===");
  log(colors.green, `Valid internal links: ${validCount}`);
  log(colors.blue, `External links: ${externalCount}`);

  if (brokenCount > 0) {
    log(colors.red, `Broken links: ${brokenCount}`);
    log(
      colors.red,
      "\n✗ VALIDATION FAILED: Found broken links\n"
    );
    process.exit(1);
  } else {
    log(colors.green, `Broken links: ${brokenCount}`);
    log(colors.green, "\n✓ VALIDATION PASSED: All links are valid!\n");
    process.exit(0);
  }
}

// Run validation
try {
  validateLinks();
} catch (error) {
  log(colors.red, `Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
