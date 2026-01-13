/**
 * Markdown Parser Service
 *
 * Parses PRD and plan markdown files to extract structured story
 * and task information for display in the UI.
 */

import type { Story, StoryStatus, AcceptanceCriterion } from '../types.js';

/**
 * A task within a plan section
 */
export interface PlanTask {
  description: string;
  completed: boolean;
  scope?: string;
  acceptance?: string;
  verification?: string;
  notes?: string;
}

/**
 * A section in the plan corresponding to a user story
 */
export interface PlanSection {
  storyId: string;
  storyTitle: string;
  tasks: PlanTask[];
}

/**
 * Parsed plan structure
 */
export interface ParsedPlan {
  summary: string;
  sections: PlanSection[];
  notes?: string;
  discoveries?: string[];
  risks?: string[];
}

/**
 * Parse user stories from PRD markdown content.
 *
 * Extracts stories with their ID, title, completion status,
 * description, and acceptance criteria.
 *
 * @param markdown - Raw PRD markdown content
 * @returns Array of parsed Story objects
 */
export function parseStories(markdown: string): Story[] {
  const stories: Story[] = [];
  const lines = markdown.split('\n');

  let currentStory: Story | null = null;
  let inAcceptanceCriteria = false;
  let descriptionLines: string[] = [];
  let collectingDescription = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match story heading: ### [ ] US-001: Title or ### [x] US-001: Title
    const storyMatch = line.match(/^###\s*\[([ xX])\]\s*(US-\d+):\s*(.+)$/i);

    if (storyMatch) {
      // Save previous story
      if (currentStory) {
        if (descriptionLines.length > 0) {
          currentStory.description = descriptionLines.join('\n').trim();
        }
        stories.push(currentStory);
      }

      const isCompleted = storyMatch[1].toLowerCase() === 'x';
      currentStory = {
        id: storyMatch[2].toUpperCase(),
        title: storyMatch[3].trim(),
        status: isCompleted ? 'completed' : 'pending',
        acceptanceCriteria: [],
      };
      inAcceptanceCriteria = false;
      descriptionLines = [];
      collectingDescription = true;
      continue;
    }

    // Skip if no current story being parsed
    if (!currentStory) {
      continue;
    }

    // Check for acceptance criteria section
    if (/^#{4,}\s*Acceptance Criteria/i.test(line)) {
      inAcceptanceCriteria = true;
      collectingDescription = false;
      continue;
    }

    // Stop acceptance criteria parsing at next heading (but not criteria items)
    if (/^#{2,4}\s+/.test(line) && !/^#{4,}\s*Acceptance/i.test(line)) {
      // This is a new section header, not just a story header
      if (!line.match(/^###\s*\[([ xX])\]/i)) {
        inAcceptanceCriteria = false;
        collectingDescription = false;
      }
    }

    // Parse acceptance criteria items
    if (inAcceptanceCriteria) {
      const criteriaMatch = line.match(/^-\s*\[([ xX])\]\s*(.+)$/i);
      if (criteriaMatch) {
        currentStory.acceptanceCriteria.push({
          text: criteriaMatch[2].trim(),
          completed: criteriaMatch[1].toLowerCase() === 'x',
        });
      }
    }

    // Collect description lines (between story heading and acceptance criteria)
    if (collectingDescription && !inAcceptanceCriteria) {
      // Stop collecting description at acceptance criteria header
      if (/^#{4,}\s*Acceptance/i.test(line)) {
        collectingDescription = false;
      } else if (line.trim() !== '' || descriptionLines.length > 0) {
        descriptionLines.push(line);
      }
    }

    // Update story status based on "IN PROGRESS" markers
    if (currentStory.status === 'pending') {
      if (/\bIN[- ]?PROGRESS\b/i.test(line)) {
        currentStory.status = 'in-progress';
      }
    }
  }

  // Don't forget the last story
  if (currentStory) {
    if (descriptionLines.length > 0) {
      currentStory.description = descriptionLines.join('\n').trim();
    }
    stories.push(currentStory);
  }

  return stories;
}

/**
 * Parse a plan markdown file to extract structured task information.
 *
 * @param markdown - Raw plan markdown content
 * @returns Parsed plan structure with sections and tasks
 */
export function parsePlan(markdown: string): ParsedPlan {
  const sections: PlanSection[] = [];
  const lines = markdown.split('\n');

  let summary = '';
  let inSummary = false;
  let summaryLines: string[] = [];

  let currentSection: PlanSection | null = null;
  let currentTask: PlanTask | null = null;
  let currentTaskField: 'scope' | 'acceptance' | 'verification' | 'notes' | null = null;

  let notes = '';
  let discoveries: string[] = [];
  let risks: string[] = [];
  let inNotes = false;
  let inDiscoveries = false;
  let inRisks = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse Summary section
    if (/^##\s+Summary\s*$/i.test(line)) {
      inSummary = true;
      continue;
    }

    if (inSummary && /^##\s+/.test(line) && !/^##\s+Summary/i.test(line)) {
      // End of summary section
      inSummary = false;
      summary = summaryLines.join('\n').trim();
    }

    if (inSummary) {
      summaryLines.push(line);
      continue;
    }

    // Parse story section: ### US-001: Title
    const sectionMatch = line.match(/^###\s+(US-\d+):\s*(.+)$/i);
    if (sectionMatch) {
      // Save previous section
      if (currentSection) {
        if (currentTask) {
          currentSection.tasks.push(currentTask);
          currentTask = null;
        }
        sections.push(currentSection);
      }

      currentSection = {
        storyId: sectionMatch[1].toUpperCase(),
        storyTitle: sectionMatch[2].trim(),
        tasks: [],
      };
      currentTaskField = null;
      inNotes = false;
      inDiscoveries = false;
      inRisks = false;
      continue;
    }

    // Parse Notes section
    if (/^##\s+Notes\s*$/i.test(line)) {
      // Save current section before entering notes
      if (currentSection) {
        if (currentTask) {
          currentSection.tasks.push(currentTask);
          currentTask = null;
        }
        sections.push(currentSection);
        currentSection = null;
      }
      inNotes = true;
      continue;
    }

    // Parse Discoveries subsection within Notes
    if (inNotes && /^###\s+Discoveries/i.test(line)) {
      inDiscoveries = true;
      inRisks = false;
      continue;
    }

    // Parse Risks subsection within Notes
    if (inNotes && /^###\s+Risks/i.test(line)) {
      inDiscoveries = false;
      inRisks = true;
      continue;
    }

    // Collect discoveries
    if (inDiscoveries && line.startsWith('- ')) {
      discoveries.push(line.slice(2).trim());
      continue;
    }

    // Collect risks
    if (inRisks && line.startsWith('- ')) {
      risks.push(line.slice(2).trim());
      continue;
    }

    // Stop discoveries/risks on new section
    if ((inDiscoveries || inRisks) && /^#{2,3}\s+/.test(line)) {
      inDiscoveries = false;
      inRisks = false;
    }

    // Parse task within a section: - [ ] Task description or - [x] Task description
    if (currentSection) {
      const taskMatch = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
      if (taskMatch) {
        // Save previous task
        if (currentTask) {
          currentSection.tasks.push(currentTask);
        }

        currentTask = {
          description: taskMatch[2].trim(),
          completed: taskMatch[1].toLowerCase() === 'x',
        };
        currentTaskField = null;
        continue;
      }

      // Parse task metadata fields (indented under task)
      if (currentTask && line.startsWith('  ')) {
        const trimmedLine = line.trim();

        // Check for field labels
        const scopeMatch = trimmedLine.match(/^-?\s*Scope:\s*(.*)$/i);
        if (scopeMatch) {
          currentTask.scope = scopeMatch[1].trim();
          currentTaskField = 'scope';
          continue;
        }

        const acceptanceMatch = trimmedLine.match(/^-?\s*Acceptance:\s*(.*)$/i);
        if (acceptanceMatch) {
          currentTask.acceptance = acceptanceMatch[1].trim();
          currentTaskField = 'acceptance';
          continue;
        }

        const verificationMatch = trimmedLine.match(/^-?\s*Verification:\s*(.*)$/i);
        if (verificationMatch) {
          currentTask.verification = verificationMatch[1].trim();
          currentTaskField = 'verification';
          continue;
        }

        const notesMatch = trimmedLine.match(/^-?\s*\*\*Verified\*\*:\s*(.*)$/i);
        if (notesMatch) {
          currentTask.notes = notesMatch[1].trim();
          currentTaskField = 'notes';
          continue;
        }

        // Continuation of previous field
        if (currentTaskField && trimmedLine !== '') {
          const currentValue = currentTask[currentTaskField] || '';
          currentTask[currentTaskField] = currentValue
            ? `${currentValue} ${trimmedLine}`
            : trimmedLine;
        }
      }
    }
  }

  // Save the last section and task
  if (currentSection) {
    if (currentTask) {
      currentSection.tasks.push(currentTask);
    }
    sections.push(currentSection);
  }

  return {
    summary,
    sections,
    notes: notes || undefined,
    discoveries: discoveries.length > 0 ? discoveries : undefined,
    risks: risks.length > 0 ? risks : undefined,
  };
}

/**
 * Count stories by status from a parsed story list.
 *
 * @param stories - Array of Story objects
 * @returns Object with counts for each status
 */
export function countStoriesByStatus(stories: Story[]): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
} {
  return {
    total: stories.length,
    completed: stories.filter((s) => s.status === 'completed').length,
    inProgress: stories.filter((s) => s.status === 'in-progress').length,
    pending: stories.filter((s) => s.status === 'pending').length,
  };
}

/**
 * Get completion percentage for a set of stories.
 *
 * @param stories - Array of Story objects
 * @returns Completion percentage (0-100)
 */
export function getCompletionPercentage(stories: Story[]): number {
  if (stories.length === 0) {
    return 0;
  }
  const completed = stories.filter((s) => s.status === 'completed').length;
  return Math.round((completed / stories.length) * 100);
}

/**
 * Find a story by ID in a parsed story list.
 *
 * @param stories - Array of Story objects
 * @param id - Story ID to find (e.g., "US-001")
 * @returns The matching Story or undefined
 */
export function findStoryById(stories: Story[], id: string): Story | undefined {
  const normalizedId = id.toUpperCase();
  return stories.find((s) => s.id.toUpperCase() === normalizedId);
}

/**
 * Find a plan section by story ID.
 *
 * @param plan - Parsed plan object
 * @param storyId - Story ID to find (e.g., "US-001")
 * @returns The matching PlanSection or undefined
 */
export function findPlanSectionByStoryId(
  plan: ParsedPlan,
  storyId: string
): PlanSection | undefined {
  const normalizedId = storyId.toUpperCase();
  return plan.sections.find((s) => s.storyId.toUpperCase() === normalizedId);
}
