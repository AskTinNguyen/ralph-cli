import * as fs from "fs";

/**
 * Load and validate CSS files
 * @param cssFiles Array of CSS file paths to load
 * @returns Array of CSS content strings
 * @throws Error if any CSS file is not found
 */
export function loadCSSFiles(cssFiles: string[]): string[] {
  const cssContents: string[] = [];
  const invalidFiles: string[] = [];

  for (const cssFile of cssFiles) {
    // Check if file exists
    if (!fs.existsSync(cssFile)) {
      invalidFiles.push(cssFile);
      continue;
    }

    try {
      const content = fs.readFileSync(cssFile, "utf-8");

      // Basic CSS validation - check for common malformed patterns
      // This is a simple check, not a full CSS parser
      const warnings = validateCSS(content, cssFile);

      if (warnings.length > 0) {
        warnings.forEach(warning => {
          console.warn(`Warning: ${warning}`);
        });
        console.warn(`Continuing with valid CSS rules from ${cssFile}`);
      }

      cssContents.push(content);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to read CSS file ${cssFile}: ${error.message}`);
      }
      throw error;
    }
  }

  // If any files were not found, throw error with all invalid paths
  if (invalidFiles.length > 0) {
    throw new Error(
      `The following CSS files were not found:\n${invalidFiles.map(f => `  - ${f}`).join("\n")}`
    );
  }

  return cssContents;
}

/**
 * Basic CSS validation to detect common malformed patterns
 * Returns array of warning messages
 */
function validateCSS(css: string, filename: string): string[] {
  const warnings: string[] = [];

  // Check for unmatched braces
  const openBraces = (css.match(/\{/g) || []).length;
  const closeBraces = (css.match(/\}/g) || []).length;

  if (openBraces !== closeBraces) {
    warnings.push(
      `${filename}: Unmatched braces detected (${openBraces} opening, ${closeBraces} closing)`
    );
  }

  // Check for unclosed comments
  const commentStarts = (css.match(/\/\*/g) || []).length;
  const commentEnds = (css.match(/\*\//g) || []).length;

  if (commentStarts !== commentEnds) {
    warnings.push(
      `${filename}: Unclosed CSS comments detected`
    );
  }

  // Check for empty rules (basic check)
  const emptyRules = css.match(/[^}]\s*\{\s*\}/g);
  if (emptyRules && emptyRules.length > 0) {
    warnings.push(
      `${filename}: Found ${emptyRules.length} empty CSS rule(s)`
    );
  }

  return warnings;
}
