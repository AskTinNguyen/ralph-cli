/**
 * Authorship Reader Service
 *
 * Provides functions for tracking and managing authorship metadata
 * for PRD and plan files. Tracks which content was written by AI vs humans.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AuthorType, AuthorshipBlock, AuthorshipMetadata } from '../types.js';
import { getRalphRoot } from './state-reader.js';

/**
 * Get the authorship file path for a given markdown file
 * e.g., prd.md -> .prd-authorship.json
 */
export function getAuthorshipPath(filePath: string): string {
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath, path.extname(filePath));
  return path.join(dir, `.${basename}-authorship.json`);
}

/**
 * Load authorship metadata for a file
 * Returns null if no authorship file exists
 */
export function loadAuthorship(filePath: string): AuthorshipMetadata | null {
  const rootPath = getRalphRoot();
  if (!rootPath) return null;

  const fullPath = path.join(rootPath, filePath);
  const authorshipPath = getAuthorshipPath(fullPath);

  try {
    if (!fs.existsSync(authorshipPath)) {
      return null;
    }
    const content = fs.readFileSync(authorshipPath, 'utf-8');
    return JSON.parse(content) as AuthorshipMetadata;
  } catch {
    return null;
  }
}

/**
 * Save authorship metadata for a file
 */
export function saveAuthorship(filePath: string, metadata: AuthorshipMetadata): void {
  const rootPath = getRalphRoot();
  if (!rootPath) return;

  const fullPath = path.join(rootPath, filePath);
  const authorshipPath = getAuthorshipPath(fullPath);

  try {
    fs.writeFileSync(authorshipPath, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save authorship metadata:', error);
  }
}

/**
 * Compute a SHA-256 hash for content (used for change detection)
 */
export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Generate a unique block ID
 */
export function generateBlockId(): string {
  return crypto.randomUUID();
}

/**
 * Parse markdown content into logical blocks
 * Each block represents a heading, paragraph, or list item
 */
export function parseBlocksFromMarkdown(content: string): Array<{
  lineStart: number;
  lineEnd: number;
  type: 'heading' | 'paragraph' | 'list_item' | 'code_block' | 'blank';
  content: string;
}> {
  const lines = content.split('\n');
  const blocks: Array<{
    lineStart: number;
    lineEnd: number;
    type: 'heading' | 'paragraph' | 'list_item' | 'code_block' | 'blank';
    content: string;
  }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const lineNum = i + 1; // 1-indexed

    // Skip empty lines
    if (line.trim() === '') {
      blocks.push({
        lineStart: lineNum,
        lineEnd: lineNum,
        type: 'blank',
        content: line,
      });
      i++;
      continue;
    }

    // Detect headings
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({
        lineStart: lineNum,
        lineEnd: lineNum,
        type: 'heading',
        content: line,
      });
      i++;
      continue;
    }

    // Detect code blocks
    if (line.startsWith('```')) {
      const blockStart = lineNum;
      let blockEnd = lineNum;
      const blockLines = [line];
      i++;

      // Find the closing ```
      while (i < lines.length) {
        blockLines.push(lines[i]);
        if (lines[i].startsWith('```')) {
          blockEnd = i + 1;
          i++;
          break;
        }
        blockEnd = i + 1;
        i++;
      }

      blocks.push({
        lineStart: blockStart,
        lineEnd: blockEnd,
        type: 'code_block',
        content: blockLines.join('\n'),
      });
      continue;
    }

    // Detect list items (including checkboxes)
    if (/^[\-\*\+]\s|^\d+\.\s|^\s*[\-\*\+]\s/.test(line)) {
      blocks.push({
        lineStart: lineNum,
        lineEnd: lineNum,
        type: 'list_item',
        content: line,
      });
      i++;
      continue;
    }

    // Default: paragraph (accumulate consecutive non-blank, non-special lines)
    const paragraphStart = lineNum;
    const paragraphLines = [line];
    i++;

    while (i < lines.length) {
      const nextLine = lines[i];
      // Stop paragraph on blank line, heading, list item, or code block
      if (
        nextLine.trim() === '' ||
        /^#{1,6}\s/.test(nextLine) ||
        /^[\-\*\+]\s|^\d+\.\s/.test(nextLine) ||
        nextLine.startsWith('```')
      ) {
        break;
      }
      paragraphLines.push(nextLine);
      i++;
    }

    blocks.push({
      lineStart: paragraphStart,
      lineEnd: paragraphStart + paragraphLines.length - 1,
      type: 'paragraph',
      content: paragraphLines.join('\n'),
    });
  }

  return blocks;
}

