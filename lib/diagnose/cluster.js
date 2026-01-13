/**
 * Error clustering module
 *
 * Groups similar errors using edit distance on error messages,
 * buckets by error type (test, type, shell, dependency).
 */

/**
 * Calculate Levenshtein edit distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function editDistance(a, b) {
  if (!a || !b) return Math.max((a || "").length, (b || "").length);

  const la = a.length;
  const lb = b.length;

  // Quick exit for identical strings
  if (a === b) return 0;

  // Use shorter string as column for memory efficiency
  if (la > lb) {
    [a, b] = [b, a];
  }

  const len1 = a.length;
  const len2 = b.length;

  // Previous and current row
  let prev = Array(len1 + 1).fill(0).map((_, i) => i);
  let curr = Array(len1 + 1).fill(0);

  for (let j = 1; j <= len2; j++) {
    curr[0] = j;
    for (let i = 1; i <= len1; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,      // deletion
        curr[i - 1] + 1,  // insertion
        prev[i - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[len1];
}

/**
 * Calculate similarity ratio (0-1) between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity (1 = identical, 0 = completely different)
 */
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const dist = editDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Normalize an error message for comparison
 * @param {string} message - Error message
 * @returns {string} Normalized message
 */
function normalizeMessage(message) {
  if (!message) return "";

  return message
    // Remove timestamps
    .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/g, "[TIME]")
    // Remove run IDs
    .replace(/run-\d{8}-\d{6}-\d+/g, "[RUN]")
    // Remove file paths but keep filename
    .replace(/\/[\w\-./]+\/([^/\s]+)/g, "[PATH]/$1")
    // Remove line:col numbers
    .replace(/:\d+:\d+/g, ":[LINE]")
    // Remove hex addresses
    .replace(/0x[a-f0-9]+/gi, "[ADDR]")
    // Remove UUIDs
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "[UUID]")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Cluster errors by similarity
 * @param {object[]} errors - Array of error objects with { type, message, ... }
 * @param {object} options - Clustering options
 * @returns {object[]} Array of clusters
 */
function clusterErrors(errors, options = {}) {
  const {
    similarityThreshold = 0.6,
    groupByType = true,
  } = options;

  if (errors.length === 0) return [];

  const clusters = [];

  // First, group by error type if enabled
  const groups = new Map();
  for (const error of errors) {
    const key = groupByType ? error.type : "all";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(error);
  }

  // Then cluster within each group
  for (const [type, typeErrors] of groups) {
    const typeClusters = clusterByMessage(typeErrors, similarityThreshold);

    // Add type info to each cluster
    for (const cluster of typeClusters) {
      cluster.type = type;
      clusters.push(cluster);
    }
  }

  // Sort by count (descending)
  clusters.sort((a, b) => b.count - a.count);

  return clusters;
}

/**
 * Cluster errors by message similarity
 * @param {object[]} errors - Errors of the same type
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {object[]} Clusters
 */
function clusterByMessage(errors, threshold) {
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < errors.length; i++) {
    if (assigned.has(i)) continue;

    const error = errors[i];
    const normalizedMsg = normalizeMessage(error.message);

    // Start a new cluster
    const cluster = {
      count: 1,
      representative: error.message,
      normalizedKey: normalizedMsg,
      errors: [error],
      runs: new Set([error.runId].filter(Boolean)),
      sources: new Set([error.source].filter(Boolean)),
    };

    assigned.add(i);

    // Find similar errors
    for (let j = i + 1; j < errors.length; j++) {
      if (assigned.has(j)) continue;

      const otherError = errors[j];
      const otherNormalized = normalizeMessage(otherError.message);

      const sim = similarity(normalizedMsg, otherNormalized);
      if (sim >= threshold) {
        cluster.count++;
        cluster.errors.push(otherError);
        if (otherError.runId) cluster.runs.add(otherError.runId);
        if (otherError.source) cluster.sources.add(otherError.source);
        assigned.add(j);
      }
    }

    // Convert sets to arrays
    cluster.runs = Array.from(cluster.runs);
    cluster.sources = Array.from(cluster.sources);

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Merge similar clusters across types
 * @param {object[]} clusters - Array of clusters
 * @param {number} threshold - Merge threshold
 * @returns {object[]} Merged clusters
 */
function mergeSimilarClusters(clusters, threshold = 0.8) {
  const merged = [];
  const used = new Set();

  for (let i = 0; i < clusters.length; i++) {
    if (used.has(i)) continue;

    const cluster = { ...clusters[i] };
    used.add(i);

    // Find similar clusters to merge
    for (let j = i + 1; j < clusters.length; j++) {
      if (used.has(j)) continue;

      const other = clusters[j];
      const sim = similarity(cluster.normalizedKey, other.normalizedKey);

      if (sim >= threshold) {
        // Merge
        cluster.count += other.count;
        cluster.errors.push(...other.errors);
        cluster.runs = [...new Set([...cluster.runs, ...other.runs])];
        cluster.sources = [...new Set([...cluster.sources, ...other.sources])];

        // If types differ, mark as mixed
        if (cluster.type !== other.type) {
          cluster.type = `${cluster.type}/${other.type}`;
        }

        used.add(j);
      }
    }

    merged.push(cluster);
  }

  return merged.sort((a, b) => b.count - a.count);
}

/**
 * Get a summary of clustered errors
 * @param {object[]} clusters - Array of clusters
 * @returns {object} Summary statistics
 */
function getClusterSummary(clusters) {
  const totalErrors = clusters.reduce((sum, c) => sum + c.count, 0);
  const totalClusters = clusters.length;
  const uniqueRuns = new Set();
  const typeBreakdown = {};

  for (const cluster of clusters) {
    for (const run of cluster.runs) {
      uniqueRuns.add(run);
    }

    const type = cluster.type || "unknown";
    if (!typeBreakdown[type]) {
      typeBreakdown[type] = { count: 0, clusters: 0 };
    }
    typeBreakdown[type].count += cluster.count;
    typeBreakdown[type].clusters += 1;
  }

  return {
    totalErrors,
    totalClusters,
    uniqueRuns: uniqueRuns.size,
    typeBreakdown,
    topCluster: clusters[0] || null,
  };
}

module.exports = {
  editDistance,
  similarity,
  normalizeMessage,
  clusterErrors,
  clusterByMessage,
  mergeSimilarClusters,
  getClusterSummary,
};
