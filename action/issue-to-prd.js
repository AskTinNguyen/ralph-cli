#!/usr/bin/env node
/**
 * Convert GitHub Issue to PRD Format
 *
 * This script parses GitHub issue content and generates a PRD document
 * that ralph can use for planning and building.
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse GitHub issue body and extract structured content
 * @param {Object} issue - GitHub issue object
 * @returns {Object} Parsed issue data
 */
function parseIssue(issue) {
  const body = issue.body || '';
  const title = issue.title || 'Untitled Feature';

  // Extract sections from issue body
  const sections = {
    description: '',
    acceptance_criteria: [],
    technical_notes: '',
    labels: issue.labels?.map(l => l.name) || []
  };

  // Try to extract structured content from common formats
  const lines = body.split('\n');
  let currentSection = 'description';
  let currentContent = [];

  for (const line of lines) {
    const lowerLine = line.toLowerCase().trim();

    // Detect section headers
    if (lowerLine.match(/^#+\s*(acceptance\s*criteria|ac|requirements)/)) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'acceptance_criteria';
      currentContent = [];
    } else if (lowerLine.match(/^#+\s*(technical\s*(notes?|details?|approach)|implementation)/)) {
      if (currentContent.length > 0) {
        if (currentSection === 'acceptance_criteria') {
          sections.acceptance_criteria = parseListItems(currentContent.join('\n'));
        } else {
          sections[currentSection] = currentContent.join('\n').trim();
        }
      }
      currentSection = 'technical_notes';
      currentContent = [];
    } else if (lowerLine.match(/^#+\s*(description|overview|summary)/)) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'description';
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save remaining content
  if (currentContent.length > 0) {
    if (currentSection === 'acceptance_criteria') {
      sections.acceptance_criteria = parseListItems(currentContent.join('\n'));
    } else {
      sections[currentSection] = currentContent.join('\n').trim();
    }
  }

  // If no structured acceptance criteria found, try to extract from description
  if (sections.acceptance_criteria.length === 0) {
    sections.acceptance_criteria = parseListItems(sections.description);
    // If still empty, create a default one from title
    if (sections.acceptance_criteria.length === 0) {
      sections.acceptance_criteria = [`Feature "${title}" is implemented and working`];
    }
  }

  return {
    title,
    number: issue.number,
    url: issue.html_url,
    author: issue.user?.login || 'unknown',
    ...sections
  };
}

/**
 * Parse list items from text (markdown lists, checkboxes, etc.)
 * @param {string} text - Text to parse
 * @returns {string[]} Array of list items
 */
function parseListItems(text) {
  const items = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Match markdown list items: - [ ] item, - [x] item, - item, * item, 1. item
    const match = line.match(/^\s*(?:[-*+]|\d+\.)\s*(?:\[[ x]\])?\s*(.+)/i);
    if (match && match[1].trim()) {
      items.push(match[1].trim());
    }
  }

  return items;
}

/**
 * Generate PRD markdown from parsed issue data
 * @param {Object} data - Parsed issue data
 * @returns {string} PRD markdown content
 */
function generatePRD(data) {
  const storyId = `US-001`;
  const acceptanceCriteria = data.acceptance_criteria
    .map(ac => `- [ ] ${ac}`)
    .join('\n');

  let prd = `# PRD: ${data.title}

## Overview

${data.description || 'Auto-generated from GitHub issue.'}

**Source**: Issue #${data.number} - ${data.url}
**Author**: @${data.author}
${data.labels.length > 0 ? `**Labels**: ${data.labels.join(', ')}` : ''}

## User Stories

### [ ] ${storyId}: ${data.title}
**As a** user
**I want** ${data.title.toLowerCase()}
**So that** the requested feature is available

#### Acceptance Criteria
${acceptanceCriteria}
`;

  if (data.technical_notes) {
    prd += `
## Technical Notes

${data.technical_notes}
`;
  }

  prd += `
## Generated

This PRD was auto-generated from GitHub Issue #${data.number}.
`;

  return prd;
}

/**
 * Create PRD directory and file
 * @param {string} prdContent - PRD markdown content
 * @param {string} ralphDir - Ralph directory path
 * @returns {number} PRD number created
 */
function createPRDFile(prdContent, ralphDir = '.ralph') {
  // Find next PRD number
  let prdNum = 1;
  while (fs.existsSync(path.join(ralphDir, `PRD-${prdNum}`))) {
    prdNum++;
  }

  const prdDir = path.join(ralphDir, `PRD-${prdNum}`);
  fs.mkdirSync(prdDir, { recursive: true });

  const prdPath = path.join(prdDir, 'prd.md');
  fs.writeFileSync(prdPath, prdContent);

  // Create empty progress and runs
  fs.writeFileSync(path.join(prdDir, 'progress.md'), '# Progress Log\n\n');
  fs.mkdirSync(path.join(prdDir, 'runs'), { recursive: true });

  return prdNum;
}

/**
 * Main function to convert issue to PRD
 * @param {Object|string} issueInput - GitHub issue object or JSON string
 * @param {string} ralphDir - Ralph directory path
 * @returns {Object} Result with PRD number and path
 */
function convertIssueToPRD(issueInput, ralphDir = '.ralph') {
  // Parse input if string
  const issue = typeof issueInput === 'string'
    ? JSON.parse(issueInput)
    : issueInput;

  // Parse and generate
  const data = parseIssue(issue);
  const prdContent = generatePRD(data);
  const prdNum = createPRDFile(prdContent, ralphDir);

  return {
    prdNum,
    prdPath: path.join(ralphDir, `PRD-${prdNum}`, 'prd.md'),
    title: data.title,
    issueNumber: issue.number
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Read from GITHUB_EVENT_PATH if available
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath && fs.existsSync(eventPath)) {
      const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
      if (event.issue) {
        const result = convertIssueToPRD(event.issue);
        console.log(JSON.stringify(result));
        process.exit(0);
      }
    }
    console.error('Usage: issue-to-prd.js <issue-json>');
    console.error('Or set GITHUB_EVENT_PATH environment variable');
    process.exit(1);
  }

  try {
    const issueJson = args[0];
    const ralphDir = args[1] || '.ralph';
    const result = convertIssueToPRD(issueJson, ralphDir);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Export for use as module
module.exports = {
  parseIssue,
  parseListItems,
  generatePRD,
  createPRDFile,
  convertIssueToPRD
};