/**
 * Reconcile authorship metadata with new content
 * Updates authorship for changed/new blocks while preserving original authorship
 */
export function reconcileAuthorship(
  oldMeta: AuthorshipMetadata | null,
  newContent: string,
  author: AuthorType,
  filePath: string
): AuthorshipMetadata {
  const now = new Date().toISOString();
  const parsedBlocks = parseBlocksFromMarkdown(newContent);

  // Initialize new metadata structure
  const newMeta: AuthorshipMetadata = {
    version: 1,
    filePath,
    lastUpdated: now,
    defaultAuthor: oldMeta?.defaultAuthor || 'unknown',
    blocks: [],
    stats: {
      humanLines: 0,
      aiLines: 0,
      unknownLines: 0,
      totalLines: 0,
      humanPercentage: 0,
      aiPercentage: 0,
    },
  };

  // Build a map of old blocks by their content hash for matching
  const oldBlocksByHash = new Map<string, AuthorshipBlock>();
  if (oldMeta) {
    for (const block of oldMeta.blocks) {
      oldBlocksByHash.set(block.contentHash, block);
    }
  }

  // Process each new block
  for (const parsedBlock of parsedBlocks) {
    if (parsedBlock.type === 'blank') {
      continue; // Skip blank lines in authorship tracking
    }

    const contentHash = computeContentHash(parsedBlock.content);
    const existingBlock = oldBlocksByHash.get(contentHash);

    if (existingBlock) {
      // Content hasn't changed - preserve authorship but update line numbers
      newMeta.blocks.push({
        ...existingBlock,
        lineStart: parsedBlock.lineStart,
        lineEnd: parsedBlock.lineEnd,
      });
    } else {
      // New or modified content
      // Try to find a block that overlaps with similar line range (potential modification)
      let foundOriginal: AuthorshipBlock | undefined;
      if (oldMeta) {
        for (const oldBlock of oldMeta.blocks) {
          // Check if line ranges overlap significantly
          const overlap = Math.min(parsedBlock.lineEnd, oldBlock.lineEnd) -
                         Math.max(parsedBlock.lineStart, oldBlock.lineStart);
          if (overlap > 0) {
            foundOriginal = oldBlock;
            break;
          }
        }
      }

      if (foundOriginal) {
        // This is a modification of existing content
        newMeta.blocks.push({
          id: foundOriginal.id,
          lineStart: parsedBlock.lineStart,
          lineEnd: parsedBlock.lineEnd,
          contentHash,
          author: foundOriginal.author,
          timestamp: foundOriginal.timestamp,
          modifiedBy: author,
          modifiedAt: now,
          originalAuthor: foundOriginal.originalAuthor || foundOriginal.author,
          context: foundOriginal.context,
        });
      } else {
        // Completely new content
        newMeta.blocks.push({
          id: generateBlockId(),
          lineStart: parsedBlock.lineStart,
          lineEnd: parsedBlock.lineEnd,
          contentHash,
          author,
          timestamp: now,
        });
      }
    }
  }

  // Calculate stats
  newMeta.stats = calculateStats(newMeta, newContent);

  return newMeta;
}

/**
 * Get the author for a specific line number
 */
export function getAuthorForLine(metadata: AuthorshipMetadata | null, line: number): AuthorType {
  if (!metadata) return 'unknown';

  for (const block of metadata.blocks) {
    if (line >= block.lineStart && line <= block.lineEnd) {
      return block.modifiedBy || block.author;
    }
  }

  return metadata.defaultAuthor;
}

