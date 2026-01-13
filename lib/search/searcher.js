/**
 * Search functionality
 *
 * Provides full-text search across guardrails, progress logs, evaluations, and run summaries.
 */
const { loadSearchIndex, buildIndex } = require("./indexer");
const { loadRegistry } = require("../registry/projects");

/**
 * Escape regex special characters
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Calculate relevance score for a search result
 * @param {Object} entry - Search index entry
 * @param {string} query - Search query
 * @param {string[]} terms - Query terms (lowercase)
 * @returns {number} - Relevance score (0-100)
 */
function calculateRelevance(entry, query, terms) {
  let score = 0;
  const lowerQuery = query.toLowerCase();
  const searchText = entry.searchableText || "";
  const title = (entry.title || "").toLowerCase();
  const content = (entry.content || "").toLowerCase();

  // Exact phrase match in title (highest priority)
  if (title.includes(lowerQuery)) {
    score += 50;
  }

  // Exact phrase match in content
  if (content.includes(lowerQuery)) {
    score += 30;
  }

  // Individual term matches
  for (const term of terms) {
    if (term.length < 2) continue;

    // Title contains term
    if (title.includes(term)) {
      score += 15;
    }

    // Content contains term (count occurrences, max 5)
    const regex = new RegExp(escapeRegex(term), "gi");
    const matches = content.match(regex);
    if (matches) {
      score += Math.min(matches.length * 3, 15);
    }

    // Special fields
    if (entry.type === "guardrail") {
      const trigger = (entry.trigger || "").toLowerCase();
      const instruction = (entry.instruction || "").toLowerCase();
      if (trigger.includes(term)) score += 10;
      if (instruction.includes(term)) score += 10;
    }

    if (entry.type === "progress") {
      const learnings = (entry.learnings || "").toLowerCase();
      if (learnings.includes(term)) score += 10;
    }
  }

  // Normalize to 0-100
  return Math.min(Math.round(score), 100);
}

/**
 * Extract context snippet around a match
 * @param {string} text - Full text content
 * @param {string} query - Search query
 * @param {number} contextChars - Characters of context around match (default 80)
 * @returns {Object|null} - Snippet with highlighted text and positions
 */
function extractSnippet(text, query, contextChars = 80) {
  if (!text || !query) return null;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const terms = lowerQuery.split(/\s+/).filter((t) => t.length >= 2);

  // Find first match position
  let matchPos = lowerText.indexOf(lowerQuery);
  let matchLen = query.length;

  // If no exact match, find first term match
  if (matchPos === -1) {
    for (const term of terms) {
      const pos = lowerText.indexOf(term);
      if (pos !== -1) {
        matchPos = pos;
        matchLen = term.length;
        break;
      }
    }
  }

  if (matchPos === -1) {
    // No match found, return beginning of text
    const snippet = text.slice(0, contextChars * 2);
    return {
      text: snippet + (text.length > contextChars * 2 ? "..." : ""),
      highlights: [],
    };
  }

  // Calculate snippet boundaries
  const start = Math.max(0, matchPos - contextChars);
  const end = Math.min(text.length, matchPos + matchLen + contextChars);

  let snippet = text.slice(start, end);

  // Add ellipsis if truncated
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  // Find all match positions within the snippet for highlighting
  const highlights = [];
  for (const term of [lowerQuery, ...terms]) {
    if (term.length < 2) continue;
    const snippetLower = snippet.toLowerCase();
    let pos = 0;
    while ((pos = snippetLower.indexOf(term, pos)) !== -1) {
      highlights.push({
        start: pos,
        end: pos + term.length,
        text: snippet.slice(pos, pos + term.length),
      });
      pos += term.length;
    }
  }

  // Deduplicate and sort highlights
  highlights.sort((a, b) => a.start - b.start);

  return {
    text: prefix + snippet + suffix,
    highlights,
    prefixLen: prefix.length,
  };
}

/**
 * Search across all indexed content
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {string} options.project - Filter by project name or ID
 * @param {string} options.type - Filter by type (guardrail|progress|evaluation|run)
 * @param {string[]} options.tags - Filter by project tags
 * @param {string} options.since - Filter by date (ISO string or relative like "7d", "1m")
 * @param {number} options.limit - Max results to return (default 20)
 * @param {boolean} options.rebuild - Rebuild index before searching
 * @returns {Object} - Search results with metadata
 */
