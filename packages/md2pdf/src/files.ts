import * as fs from "fs";
import * as path from "path";

export type SortStrategy = "alpha" | "numeric" | "natural";

export interface FileDiscoveryOptions {
  recursive?: boolean;
  sort?: SortStrategy;
}

/**
 * Check if a given path is a directory
 */
export function isDirectory(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extract numeric prefix from filename (e.g., "01-intro.md" -> 1)
 */
function extractNumericPrefix(filename: string): number | null {
  const match = filename.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Sort files alphabetically (case-insensitive)
 */
function sortAlphabetically(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const aName = path.basename(a).toLowerCase();
    const bName = path.basename(b).toLowerCase();
    return aName.localeCompare(bName);
  });
}

/**
 * Sort files by numeric prefix, then alphabetically
 */
function sortByNumeric(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const aName = path.basename(a);
    const bName = path.basename(b);
    const aNum = extractNumericPrefix(aName);
    const bNum = extractNumericPrefix(bName);

    // Both have numeric prefixes
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
      // Same number, fall back to alphabetical
      return aName.localeCompare(bName);
    }

    // Only one has numeric prefix - put numeric first
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;

    // Neither has numeric prefix - alphabetical
    return aName.localeCompare(bName);
  });
}

/**
 * Sort files naturally (numeric-aware alphabetical sorting)
 */
function sortNaturally(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const aName = path.basename(a);
    const bName = path.basename(b);
    return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: "base" });
  });
}

/**
 * Sort files according to the specified strategy
 */
function sortFiles(files: string[], strategy: SortStrategy = "natural"): string[] {
  switch (strategy) {
    case "alpha":
      return sortAlphabetically(files);
    case "numeric":
      return sortByNumeric(files);
    case "natural":
      return sortNaturally(files);
    default:
      return sortNaturally(files);
  }
}

/**
 * Discover all Markdown files in a directory
 * @param dirPath - Directory path to scan
 * @param options - Options for file discovery
 * @returns Array of absolute file paths sorted according to strategy
 */
export function discoverMarkdownFiles(
  dirPath: string,
  options: FileDiscoveryOptions = {}
): string[] {
  const { recursive = false, sort = "natural" } = options;
  const markdownFiles: string[] = [];

  function scanDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (recursive) {
          scanDirectory(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === ".md" || ext === ".markdown") {
          markdownFiles.push(fullPath);
        }
      }
    }
  }

  scanDirectory(dirPath);

  // Sort files according to strategy
  return sortFiles(markdownFiles, sort);
}