/**
 * Get authorship info for a specific line (returns both author and modifier)
 */
export function getAuthorshipInfoForLine(
  metadata: AuthorshipMetadata | null,
  line: number
): { author: AuthorType; modifiedBy?: AuthorType; originalAuthor?: AuthorType } | null {
  if (!metadata) return null;

  for (const block of metadata.blocks) {
    if (line >= block.lineStart && line <= block.lineEnd) {
      return {
        author: block.author,
        modifiedBy: block.modifiedBy,
        originalAuthor: block.originalAuthor,
      };
    }
  }

  return { author: metadata.defaultAuthor };
}

/**
 * Calculate authorship statistics
 */
export function calculateStats(metadata: AuthorshipMetadata, content: string): AuthorshipMetadata['stats'] {
  const lines = content.split('\n');
  const totalLines = lines.length;

  let humanLines = 0;
  let aiLines = 0;
  let unknownLines = 0;

  for (let i = 1; i <= totalLines; i++) {
    const author = getAuthorForLine(metadata, i);

    if (author === 'human') {
      humanLines++;
    } else if (author.startsWith('ai:')) {
      aiLines++;
    } else {
      unknownLines++;
    }
  }

  return {
    humanLines,
    aiLines,
    unknownLines,
    totalLines,
    humanPercentage: totalLines > 0 ? Math.round((humanLines / totalLines) * 100) : 0,
    aiPercentage: totalLines > 0 ? Math.round((aiLines / totalLines) * 100) : 0,
  };
}

/**
 * Initialize authorship metadata for a new file
 * Marks all existing content with the specified default author
 */
export function initializeAuthorship(
  content: string,
  filePath: string,
  defaultAuthor: AuthorType = 'unknown'
): AuthorshipMetadata {
  const now = new Date().toISOString();
  const parsedBlocks = parseBlocksFromMarkdown(content);

  const blocks: AuthorshipBlock[] = [];

  for (const parsedBlock of parsedBlocks) {
    if (parsedBlock.type === 'blank') continue;

    blocks.push({
      id: generateBlockId(),
      lineStart: parsedBlock.lineStart,
      lineEnd: parsedBlock.lineEnd,
      contentHash: computeContentHash(parsedBlock.content),
      author: defaultAuthor,
      timestamp: now,
    });
  }

  const metadata: AuthorshipMetadata = {
    version: 1,
    filePath,
    lastUpdated: now,
    defaultAuthor,
    blocks,
    stats: {
      humanLines: 0,
      aiLines: 0,
      unknownLines: 0,
      totalLines: 0,
      humanPercentage: 0,
      aiPercentage: 0,
    },
  };

  // Calculate actual stats
  metadata.stats = calculateStats(metadata, content);

  return metadata;
}

/**
 * Get a summary of authorship for display
 */
export function getAuthorshipSummary(metadata: AuthorshipMetadata | null): string {
  if (!metadata) return 'No authorship data';

  const { humanPercentage, aiPercentage } = metadata.stats;

  if (humanPercentage === 0 && aiPercentage === 0) {
    return '100% Unknown';
  }

  const parts: string[] = [];
  if (aiPercentage > 0) parts.push(`${aiPercentage}% AI`);
  if (humanPercentage > 0) parts.push(`${humanPercentage}% Human`);

  return parts.join(' / ');
}

/**
 * Normalize author type for CSS class naming
 * e.g., 'ai:claude:opus' -> 'ai-claude'
 */
export function normalizeAuthorForCSS(author: AuthorType): string {
  if (author === 'human') return 'human';
  if (author === 'unknown') return 'unknown';
  if (author.startsWith('ai:claude')) return 'ai-claude';
  if (author === 'ai:codex') return 'ai-codex';
  if (author === 'ai:droid') return 'ai-droid';
  return 'unknown';
}