function search(query, options = {}) {
  const { project, type, tags, since, limit = 20, rebuild = false } = options;

  // Rebuild index if requested
  if (rebuild) {
    buildIndex();
  }

  const index = loadSearchIndex();
  const registry = loadRegistry();

  // Build project lookup for tags filtering
  const projectsById = new Map();
  for (const p of registry.projects) {
    projectsById.set(p.id, p);
  }

  // Parse since filter
  let sinceDate = null;
  if (since) {
    sinceDate = parseSince(since);
  }

  // Split query into terms
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);

  // Filter entries
  let results = index.entries.filter((entry) => {
    // Type filter
    if (type && entry.type !== type) {
      return false;
    }

    // Project filter (by name or ID)
    if (project) {
      const projectLower = project.toLowerCase();
      if (
        entry.projectId !== project &&
        entry.projectName.toLowerCase() !== projectLower &&
        !entry.projectName.toLowerCase().includes(projectLower)
      ) {
        return false;
      }
    }

    // Tags filter
    if (tags && tags.length > 0) {
      const projectEntry = projectsById.get(entry.projectId);
      if (!projectEntry) return false;
      const hasMatchingTag = tags.some((tag) =>
        projectEntry.tags.includes(tag.toLowerCase())
      );
      if (!hasMatchingTag) return false;
    }

    // Since filter
    if (sinceDate) {
      const entryDate = entry.entryDate || entry.modifiedAt;
      if (entryDate && new Date(entryDate) < sinceDate) {
        return false;
      }
    }

    // Query match
    if (!query || query.trim() === "") {
      return true; // No query = return all (useful with filters)
    }

    const searchText = entry.searchableText || "";
    const lowerQuery = query.toLowerCase();

    // Check for exact phrase match
    if (searchText.includes(lowerQuery)) {
      return true;
    }

    // Check for any term match
    return terms.some((term) => searchText.includes(term));
  });

  // Calculate relevance scores
  results = results.map((entry) => ({
    ...entry,
    relevance: calculateRelevance(entry, query, terms),
    snippet: extractSnippet(entry.content, query),
  }));

  // Sort by relevance (descending)
  results.sort((a, b) => b.relevance - a.relevance);

  // Apply limit
  const totalCount = results.length;
  results = results.slice(0, limit);

  return {
    query,
    totalCount,
    returnedCount: results.length,
    results,
    filters: {
      project: project || null,
      type: type || null,
      tags: tags || null,
      since: since || null,
    },
    searchedAt: new Date().toISOString(),
  };
}

/**
 * Parse a since filter value to a Date
 * @param {string} since - Since value (ISO date or relative like "7d", "1m", "1y")
 * @returns {Date|null}
 */
function parseSince(since) {
  // Try ISO date first
  const isoDate = new Date(since);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Parse relative dates
  const match = since.match(/^(\d+)([dDwWmMyY])$/);
  if (!match) {
    return null;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const now = new Date();

  switch (unit) {
    case "d":
      now.setDate(now.getDate() - amount);
      break;
    case "w":
      now.setDate(now.getDate() - amount * 7);
      break;
    case "m":
      now.setMonth(now.getMonth() - amount);
      break;
    case "y":
      now.setFullYear(now.getFullYear() - amount);
      break;
    default:
      return null;
  }

  return now;
}

/**
 * Get available filter options from the index
 * @returns {Object} - Available filter values
 */
function getFilterOptions() {
  const index = loadSearchIndex();
  const registry = loadRegistry();

  const types = new Set();
  const projects = new Map();
  const allTags = new Set();

  for (const entry of index.entries) {
    types.add(entry.type);
    if (!projects.has(entry.projectId)) {
      projects.set(entry.projectId, {
        id: entry.projectId,
        name: entry.projectName,
        count: 0,
      });
    }
    projects.get(entry.projectId).count++;
  }

  for (const project of registry.projects) {
    for (const tag of project.tags) {
      allTags.add(tag);
    }
  }

  return {
    types: Array.from(types).sort(),
    projects: Array.from(projects.values()).sort((a, b) => b.count - a.count),
    tags: Array.from(allTags).sort(),
  };
}

module.exports = {
  search,
  calculateRelevance,
  extractSnippet,
  parseSince,
  getFilterOptions,
};
